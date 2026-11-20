// Coding time from TakaTime, via one of its own export bundles.
//
// TakaTime stores heartbeats, never durations, and its README is blunt that the
// only correct way to get time out is its canonical algorithm, duration.mjs. Every
// TakaTime export ships that file beside heartbeats.json, so this imports the
// bundle's own copy instead of re-implementing it — the numbers always match
// whatever algorithm version produced the export. Never sum the legacy
// `duration` field on heartbeats; it undercounts and spans two throttle regimes.
//
// TAKATIME_EXPORT_DIR in .env.local points at either one export folder
// (takatime-YYYY-MM-DD) or the folder that holds them, in which case the newest
// is used. Run TakaTime's `npm run export` first so it's current: like the
// Spotify export, it is a snapshot, and days after it are null.
//
// Human and AI time overlap (you at the keyboard while an agent works) and are
// never added — coding_minutes is the union, computed over the merged stream.
// The editor-echo correction TakaTime's own summary applies needs its aiWrites
// collection, which the export doesn't carry, so coding_human_minutes here reads
// a little high on days an agent was editing open files.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const AI_EDITORS = new Set(['ClaudeCode']);

const resolveBundle = (dir) => {
  if (existsSync(join(dir, 'heartbeats.json'))) return dir;
  const dated = readdirSync(dir)
    .filter((f) => /^takatime-\d{4}-\d{2}-\d{2}$/.test(f) && existsSync(join(dir, f, 'heartbeats.json')))
    .sort();
  return dated.length ? join(dir, dated.at(-1)) : null;
};

const nextDayKey = (k) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** date -> { coding_minutes, coding_human_minutes, coding_ai_minutes }, or null. */
export const buildTakatime = async (dir, timeZone) => {
  if (!dir) return null;
  let bundle;
  try {
    bundle = resolveBundle(dir);
  } catch {
    bundle = null;
  }
  if (!bundle) {
    console.warn('  ! takatime: no export bundle in TAKATIME_EXPORT_DIR — coding columns will be null');
    return null;
  }

  let algo, heartbeats;
  try {
    algo = await import(pathToFileURL(join(bundle, 'duration.mjs')).href);
    heartbeats = JSON.parse(readFileSync(join(bundle, 'heartbeats.json'), 'utf8'));
  } catch {
    console.warn(`  ! takatime: couldn't load ${bundle} — coding columns will be null`);
    return null;
  }
  if (!heartbeats.length) return null;

  // Prefer the export's own regime timeline over the registry baked into its
  // duration.mjs, in case they ever disagree; they shouldn't.
  let configs;
  try {
    configs = JSON.parse(readFileSync(join(bundle, 'configs.json'), 'utf8'));
  } catch {
    configs = undefined;
  }

  const byDay = (filter) => {
    const r = algo.computeDurations(heartbeats, { timeZone, configs, groupBy: ['day'], filter });
    const out = new Map();
    for (const [d, v] of Object.entries(r.groups.day ?? {})) {
      out.set(d, typeof v === 'number' ? v : v.ms ?? 0);
    }
    return out;
  };
  const union = byDay(undefined);
  const human = byDay((hb) => !AI_EDITORS.has(hb.editor));
  const ai = byDay((hb) => AI_EDITORS.has(hb.editor));

  const stamps = heartbeats.map((hb) => algo.toEpochMs(hb.timestamp)).filter(Number.isFinite);
  const first = algo.dayKey(Math.min(...stamps), timeZone);
  const last = algo.dayKey(Math.max(...stamps), timeZone);
  const min = (m, d) => Math.round((m.get(d) ?? 0) / 6e4);

  // Inside the span a day with no editor activity is a real 0 — TakaTime measures
  // hands-on-keyboard time, and none is a valid reading of it. The export's own
  // day is cut off mid-day, so it's dropped like every other source's partial day.
  const out = new Map();
  for (let d = first; d < last; d = nextDayKey(d)) {
    out.set(d, {
      coding_minutes: min(union, d),
      coding_human_minutes: min(human, d),
      coding_ai_minutes: min(ai, d),
    });
  }
  console.log(
    `  coding (takatime)     ${String(out.size).padStart(5)} days  ${first} → ${last}` +
      ` (algorithm ${algo.ALGORITHM_VERSION ?? '?'}, ${last} partial, dropped)`
  );
  return out;
};
