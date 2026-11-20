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
 *   4. Optional, also in .env.local — each one adds columns and is null without it:
 *        SPOTIFY_HISTORY_DIR=/path/to/unzipped/spotify/export   (scripts/sources/spotify.mjs)
 *        TAKATIME_EXPORT_DIR=/path/to/takatime/exports            (scripts/sources/takatime.mjs)
 *        LASTFM_USER=<username>  LASTFM_API_KEY=<read-only key>   (scripts/sources/lastfm.mjs)
 *      Paths with spaces are fine quoted: KEY='/Users/me/My Folder'.
 *        CALENDAR_EXPORT=1    macOS: Calendar + Reminders via EventKit
 *                             (scripts/sources/calendar.mjs, analysis/LABELING.md)
 *      Daylight columns need no setup: they're computed from the coordinates
 *      already in push_settings, which never enter the bundle themselves.
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
import { buildDaylight } from './sources/daylight.mjs';
import { buildSpotify } from './sources/spotify.mjs';
import { buildLastfm } from './sources/lastfm.mjs';
import { buildCalendar } from './sources/calendar.mjs';
import { buildTakatime } from './sources/takatime.mjs';

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

// Listed so the columns exist (as null) even when calendar export is off, and so
// the merged CSV's column order doesn't depend on which sources ran.
const CALENDAR_COLS = [
  'cal_class_h',
  'cal_study_h',
  'cal_work_h',
  'cal_social_h',
  'cal_exercise_h',
  'cal_other_h',
  'cal_unlabeled_h',
  'cal_busy_h',
  'cal_events',
  'cal_first_start_hours',
  'cal_last_end_hours',
  'cal_deadline_48h',
  'reminders_done',
];
//
// Every cleaning rule below is documented in CONTEXT.md. If you change one here,
// change it there too — otherwise each analysis run silently diverges.

const musicFor = (d, spotify, lastfm) => {
  const s = spotify?.get(d);
  if (s) return { ...s, music_source: 'spotify' };
  const l = lastfm?.get(d);
  if (l) return { music_minutes: l.music_minutes, podcast_minutes: null, night_music_minutes: l.night_music_minutes, music_source: 'lastfm' };
  return { music_minutes: null, podcast_minutes: null, night_music_minutes: null, music_source: null };
};

