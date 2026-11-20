// Last.fm scrobbles, read live from the Last.fm API at export time — nothing stored.
//
// This is what keeps music data flowing after a Spotify privacy export's snapshot
// ends: connect Spotify to Last.fm once, and every play from then on is scrobbled.
// Set both in .env.local:
//   LASTFM_USER=<username>
//   LASTFM_API_KEY=<key from last.fm/api/account/create>  (read-only, free)
//
// A scrobble has a start time but no play length, so minutes are an estimate:
// each scrobble counts as its track's full duration (track.getInfo), or the median
// known duration when Last.fm has none. Last.fm scrobbles a track once half of it
// (or 4 minutes) has played, so skipped-past-halfway tracks read a little high
// against Spotify's exact ms_played. Podcasts aren't scrobbled at all.
//
// Coverage starts on the first scrobble's day — before that, an empty day means
// "not connected yet", not "listened to nothing". The export day is in progress
// and dropped, like every other source.

import { localParts, nextDayKey } from './spotify.mjs';

const API = 'https://ws.audioscrobbler.com/2.0/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Last.fm asks for at most ~5 requests a second per key.
let lastCall = 0;
const call = async (params) => {
  const wait = lastCall + 220 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const body = await res.json();
      if (body.error) throw new Error(`Last.fm error ${body.error}: ${body.message}`);
      return body;
    }
    if (res.status < 500 && res.status !== 429) throw new Error(`Last.fm HTTP ${res.status}`);
    await sleep(1000 * (attempt + 1));
  }
  throw new Error('Last.fm kept failing');
};

const readScrobbles = async (user, apiKey) => {
  const out = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const body = await call({ method: 'user.getrecenttracks', user, api_key: apiKey, limit: '200', page: String(page) });
    const rt = body.recenttracks;
    pages = Number(rt?.['@attr']?.totalPages ?? 1);
    for (const t of [].concat(rt?.track ?? [])) {
      // The now-playing entry has no date and hasn't been scrobbled yet.
      if (t['@attr']?.nowplaying || !t.date?.uts) continue;
      out.push({ ms: Number(t.date.uts) * 1000, artist: t.artist?.['#text'] ?? '', track: t.name ?? '' });
    }
  }
  return out;
};

const readDurations = async (scrobbles, apiKey) => {
  const durations = new Map();
  for (const s of scrobbles) {
    const key = `${s.artist}\u0000${s.track}`;
    if (durations.has(key)) continue;
    let ms = null;
    try {
      const body = await call({ method: 'track.getinfo', artist: s.artist, track: s.track, api_key: apiKey, autocorrect: '1' });
      const d = Number(body.track?.duration);
      ms = d > 0 ? d : null;
    } catch {
      // Unknown track — falls back to the median below.
    }
    durations.set(key, ms);
  }
  return durations;
};

/**
 * date -> { music_minutes, night_music_minutes }, or null when
 * LASTFM_USER / LASTFM_API_KEY are unset or the API can't be reached.
 * night_music_minutes is keyed to the morning the night ends on, as in spotify.mjs.
 */
export const buildLastfm = async (user, apiKey, timeZone, today) => {
  if (!user || !apiKey) return null;
  let scrobbles, durations;
  try {
    scrobbles = await readScrobbles(user, apiKey);
    if (!scrobbles.length) {
      console.warn('  ! lastfm: no scrobbles yet — is Spotify connected on last.fm? lastfm columns will be null');
      return null;
    }
    durations = await readDurations(scrobbles, apiKey);
  } catch (err) {
    console.warn(`  ! lastfm: ${err.message} — lastfm columns will be null`);
    return null;
  }

  const known = [...durations.values()].filter((v) => v != null).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 210_000;
  const unknown = [...durations.values()].filter((v) => v == null).length;

  const days = new Map();
  const row = (d) => days.get(d) ?? days.set(d, { music_minutes: 0, night_music_minutes: 0 }).get(d);
  for (const s of scrobbles) {
    const { date, hour } = localParts(s.ms, timeZone);
    const min = (durations.get(`${s.artist}\u0000${s.track}`) ?? fallback) / 6e4;
    const r = row(date);
    r.music_minutes += min;
    if (hour >= 22 || hour < 4) row(hour >= 22 ? nextDayKey(date) : date).night_music_minutes += min;
  }

  const first = localParts(Math.min(...scrobbles.map((s) => s.ms)), timeZone).date;
  const out = new Map();
  for (let d = first; d < today; d = nextDayKey(d)) {
    const r = days.get(d) ?? { music_minutes: 0, night_music_minutes: 0 };
    out.set(d, {
      music_minutes: Math.round(r.music_minutes),
      night_music_minutes: Math.round(r.night_music_minutes),
    });
  }
  console.log(
    `  lastfm (api)          ${String(out.size).padStart(5)} days  from ${first}, ${scrobbles.length} scrobbles` +
      (unknown ? `, ${unknown}/${durations.size} tracks at median length` : '')
  );
  return out;
};
