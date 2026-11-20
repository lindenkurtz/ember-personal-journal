// Calendar time and completed Reminders, read locally at export time.
//
// Opt-in: set CALENDAR_EXPORT=1 in .env.local. On macOS this runs
// scripts/calendar-dump.swift (EventKit), so nothing is synced or stored — the
// same rule as focusd. Event titles never reach the bundle: they are reduced to
// hours per category, and the categories come from a label file that Claude Code
// (not the API) fills in. See analysis/LABELING.md.
//
// Label file: analysis/labels/calendar_labels.csv (gitignored with the rest of
// analysis/), columns calendar,title,category. A row whose title is `*` labels a
// whole calendar. Titles match case-insensitively with whitespace collapsed.
// Anything unlabeled is counted under cal_unlabeled_h and listed in
// analysis/labels/calendar_unlabeled.csv for the next labeling pass.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CATEGORIES = [
  'class', // lectures, labs, sections — scheduled and not self-directed
  'study', // blocked study / homework / office hours you attend to work
  'work', // job, internship, research position
  'social', // plans with people
  'exercise', // gym, runs, sport
  'exam', // exams and quizzes
  'deadline', // something due (often all-day)
  'appointment', // doctor, haircut, errands with a time
  'admin', // meetings about logistics, advising
  'other',
  'ignore', // holidays, birthdays, reminders-as-events, other people's calendars
];

const HOURS_COLS = ['class', 'study', 'work', 'social', 'exercise'];

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Minimal RFC 4180 reader — titles carry commas and quotes. */
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
};

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const loadLabels = (path) => {
  const labels = new Map();
  if (!existsSync(path)) return labels;
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  const idx = (k) => header.map(norm).indexOf(k);
  const [ci, ti, ki] = [idx('calendar'), idx('title'), idx('category')];
  for (const r of rows) {
    const cat = norm(r[ki]);
    if (!CATEGORIES.includes(cat)) {
      console.warn(`  ! calendar label "${r[ti]}" has unknown category "${r[ki]}" — treated as unlabeled`);
      continue;
    }
    labels.set(`${norm(r[ci])}\u0000${norm(r[ti])}`, cat);
  }
  return labels;
};

/** Total minutes covered by a set of [start, end) intervals, overlaps counted once. */
const unionMinutes = (spans) => {
  const s = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of s) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
};

const addDays = (k, n) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const APP_NAME = 'Ember Calendar Export';

// The usage strings are the text of the permission prompt. Both generations of
// key: the Full Access ones are what macOS 14+ checks, the older ones cover 13.
const APP_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>local.ember.calendar-export</string>
  <key>CFBundleName</key><string>${APP_NAME}</string>
  <key>CFBundleExecutable</key><string>calendar-dump</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSCalendarsFullAccessUsageDescription</key><string>The Ember analysis export reduces calendar events to hours per category, locally.</string>
  <key>NSCalendarsUsageDescription</key><string>The Ember analysis export reduces calendar events to hours per category, locally.</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>The Ember analysis export counts completed reminders per day, locally.</string>
  <key>NSRemindersUsageDescription</key><string>The Ember analysis export counts completed reminders per day, locally.</string>
