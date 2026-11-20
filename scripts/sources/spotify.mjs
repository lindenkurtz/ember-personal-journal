// Spotify listening, from a downloaded privacy export — no API, nothing stored.
//
// Point SPOTIFY_HISTORY_DIR in .env.local at the unzipped export folder. Both
// shapes Spotify ships are read:
//   - Extended streaming history (Streaming_History_Audio_*.json): `ts` (UTC ISO),
//     `ms_played`, `episode_name` set on podcast plays. Complete back to account
//     creation; this is the one to request.
//   - Account data (StreamingHistory_music_*.json / _podcast_*.json): `endTime`
//     ("YYYY-MM-DD HH:MM", UTC), `msPlayed`. Only the last year.
// The export is a snapshot, so days after its last play are null, not 0 — same
// 0-vs-null rule as mac_minutes. Inside the span, a day with no plays is a real 0.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Local {date, hour} for an epoch ms in `timeZone`. */
export const localParts = (ms, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
};

export const nextDayKey = (k) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Normalised plays: { ms (start, epoch), msPlayed, podcast }. */
const readPlays = (dir) => {
  const plays = [];
  for (const f of readdirSync(dir)) {
    if (!/\.json$/i.test(f) || !/history/i.test(f)) continue;
    let rows;
    try {
      rows = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      console.warn(`  ! spotify: couldn't parse ${f}, skipping`);
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (r.ts != null && r.ms_played != null) {
        // `ts` is when the play ENDED; back up by its length to get the start.
        const end = Date.parse(r.ts);
        plays.push({ ms: end - r.ms_played, msPlayed: r.ms_played, podcast: !!r.episode_name });
      } else if (r.endTime != null && r.msPlayed != null) {
        const end = Date.parse(`${r.endTime.replace(' ', 'T')}:00Z`);
        plays.push({ ms: end - r.msPlayed, msPlayed: r.msPlayed, podcast: /podcast/i.test(f) });
      }
    }
  }
  return plays.filter((p) => Number.isFinite(p.ms) && p.msPlayed > 0);
};

/**
 * date -> { music_minutes, podcast_minutes, night_music_minutes }, or null when
 * SPOTIFY_HISTORY_DIR is unset or unreadable.
 *
 * night_music_minutes is music started 22:00–04:00 and is keyed like the sleep
 * fields: to the morning that night ENDS on, so it sits on the same row as the
 * bedtime it might have pushed back.
 */
export const buildSpotify = (dir, timeZone) => {
  if (!dir) return null;
  let plays;
  try {
    plays = readPlays(dir);
  } catch {
    console.warn(`  ! spotify: SPOTIFY_HISTORY_DIR not readable — spotify columns will be null`);
    return null;
  }
  if (!plays.length) {
    console.warn('  ! spotify: no plays found in SPOTIFY_HISTORY_DIR — spotify columns will be null');
    return null;
  }

  const days = new Map();
  const bump = (d, k, v) => {
    const row = days.get(d) ?? { music_minutes: 0, podcast_minutes: 0, night_music_minutes: 0 };
    row[k] += v;
    days.set(d, row);
  };
  for (const p of plays) {
    const { date, hour } = localParts(p.ms, timeZone);
    const min = p.msPlayed / 6e4;
    bump(date, p.podcast ? 'podcast_minutes' : 'music_minutes', min);
    if (!p.podcast && (hour >= 22 || hour < 4)) {
      bump(hour >= 22 ? nextDayKey(date) : date, 'night_music_minutes', min);
    }
  }

  const keys = [...days.keys()].sort();
  const first = keys[0];
  const last = localParts(Math.max(...plays.map((p) => p.ms)), timeZone).date;
  const out = new Map();
  // The last day is cut off wherever the export was requested, so it would read
  // as a light day — dropped, like focusd's in-progress day.
  for (let d = first; d < last; d = nextDayKey(d)) {
    const r = days.get(d) ?? { music_minutes: 0, podcast_minutes: 0, night_music_minutes: 0 };
    out.set(d, {
      music_minutes: Math.round(r.music_minutes),
      podcast_minutes: Math.round(r.podcast_minutes),
      night_music_minutes: Math.round(r.night_music_minutes),
    });
  }
  console.log(`  spotify (export)      ${String(out.size).padStart(5)} days  ${first} → ${last} (last day partial, dropped)`);
  return out;
};