const buildDaily = ({ entries, nutrition, weight, screen, contexts, mac, coding, daylight, spotify, lastfm, calendar }) => {
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
      // Retired Nov 2026: no longer asked, so null after the last tracked day.
      last_meal_start_time: e.last_meal_start_time ?? null,

      gym: e.gym_actual === 'yes' ? 1 : e.gym_actual === 'no' ? 0 : null,
      // Raw, and only meaningful on gym days: null on a 'no' day is not applicable,
      // null on a gym day before 2026-11-21 is untracked.
      workout_type: e.workout_type ?? null,
      // Retired Nov 2026 with the morning gym question; null after its last day.
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
      // Human and AI overlap and are never added; coding_minutes is their union.
      coding_minutes: coding?.get(d)?.coding_minutes ?? null,
      coding_human_minutes: coding?.get(d)?.coding_human_minutes ?? null,
      coding_ai_minutes: coding?.get(d)?.coding_ai_minutes ?? null,

      // Each external source is null on days it doesn't cover and a real 0 on
      // days it covers but saw nothing — see each module's header.
      // Spotify's exact play time wins where it covers a day; Last.fm (an estimate,
      // and blind to podcasts) carries on after the Spotify snapshot ends.
      ...musicFor(d, spotify, lastfm),
      ...CALENDAR_COLS.reduce((acc, c) => ({ ...acc, [c]: calendar?.get(d)?.[c] ?? null }), {}),

      daylight_hours: daylight?.get(d)?.daylight_hours ?? null,
      sunset_hours: daylight?.get(d)?.sunset_hours ?? null,

      hrv_avg: e.hrv_avg ?? null,
      resting_hr: e.resting_hr ?? null,
      steps: e.steps ?? null,
      weather_temp_f: e.weather_temp_f ?? null,

      note: e.note ?? null,
      week_best: e.week_best ?? null,
      week_struggle: e.week_struggle ?? null,
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

const present = (v) => v !== null && v !== undefined && v !== '';

const coverage = (rows) => {
  const cols = Object.keys(rows[0] ?? {});
  return cols
    .map((c) => {
      const hits = rows.filter((r) => present(r[c]));
      return {
        column: c,
        n: hits.length,
        pct: rows.length ? Math.round((hits.length / rows.length) * 100) : 0,
        last: hits.at(-1)?.date ?? null,
      };
    })
    .sort((a, b) => a.pct - b.pct);
};

// A row exists for every calendar day whether or not anything was logged — the
// Worker's weather snapshot creates it — so row count says nothing about logging.
// A day counts as logged when its check-in was actually done.
const isLogged = (r) => present(r.day_quality) || present(r.sleep_quality);

/** Gap in whole days between two YYYY-MM-DD keys. */
const dayGap = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

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

  // Read, not dumped: push_* stays out of the bundle. Only the timezone (to bucket
  // Spotify plays into local days) and the coordinates (for daylight) are used,
  // and neither is written anywhere.
  const { data: settings } = await sb
    .from('push_settings')
    .select('latitude, longitude, timezone')
    .limit(1)
    .maybeSingle();
  const timezone = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const allDates = byDate(pulled.entries).map((e) => e.date);

  const daily = buildDaily({
    entries: pulled.entries,
    nutrition: pulled.daily_nutrition,
    weight: pulled.body_weight,
    screen: pulled.screen_time,
    contexts: pulled.context_periods,
    mac: fetchMacMinutes(),
    coding: await buildTakatime(process.env.TAKATIME_EXPORT_DIR, timezone),
    daylight: settings ? buildDaylight(allDates, { ...settings, timezone }) : null,
    spotify: buildSpotify(process.env.SPOTIFY_HISTORY_DIR, timezone),
    lastfm: await buildLastfm(process.env.LASTFM_USER, process.env.LASTFM_API_KEY, timezone, stamp),
    calendar: buildCalendar({
      root: ROOT,
      dates: allDates,
      enabled: process.env.CALENDAR_EXPORT === '1',
    }),
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
  const logged = daily.filter(isLogged);
  const unloggedRecent = daily
    .filter((r) => !isLogged(r) && dayGap(r.date, stamp) <= 30 && r.date !== stamp)
    .map((r) => r.date);
  const eveningMissed = daily.filter(
    (r) => present(r.sleep_quality) && !present(r.day_quality) && r.date !== stamp
  ).length;
  // A column that used to have values and hasn't for two weeks has stalled — a
  // paused import, a broken sync, or a retired question. Worth a line either way.
  const stalled = cov.filter(
    // away_night_index is sparse by design — only trips have one.
    (c) => c.last && c.n >= 5 && c.column !== 'away_night_index' && dayGap(c.last, stamp) > 14
  );
  const lastByTable = new Map(
    Object.entries(pulled)
      .filter(([, rows]) => rows.some((r) => r.date))
      .map(([t, rows]) => [t, rows.map((r) => r.date).filter(Boolean).sort().at(-1)])
  );

  const manifest = [
    `# Bundle manifest — generated ${stamp}`,
    ``,
    `Date range: ${dates[0]} → ${dates.at(-1)}`,
    `Rows: ${daily.length} over ${spanDays} calendar days. A row exists for every day ` +
      `(the weather snapshot creates it), so rows are not logged days.`,
    `Logged days (a check-in was done): ${logged.length}/${daily.length}. ` +
      `Morning done but evening missed: ${eveningMissed}.`,
    unloggedRecent.length
      ? `Unlogged in the last 30 days (${unloggedRecent.length}): ${unloggedRecent.join(', ')}`
      : `Every day in the last 30 was logged.`,
    ``,
    `## Row counts and last date`,
    ...Object.entries(pulled).map(
      ([t, r]) => `- ${t}: ${r.length}${lastByTable.has(t) ? ` (last ${lastByTable.get(t)})` : ''}`
    ),
    ``,
    `## Stalled columns (had data, nothing in the last 14 days)`,
    `A trailing gap is not a behavior change. Check CONTEXT.md for whether it was paused or retired.`,
    ``,
    ...(stalled.length ? stalled.map((c) => `- ${c.column}: last ${c.last}`) : ['- none']),
    ``,
    `## Contexts`,
    ...(pulled.context_periods ?? []).map(
      (c) => `- ${c.label}: ${c.start_date} → ${c.end_date ?? 'active'}`
    ),
    ``,
    `## Column coverage in daily_merged.csv (lowest first)`,
    `Anything under ~70% needs its n reported explicitly in any finding that uses it.`,
    ``,
    ...cov.map(
      (c) => `- ${c.column}: ${c.n}/${daily.length} (${c.pct}%)${c.last ? `, last ${c.last}` : ''}`
    ),
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