</dict>
</plist>
`;

/**
 * Builds scripts/calendar-dump.swift into a minimal app bundle, once per change
 * to the source, and returns its path.
 *
 * macOS 14+ only shows the Calendar/Reminders prompt when the *responsible*
 * process — the terminal, for anything run from a shell — declares the Full
 * Access usage keys. Terminals don't (iTerm2 carries only the pre-14 keys,
 * Terminal and VS Code none), so `swift calendar-dump.swift` is denied without
 * ever asking. Launched through `open`, the bundle is its own responsible
 * process, so the prompt names it and the grant sticks to it, whichever terminal
 * ran the export. It's ad-hoc signed, and macOS ties the grant to that
 * signature, so editing the Swift file means approving the prompt once more.
 */
const helperApp = (root) => {
  const src = join(root, 'scripts', 'calendar-dump.swift');
  const stamp = createHash('sha256').update(readFileSync(src)).update(APP_PLIST).digest('hex');
  const app = join(root, 'node_modules', '.cache', 'ember-calendar', 'EmberCalendar.app');
  const stampFile = join(app, 'Contents', 'Resources', 'source.sha256');
  if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) return app;

  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'Info.plist'), APP_PLIST);
  // Written before signing so the seal covers it.
  writeFileSync(stampFile, stamp);
  console.log('  building calendar helper (once per change to calendar-dump.swift)…');
  try {
    execFileSync('swiftc', ['-O', src, '-o', join(app, 'Contents', 'MacOS', 'calendar-dump')], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    // swiftc already ad-hoc signs the bare binary, so codesign's stderr is just
    // "replacing existing signature"; a real failure still throws on exit status.
    execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'ignore' });
  } catch (e) {
    // Otherwise the stamp would vouch for a half-built bundle on the next run.
    rmSync(app, { recursive: true, force: true });
    throw e;
  }
  return app;
};

/**
 * date -> calendar/reminder columns, or null when disabled or unavailable.
 * `dates` is every journal date; values are a real 0 on any date in range with
 * nothing scheduled.
 */
export const buildCalendar = ({ root, dates, enabled }) => {
  if (!enabled) return null;
  if (process.platform !== 'darwin') {
    console.warn('  ! CALENDAR_EXPORT is set but this isn’t macOS — calendar columns will be null');
    return null;
  }
  const from = dates[0];
  // Today is still in progress; stop at yesterday like every other source.
  const to = addDays(new Date().toLocaleDateString('en-CA'), -1);

  let app;
  try {
    app = helperApp(root);
  } catch {
    console.warn('  ! couldn’t build calendar-dump.swift (are Xcode’s command-line tools installed?) — calendar columns will be null');
    return null;
  }
  let dump;
  const tmp = mkdtempSync(join(tmpdir(), 'ember-calendar-'));
  try {
    const outFile = join(tmp, 'out.json');
    const errFile = join(tmp, 'err.txt');
    // -W waits for the helper to exit, which includes any permission prompt.
    execFileSync(
      'open',
      ['-W', '-n', '-g', '--stdout', outFile, '--stderr', errFile, '-a', app, '--args', from, to],
      { stdio: ['ignore', 'ignore', 'inherit'] }
    );
    const err = existsSync(errFile) ? readFileSync(errFile, 'utf8').trim() : '';
    for (const line of err ? err.split('\n') : []) console.warn(`  ! calendar helper: ${line}`);
    dump = JSON.parse(readFileSync(outFile, 'utf8'));
  } catch {
    console.warn('  ! calendar helper failed — calendar columns will be null');
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (!dump.events_access || !dump.reminders_access) {
    console.warn(
      `  ! allow "${APP_NAME}" under System Settings → Privacy & Security → ` +
        `${[!dump.events_access && 'Calendars', !dump.reminders_access && 'Reminders'].filter(Boolean).join(' and ')}, ` +
        'then re-run the export'
    );
  }

  const labelDir = join(root, 'analysis', 'labels');
  const labels = loadLabels(join(labelDir, 'calendar_labels.csv'));
  const labelFor = (ev) =>
    labels.get(`${norm(ev.calendar)}\u0000${norm(ev.title)}`) ??
    labels.get(`${norm(ev.calendar)}\u0000*`) ??
    null;

  const byDay = new Map();
  const unlabeled = new Map();
  for (const ev of dump.events ?? []) {
    const cat = labelFor(ev);
    if (cat === 'ignore') continue;
    const day = byDay.get(ev.date) ?? { spans: [], hours: {}, unlabeledMin: 0, deadline: false };
    byDay.set(ev.date, day);
    if (cat === 'exam' || cat === 'deadline') day.deadline = true;
    if (!cat) {
      const key = `${ev.calendar}\u0000${ev.title}`;
      const u = unlabeled.get(key) ?? { calendar: ev.calendar, title: ev.title, n: 0, min: 0, first: ev.date, last: ev.date };
      u.n++;
      if (!ev.all_day) u.min += ev.end_min - ev.start_min;
      if (ev.date < u.first) u.first = ev.date;
      if (ev.date > u.last) u.last = ev.date;
      unlabeled.set(key, u);
    }
    if (ev.all_day) continue;
    const min = ev.end_min - ev.start_min;
    day.spans.push([ev.start_min, ev.end_min]);
    if (!cat) day.unlabeledMin += min;
    else day.hours[cat] = (day.hours[cat] ?? 0) + min;
  }

  const remByDay = new Map();
  for (const r of dump.reminders ?? []) remByDay.set(r.date, (remByDay.get(r.date) ?? 0) + 1);

  const h = (min) => Number((min / 60).toFixed(2));
  const out = new Map();
  for (const d of dates) {
    if (d > to) continue;
    const day = byDay.get(d);
    const row = {};
    if (dump.events_access) {
      for (const c of HOURS_COLS) row[`cal_${c}_h`] = h(day?.hours[c] ?? 0);
      row.cal_other_h = h(
        (day?.hours.appointment ?? 0) + (day?.hours.admin ?? 0) + (day?.hours.other ?? 0) +
          (day?.hours.exam ?? 0) + (day?.hours.deadline ?? 0)
      );
      row.cal_unlabeled_h = h(day?.unlabeledMin ?? 0);
      row.cal_busy_h = h(unionMinutes(day?.spans ?? []));
      row.cal_events = day?.spans.length ?? 0;
      const starts = (day?.spans ?? []).map((s) => s[0]);
      const ends = (day?.spans ?? []).map((s) => s[1]);
      row.cal_first_start_hours = starts.length ? h(Math.min(...starts)) : null;
      row.cal_last_end_hours = ends.length ? h(Math.max(...ends)) : null;
      // Objective counterpart to deadline_pressure: an exam or deadline today or
      // in the next two days. Looks ahead past `to` only as far as the dump went.
      row.cal_deadline_48h = [0, 1, 2].some((k) => byDay.get(addDays(d, k))?.deadline) ? 1 : 0;
    }
    if (dump.reminders_access) row.reminders_done = remByDay.get(d) ?? 0;
    out.set(d, row);
  }

  mkdirSync(labelDir, { recursive: true });
  const list = [...unlabeled.values()].sort((a, b) => b.min - a.min || b.n - a.n);
  writeFileSync(
    join(labelDir, 'calendar_unlabeled.csv'),
    ['calendar,title,occurrences,hours,first_date,last_date']
      .concat(list.map((u) => [u.calendar, u.title, u.n, h(u.min), u.first, u.last].map(csvCell).join(',')))
      .join('\n') + '\n'
  );

  const unlabeledHours = h(list.reduce((s, u) => s + u.min, 0));
  console.log(
    `  calendar (EventKit)   ${String(out.size).padStart(5)} days  ${(dump.events ?? []).length} event-days, ` +
      `${(dump.reminders ?? []).length} reminders done`
  );
  if (list.length) {
    console.warn(
      `  ! ${list.length} unlabeled calendar title(s), ${unlabeledHours}h — ` +
        'see analysis/labels/calendar_unlabeled.csv and analysis/LABELING.md'
    );
  }
  return out;
};
