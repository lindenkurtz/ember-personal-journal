# Labeling calendar events for the export

The export never sends calendar text anywhere. It reduces events to hours per
category, and the categories come from `analysis/labels/calendar_labels.csv`
(gitignored, like everything else personal in `analysis/`). New event titles land
in `analysis/labels/calendar_unlabeled.csv` on every export, longest total time
first. Labeling them is a Claude Code job, not an API call.

## When

After an export prints `unlabeled calendar title(s)`. Re-run the export afterwards
so the new labels are applied. Recurring classes and work shifts are labeled once
and stay labeled.

## Paste this into Claude Code from the repo root

> Read `analysis/LABELING.md`, then `analysis/labels/calendar_unlabeled.csv`.
> For each row, choose one category from the list in LABELING.md and append a row
> to `analysis/labels/calendar_labels.csv` (create it with the header
> `calendar,title,category` if it doesn't exist). Use the calendar name, the
> title, the number of occurrences and the dates as evidence. Where a whole
> calendar is one category (holidays, birthdays, a shared calendar that isn't
> mine), add a single row with title `*` instead of one per event. Ask me about
> anything you can't place with reasonable confidence instead of guessing, and
> show me a summary of what you labeled at the end. Don't edit any other file and
> don't commit anything.

## Categories

| Category | Use for |
|---|---|
| `class` | lectures, labs, recitations — scheduled, not self-directed |
| `study` | blocked study or homework time, study groups, office hours attended to work |
| `work` | a job, internship or research position |
| `social` | plans with people |
| `exercise` | gym, runs, sport |
| `exam` | exams, midterms, quizzes |
| `deadline` | something due — usually an all-day event |
| `appointment` | doctor, dentist, haircut, anything personal with a time |
| `admin` | logistics meetings, advising |
| `other` | real time that fits none of the above |
| `ignore` | not part of the day: holidays, birthdays, other people's calendars, reminders stored as events |

Labels are matched on calendar + title, case-insensitive, whitespace collapsed.
Changing a label changes every past day that event appears on, so the meaning of
a category should stay fixed once a few exports have used it.
