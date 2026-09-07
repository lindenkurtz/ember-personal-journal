#!/usr/bin/env node
/**
 * Ember → Claude analysis bundle
 *
 * Pulls every table from Supabase, builds a cleaned merged daily table,
 * and copies the context/findings/instruction docs into a dated folder
 * ready to upload to a Claude chat.
 *
 * Setup (once):
 *   1. Put these in .env.local at the repo root (already gitignored):
 *        SUPABASE_URL=https://xxxx.supabase.co
 *        SUPABASE_SERVICE_KEY=sb_secret_...  <- secret key, NOT the publishable key
 *   2. Make sure analysis/CONTEXT.md, analysis/FINDINGS.md and analysis/ANALYZE.md exist.
 *      CONTEXT.md and FINDINGS.md are gitignored — they hold real health data and
 *      this repo is public. On a fresh checkout, copy them from the tracked
 *      analysis/*.template.md files. A missing one is warned about, not fatal.
 *   3. Optional: install focusd so `focusctl` is on PATH, and Mac screen time is
 *      merged in as `mac_minutes`. Without it that column is null and nothing else
 *      changes — see the focusd section below.
 *
 * Run:
 *   node scripts/export-analysis-bundle.mjs
 *
 * Output:
 *   analysis-bundles/ember-YYYY-MM-DD/
 *
 * NOTE: the service_role key bypasses row-level security. Keep it in .env.local,
 * never commit it, and never ship it to the client bundle.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --- config -----------------------------------------------------------------

const TABLES = [
  'entries',
  'daily_nutrition',
  'body_weight',
  'lift_progression',
  'screen_time',
  'context_periods',
];
// Deliberately excluded: finance_* (Plaid) and push_* (notification plumbing).
// Add finance_transactions here if you ever want spending in the analysis.

// Docs that ride along with the data. Missing ones are warned about, not fatal.
const DOCS = ['CONTEXT.md', 'FINDINGS.md', 'ANALYZE.md'];

// --- helpers ----------------------------------------------------------------

const env = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing ${k}. Add it to .env.local — see the header of this file.`);
    process.exit(1);
  }
  return v;
};

const toCsv = (rows) => {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap(Object.keys))];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
};

/** Page through a table so we aren't capped by PostgREST's default limit. */
const fetchAll = async (sb, table) => {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select('*').range(from, from + PAGE - 1);
    if (error) {
      if (error.code === '42P01' || /does not exist/i.test(error.message ?? '')) {
        console.warn(`  ! ${table} — table not found, skipping`);
        return null;
      }
      throw new Error(`${table}: ${error.message}`);
    }
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
};

const byDate = (rows) => (rows ?? []).sort((a, b) => String(a.date).localeCompare(String(b.date)));

