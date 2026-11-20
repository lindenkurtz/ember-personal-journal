// Daylight and sunset, computed — no network, no stored data.
//
// Standard sunrise equation (the one NOAA's simplified calculator uses), good to
// a minute or two at mid latitudes, which is far finer than anything this gets
// correlated against. Coordinates come from push_settings at export time and are
// never written into the bundle: only the derived hours are.

const rad = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545.0;

const toJulian = (ms) => ms / 864e5 + J1970;
const fromJulian = (j) => (j - J1970) * 864e5;

/**
 * Sunrise/sunset for a local date key, as epoch ms. Longitude is east-positive.
 * Returns { rise: null, set: null, polar: 'night' | 'day' } inside the polar
 * circles on days the sun never crosses the horizon.
 */
export const sunTimes = (dateKey, lat, lon) => {
  const n = Math.round(toJulian(Date.parse(`${dateKey}T12:00:00Z`)) - J2000 + 0.0008);
  const meanNoon = n - lon / 360;
  const M = (357.5291 + 0.98560028 * meanNoon) % 360;
  const C =
    1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = J2000 + meanNoon + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  // -0.833° = refraction plus the sun's radius: "sunrise" is the upper limb.
  const cosW =
    (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) /
    (Math.cos(lat * rad) * Math.cos(dec));
  if (cosW > 1) return { rise: null, set: null, polar: 'night' };
  if (cosW < -1) return { rise: null, set: null, polar: 'day' };
  const w = Math.acos(cosW) / rad;
  return { rise: fromJulian(transit - w / 360), set: fromJulian(transit + w / 360), polar: null };
};

/** Epoch ms → decimal local clock hours in `timeZone` (17.5 = 5:30pm). */
const localHours = (ms, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') + get('minute') / 60;
};

/** date -> { daylight_hours, sunset_hours }, or null when coordinates are unset. */
export const buildDaylight = (dates, { latitude, longitude, timezone }) => {
  if (latitude == null || longitude == null) {
    console.warn('  ! push_settings has no coordinates — daylight columns will be null');
    return null;
  }
  const out = new Map();
  for (const d of dates) {
    const { rise, set, polar } = sunTimes(d, latitude, longitude);
    out.set(d, {
      daylight_hours:
        polar === 'night' ? 0 : polar === 'day' ? 24 : Number(((set - rise) / 36e5).toFixed(2)),
      sunset_hours: set == null ? null : Number(localHours(set, timezone).toFixed(2)),
    });
  }
  console.log(`  daylight (computed)   ${String(out.size).padStart(5)} days`);
  return out;
};
