// Dumps Calendar events and completed Reminders for a date range as JSON on
// stdout, for scripts/sources/calendar.mjs. macOS only. Takes FROM and TO as
// YYYY-MM-DD, inclusive.
//
// The export compiles this into a small app bundle and launches it through
// `open`, so the Calendar and Reminders prompts name that app rather than the
// terminal. Run directly with `swift` from a shell, macOS 14+ denies access
// without prompting — see helperApp in calendar.mjs. Everything stays local: the
// export reduces it to daily aggregates before anything reaches the bundle.
//
// Events are split at local midnight so each record belongs to one day, and
// times are minutes since that local midnight. Cancelled events and ones you
// declined are skipped — they were on the calendar but not in the day.

import EventKit
import Foundation

func fail(_ msg: String, _ code: Int32) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

let args = CommandLine.arguments
guard args.count == 3 else { fail("usage: calendar-dump.swift FROM TO (YYYY-MM-DD, inclusive)", 2) }

let cal = Calendar.current
let dayFmt = DateFormatter()
dayFmt.calendar = Calendar(identifier: .gregorian)
dayFmt.locale = Locale(identifier: "en_US_POSIX")
dayFmt.timeZone = TimeZone.current
dayFmt.dateFormat = "yyyy-MM-dd"

guard let from = dayFmt.date(from: args[1]), let lastDay = dayFmt.date(from: args[2]) else {
    fail("dates must be YYYY-MM-DD", 2)
}
let to = cal.date(byAdding: .day, value: 1, to: lastDay)!

let store = EKEventStore()

func requestAccess(_ type: EKEntityType) -> Bool {
    let sem = DispatchSemaphore(value: 0)
    var granted = false
    let done: (Bool, Error?) -> Void = { ok, _ in
        granted = ok
        sem.signal()
    }
    if #available(macOS 14.0, *) {
        if type == .event { store.requestFullAccessToEvents(completion: done) }
        else { store.requestFullAccessToReminders(completion: done) }
    } else {
        store.requestAccess(to: type, completion: done)
    }
    sem.wait()
    return granted
}

var events: [[String: Any]] = []
let eventsOK = requestAccess(.event)
if eventsOK {
    // EventKit caps one predicate at four years; chunk by year to stay well inside it.
    var chunkStart = from
    while chunkStart < to {
        let chunkEnd = min(cal.date(byAdding: .year, value: 1, to: chunkStart)!, to)
        let pred = store.predicateForEvents(withStart: chunkStart, end: chunkEnd, calendars: nil)
        for ev in store.events(matching: pred) {
            if ev.status == .canceled { continue }
            if let me = ev.attendees?.first(where: { $0.isCurrentUser }), me.participantStatus == .declined {
                continue
            }
            let title = ev.title ?? ""
            let calendarName = ev.calendar?.title ?? ""
            // Clip to this chunk so an event spanning a chunk edge isn't emitted twice.
            var s = max(ev.startDate, chunkStart)
            let e = min(ev.endDate, chunkEnd)
            while s < e {
                let dayStart = cal.startOfDay(for: s)
                let next = cal.date(byAdding: .day, value: 1, to: dayStart)!
                let segEnd = min(e, next)
                var rec: [String: Any] = [
                    "date": dayFmt.string(from: dayStart),
                    "title": title,
                    "calendar": calendarName,
                    "all_day": ev.isAllDay,
                ]
                if !ev.isAllDay {
                    rec["start_min"] = Int(s.timeIntervalSince(dayStart) / 60)
                    rec["end_min"] = Int(segEnd.timeIntervalSince(dayStart) / 60)
                }
                events.append(rec)
                s = segEnd
            }
        }
        chunkStart = chunkEnd
    }
} else {
    FileHandle.standardError.write("calendar access denied — no events\n".data(using: .utf8)!)
}

var reminders: [[String: Any]] = []
let remindersOK = requestAccess(.reminder)
if remindersOK {
    let sem = DispatchSemaphore(value: 0)
    let pred = store.predicateForCompletedReminders(
        withCompletionDateStarting: from, ending: to, calendars: nil)
    store.fetchReminders(matching: pred) { found in
        for r in found ?? [] {
            guard let done = r.completionDate else { continue }
            reminders.append([
                "date": dayFmt.string(from: done),
                "list": r.calendar?.title ?? "",
            ])
        }
        sem.signal()
    }
    sem.wait()
} else {
    FileHandle.standardError.write("reminders access denied — no reminders\n".data(using: .utf8)!)
}

// The access flags let the export tell "no events" (a real 0) from "couldn't
// look" (null) — the same 0-vs-null line every other source holds.
let out: [String: Any] = [
    "events_access": eventsOK,
    "reminders_access": remindersOK,
    "events": events,
    "reminders": reminders,
]
let data = try! JSONSerialization.data(withJSONObject: out, options: [])
FileHandle.standardOutput.write(data)
