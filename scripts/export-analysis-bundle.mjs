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
 *        SUPABASE_SERVICE_KEY=eyJ...        <- service_role key, NOT the anon key
 *   2. Make sure analysis/CONTEXT.md, analysis/FINDINGS.md and analysis/ANALYZE.md exist.
 *
 * Run:
 *   npm run export:analysis        (from the repo root — it passes --env-file=.env.local)
 *
 * Output:
 *   analysis-bundles/ember-YYYY-MM-DD/  + the same folder zipped, ready to upload
 *
 * NOTE: the service_role key bypasses row-level security. Keep it in .env.local,
 * never commit it, and never ship it to the client bundle.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

// --- derived daily table ----------------------------------------------------
//
// Every cleaning rule below is documented in CONTEXT.md. If you change one here,
// change it there too — otherwise each analysis run silently diverges.

const buildDaily = ({ entries, nutrition, weight, screen, contexts }) => {
  const nutByDate = new Map((nutrition ?? []).map((r) => [r.date, r]));
  const wtByDate = new Map((weight ?? []).map((r) => [r.date, r]));
  const scrByDate = new Map((screen ?? []).map((r) => [r.date, r]));

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
      // >13h is a mislog, not a night of sleep (see CONTEXT.md). The bad value is
      // almost always the bedtime, so drop that too rather than leaving a bedtime
      // of 35.5 sitting in the data looking legitimate.
      if (sleepDur > 13) {
        sleepDur = null;
        bedShift = null;
      }
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
      social: e.social === true ? 1 : e.social === false ? 0 : null,
      focused_work: e.focused_work ?? null,

      sick: e.sick ? 1 : 0,
      alcohol: e.alcohol ? 1 : 0,
      slept_away: e.slept_away ? 1 : 0,
      travel_day: e.travel_day ? 1 : 0,
      caffeine_late: e.caffeine_late ? 1 : 0,
      deadline_pressure: e.deadline_pressure ? 1 : 0,

      calories: calsOk ? n.calories : null,
      protein_g: calsOk ? n.protein_g : null,
      carbs_g: calsOk ? n.carbs_g : null,
      fat_g: calsOk ? n.fat_g : null,

      weight_lbs: w.weight_lbs ?? null,

      phone_minutes: s.phone_minutes ?? null,
      phone_pickups: s.phone_pickups ?? null,
      computer_minutes: s.computer_minutes ?? null,

      hrv_avg: e.hrv_avg ?? null,
      resting_hr: e.resting_hr ?? null,
      steps: e.steps ?? null,
      weather_temp_f: e.weather_temp_f ?? null,

      note: e.note ?? null,
    };
  });

  // Consecutive-night index for trips: night 1, 2, 3... of each away run.
  // Lets the analysis test the adaptation curve instead of guessing at it.
  let run = 0;
  for (const r of rows) {
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

// --- packaging --------------------------------------------------------------

/** Zip the bundle so it's one drag into a chat. The folder is left in place. */
const zipBundle = (dir) => {
  const zipPath = `${dir}.zip`;
  // zip *adds to* an existing archive, so a same-day re-run would keep stale files.
  rmSync(zipPath, { force: true });
  try {
    execFileSync('zip', ['-rq', basename(zipPath), basename(dir)], { cwd: dirname(dir) });
    return zipPath;
  } catch (e) {
    console.warn(`\n  ! couldn't zip the bundle (${e.message}) — upload the folder instead`);
    return null;
  }
};

// --- main -------------------------------------------------------------------

const main = async () => {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false },
  });

  const stamp = new Date().toISOString().slice(0, 10);
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

  const zipPath = zipBundle(outDir);

  console.log(
    zipPath
      ? `\nDone. Upload:\n  ${zipPath}\n`
      : `\nDone. Upload the contents of:\n  ${outDir}\n`
  );
  console.log('Then paste the prompt from the top of ANALYZE.md into the chat.');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