/** "23:45" → minutes. Returns null on anything unparseable. */
const hhmmToMin = (t) => {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

// --- Mac screen time, via focusd --------------------------------------------
//
// focusd is a separate local daemon (~/Code/Personal/timetracking/focusd) that records
// which macOS app is frontmost once a minute. Its own first rule is that durations
// are derived at query time and never stored, so this shells out to focusctl on
// every export instead of keeping a synced copy — the number always reflects
// focusd's current config rather than whatever it was on the day of some old sync.
//
// Two runs, because the difference between them is what separates a real zero from
// an unobserved day:
//   --attended   screen on, unlocked, input within attended_max_idle_seconds
//   unfiltered   every heartbeat, including a machine parked at the login window
// A day focusd observed but credited no attended time to is a true 0. A day it
// observed nothing at all is null: it cannot tell a shut laptop from a crashed
// daemon, and METHODOLOGY.md forbids manufacturing the observation.

const FOCUSCTL = 'focusctl'; // override here if it isn't on PATH

/** "  4h06m52s   3.5%  2026-09-04" — the only lines of `report --by day` we want. */
const DAY_LINE = /^\s*(\d+)h(\d+)m(\d+)s\s+[\d.]+%\s+(\d{4}-\d{2}-\d{2})\s*$/;

const nextDayKey = (k) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const focusctlDays = (extraArgs) => {
  const out = execSync(`${FOCUSCTL} report --by day --top 100000 ${extraArgs}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const days = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(DAY_LINE);
    if (m) days.set(m[4], (Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60));
  }
  return days;
};

/** date -> attended minutes. Null (the whole map) when focusd isn't reachable. */
const fetchMacMinutes = () => {
  let attended, observed;
  try {
    attended = focusctlDays('--attended');
    observed = focusctlDays('');
  } catch {
    console.warn(`  ! ${FOCUSCTL} not runnable — mac_minutes will be null on every row`);
    return null;
  }
  if (!observed.size) {
    // Either an empty database or the report's output format moved under us. Both
    // are worth seeing rather than silently exporting a column of nulls.
    console.warn(`  ! ${FOCUSCTL} returned no parseable days — mac_minutes will be null`);
    return null;
  }

  const days = [...observed.keys()].sort();
  const first = days[0];
  const last = days.at(-1);
  // System-local, to match the journal's date keys. focusd buckets in America/Denver;
  // the two agree on the machine this runs on.
  const today = new Date().toLocaleDateString('en-CA');

  const minutes = new Map();
  const unobserved = [];
  for (let d = first; d <= last; d = nextDayKey(d)) {
    if (!observed.has(d)) {
      unobserved.push(d);
      continue;
    }
    // The first day is partial by construction (the daemon was installed partway
    // through it), and today is still in progress. Both would read as a low day.
    if (d === first || d === today) continue;
    minutes.set(d, Math.round(attended.get(d) ?? 0));
  }

  console.log(
    `  mac_minutes (focusd)  ${String(minutes.size).padStart(5)} days  ${first} \u2192 ${last}` +
      `  (${first} partial${last === today ? `, ${today} in progress` : ''})`
  );
  if (unobserved.length) {
    console.warn(
      `  ! focusd observed nothing on ${unobserved.length} day(s) in its span — ` +
        `null, not 0: ${unobserved.join(', ')}`
    );
  }
  return minutes;
};

// --- derived daily table ----------------------------------------------------
//
// Every cleaning rule below is documented in CONTEXT.md. If you change one here,
// change it there too — otherwise each analysis run silently diverges.

const buildDaily = ({ entries, nutrition, weight, screen, contexts, mac }) => {
  const nutByDate = new Map((nutrition ?? []).map((r) => [r.date, r]));
  const wtByDate = new Map((weight ?? []).map((r) => [r.date, r]));
  const scrByDate = new Map((screen ?? []).map((r) => [r.date, r]));

  // Nullable means untracked, not "no": the six confound flags have no DB default
  // and were only written from 2026-07-21 on. Collapsing null to 0 here would claim
  // every earlier day was a not-sick, not-drinking, at-home day.
  const flag = (v) => (v == null ? null : v ? 1 : 0);

  const resolveContext = (d) => {
    const hit = (contexts ?? []).find(
      (c) => d >= c.start_date && (!c.end_date || d <= c.end_date)
    );
    return hit ? hit.label : null;
  };

  const rows = byDate(entries).map((e, i) => {
    const d = e.date;
    const n = nutByDate.get(d) ?? {};
    const w = wtByDate.get(d) ?? {};
    const s = scrByDate.get(d) ?? {};

    // Sleep duration from bedtime + wake_time. A bedtime before noon is treated
    // as after-midnight and pushed into the previous evening's night.
    let bedMin = hhmmToMin(e.bedtime);
    const wakeMin = hhmmToMin(e.wake_time);
    let bedShift = bedMin === null ? null : bedMin < 12 * 60 ? bedMin + 24 * 60 : bedMin;
    let sleepDur = null;
    if (bedShift !== null && wakeMin !== null) {
      sleepDur = (wakeMin + 24 * 60 - bedShift) / 60;
      if (sleepDur < 0) sleepDur += 24;
      // Implausible values are deliberately NOT nulled here. A 20-hour night means a
      // mislogged bedtime; it should surface in the analysis with its date so it can
      // be fixed in Supabase, rather than being papered over on every export.
    }

    // Sub-1200 kcal days are failed logging, not fasting.
    const calsOk = n.calories != null && n.calories >= 1200;

    return {
      date: d,
      day_index: i, // regression against this detrends; see CONTEXT.md
      dow: new Date(`${d}T00:00:00`).getDay(),
      is_weekend: [0, 6].includes(new Date(`${d}T00:00:00`).getDay()) ? 1 : 0,
      context: resolveContext(d),

      sleep_quality: e.sleep_quality ?? null,
      day_quality: e.day_quality ?? null,
      sleep_dur_hours: sleepDur === null ? null : Number(sleepDur.toFixed(2)),
      bedtime_hours: bedShift === null ? null : Number((bedShift / 60).toFixed(2)), // 24 = midnight
      wake_hours: wakeMin === null ? null : Number((wakeMin / 60).toFixed(2)),
      last_meal_start_time: e.last_meal_start_time ?? null,

      gym: e.gym_actual === 'yes' ? 1 : e.gym_actual === 'no' ? 0 : null,
      gym_intention: e.gym_intention === 'yes' ? 1 : e.gym_intention === 'no' ? 0 : null,
      // social_level (0-3) replaces the boolean from 2026-09-06. `social` stays the
      // backward-compatible binary so the pre- and post-cutover series remain one
      // column; the level is emitted raw and is null before the cutover, never
      // reconstructed from the boolean (those days were not rated at this
      // resolution — same rule as mac_minutes' 0-vs-null).
      social_level: e.social_level ?? null,
      social:
        e.social_level != null
          ? e.social_level > 0
            ? 1
            : 0
          : e.social === true
            ? 1
            : e.social === false
              ? 0
              : null,
      focused_work: e.focused_work ?? null,

      // Both emitted raw. Unlike `social`, `sick` is deliberately NOT rebuilt from
      // the level: it is the long "major day" series, and sick_level is the finer
      // split that only starts 2026-09-06.
      sick: flag(e.sick),
      sick_level: e.sick_level ?? null,
      alcohol: flag(e.alcohol),
      slept_away: flag(e.slept_away),
      travel_day: flag(e.travel_day),
      caffeine_late: flag(e.caffeine_late),
      deadline_pressure: flag(e.deadline_pressure),

      calories: calsOk ? n.calories : null,
      protein_g: calsOk ? n.protein_g : null,
      carbs_g: calsOk ? n.carbs_g : null,
      fat_g: calsOk ? n.fat_g : null,

      weight_lbs: w.weight_lbs ?? null,

      phone_minutes: s.phone_minutes ?? null,
      phone_pickups: s.phone_pickups ?? null,
      ipad_minutes: s.ipad_minutes ?? null,
      mac_minutes: mac?.get(d) ?? null,

      hrv_avg: e.hrv_avg ?? null,
      resting_hr: e.resting_hr ?? null,
      steps: e.steps ?? null,
      weather_temp_f: e.weather_temp_f ?? null,

      note: e.note ?? null,
    };
  });

  // The evening flow writes `social` = (social_level > 0) on every rated day, so a
  // row carrying a level but a missing or disagreeing boolean means something wrote
  // one without the other. Worth naming the dates: the derived `social` above
  // silently prefers the level, which would otherwise hide the drift.
  const socialMismatches = byDate(entries)
    .filter(
      (e) =>
        e.social_level != null && (e.social == null || e.social !== e.social_level > 0)
    )
    .map((e) => `${e.date} (level=${e.social_level}, social=${e.social ?? 'null'})`);
  if (socialMismatches.length) {
    console.warn(
      `  ! social_level disagrees with social on ${socialMismatches.length} row(s) — ` +
        `daily_merged uses the level: ${socialMismatches.join(', ')}`
    );
  }

  // Same check for the sickness split: the evening flow writes `sick` = (sick_level
  // >= 2) on every rated day, so a disagreement means something wrote one without
  // the other. Both columns are emitted raw here, so neither hides the drift — but
  // an unnoticed one would quietly move days between the two categories.
  const sickMismatches = byDate(entries)
    .filter(
      (e) => e.sick_level != null && (e.sick == null || e.sick !== e.sick_level >= 2)
    )
    .map((e) => `${e.date} (level=${e.sick_level}, sick=${e.sick ?? 'null'})`);
  if (sickMismatches.length) {
    console.warn(
      `  ! sick_level disagrees with sick on ${sickMismatches.length} row(s): ` +
        sickMismatches.join(', ')
    );
  }

  // Consecutive-night index for trips: night 1, 2, 3... of each away run.
  // Lets the analysis test the adaptation curve instead of guessing at it.
  let run = 0;
  for (const r of rows) {
    // An untracked night can't extend or end a run — both would be a guess.
    if (r.slept_away === null) {
      run = 0;
      r.away_night_index = null;
      continue;
    }
    run = r.slept_away ? run + 1 : 0;
    r.away_night_index = run || null;
  }

  // Next-day outcomes, so lagged tests don't need to be re-derived each session.
  rows.forEach((r, i) => {
    const nx = rows[i + 1];
    const contiguous =
      nx && (new Date(`${nx.date}T00:00:00`) - new Date(`${r.date}T00:00:00`)) / 864e5 === 1;
    r.next_sleep_quality = contiguous ? nx.sleep_quality : null;
    r.next_day_quality = contiguous ? nx.day_quality : null;
    r.next_gym = contiguous ? nx.gym : null;
  });

  return rows;
};

// --- coverage report --------------------------------------------------------

const coverage = (rows) => {
  const cols = Object.keys(rows[0] ?? {});
  return cols
    .map((c) => {
      const n = rows.filter((r) => r[c] !== null && r[c] !== undefined && r[c] !== '').length;
      return { column: c, n, pct: rows.length ? Math.round((n / rows.length) * 100) : 0 };
    })
    .sort((a, b) => a.pct - b.pct);
};

// --- main -------------------------------------------------------------------

const main = async () => {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false },
  });

  // Local, not UTC: an evening export would otherwise be stamped with tomorrow's
  // date and sort ahead of the day it actually covers. Same reason the SPA never
  // uses toISOString for a date key.
  const stamp = new Date().toLocaleDateString('en-CA');
  const outDir = join(ROOT, 'analysis-bundles', `ember-${stamp}`);
  mkdirSync(join(outDir, 'raw'), { recursive: true });

  console.log(`Exporting to ${outDir}\n`);

  const pulled = {};
  for (const t of TABLES) {
    const rows = await fetchAll(sb, t);
    if (rows === null) continue;
    pulled[t] = rows;
    writeFileSync(join(outDir, 'raw', `${t}.csv`), toCsv(rows));
    console.log(`  ${t.padEnd(20)} ${String(rows.length).padStart(5)} rows`);
  }

  if (!pulled.entries?.length) {
    console.error('\nNo entries returned — check SUPABASE_SERVICE_KEY and table names.');
    process.exit(1);
  }

  const daily = buildDaily({
    entries: pulled.entries,
    nutrition: pulled.daily_nutrition,
    weight: pulled.body_weight,
    screen: pulled.screen_time,
    contexts: pulled.context_periods,
    mac: fetchMacMinutes(),
  });
  writeFileSync(join(outDir, 'daily_merged.csv'), toCsv(daily));
  console.log(`\n  daily_merged.csv     ${daily.length} rows (cleaned + derived)`);

  for (const doc of DOCS) {
    const src = join(ROOT, 'analysis', doc);
    if (existsSync(src)) copyFileSync(src, join(outDir, doc));
    else console.warn(`  ! analysis/${doc} not found — bundle will be missing it`);
  }

  // MANIFEST is generated fresh each run: it's the one file that describes THIS
  // export, so the chat session knows the shape of what it's looking at.
  const dates = daily.map((r) => r.date).sort();
  const spanDays =
    (new Date(dates.at(-1)) - new Date(dates[0])) / 864e5 + 1;
  const cov = coverage(daily);

  const manifest = [
    `# Bundle manifest — generated ${stamp}`,
    ``,
    `Date range: ${dates[0]} → ${dates.at(-1)}`,
    `Entries: ${daily.length} rows over ${spanDays} calendar days (${
      spanDays - daily.length
    } missing days)`,
    ``,
    `## Row counts`,
    ...Object.entries(pulled).map(([t, r]) => `- ${t}: ${r.length}`),
    ``,
    `## Contexts`,
    ...(pulled.context_periods ?? []).map(
      (c) => `- ${c.label}: ${c.start_date} → ${c.end_date ?? 'active'}`
    ),
    ``,
    `## Column coverage in daily_merged.csv (lowest first)`,
    `Anything under ~70% needs its n reported explicitly in any finding that uses it.`,
    ``,
    ...cov.map((c) => `- ${c.column}: ${c.n}/${daily.length} (${c.pct}%)`),
  ].join('\n');

  writeFileSync(join(outDir, 'MANIFEST.md'), manifest);

  // Zip it so the whole bundle is a single upload. Falls back silently to the
  // plain folder if `zip` isn't on the system.
  const zipPath = `${outDir}.zip`;
  try {
    execSync(`cd "${dirname(outDir)}" && zip -qr "${zipPath}" "ember-${stamp}"`);
    console.log(`\nDone. Upload this single file:\n  ${zipPath}`);
  } catch {
    console.log(`\nDone (zip unavailable). Upload the contents of:\n  ${outDir}`);
  }

  console.log('\nThen paste the prompt from the top of ANALYZE.md into the chat.');
  console.log('Make sure Code Execution is enabled in Claude settings, or the zip');
  console.log('cannot be extracted.');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});