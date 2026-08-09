# How to analyze this bundle

---

## Paste this into the chat

> I've uploaded a zipped export from my personal daily-tracking app. Unzip it and
> read `CONTEXT.md` before touching the data — it has the data dictionary and the
> known quality problems. Skim `ANALYZE.md` for what I want out of this, and
> `FINDINGS.md` for what's already been looked at.
>
> Then explore the data and build me an HTML dashboard presenting some analysis + 
> some of my patterns + whatever else is interesting/impactful.
>
> Be skeptical, use plain language, and put a sample size next to anything you claim.

For a targeted question, replace the middle line with the question. Still point at
`CONTEXT.md` first, or the cleaning rules get re-invented differently each run.

---

## What this is for

A picture of how I've actually been living — sleep, training, food, phone, mood,
and how they move together. Interesting is as valuable as significant. I draw my
own conclusions from it; the dashboard's job is to show me what's there, not to
tell me what to change.

Organize around what the data actually shows. Let the sections come from the data,
not from a template: probably some by area (sleep, gym, food, body) and some by
relationship (sleep vs. gym, food vs. sleep, phone vs. bedtime). Cross-dataset
connections are often the most interesting part — go looking for them.

Compare across months, contexts, seasons, or whatever period fits what you're
showing. Don't organize around "what changed since the last run" — the gap between
runs is arbitrary and usually too short to mean anything.

## What makes it good

**Plain language.** Report r and n and p — those matter — but say what a result
means in a sentence. "Holds up on this sample" and "only 5 days on the smaller
side, unreadable" beat a table of partial correlations. Skip the jargon that
doesn't change what the reader does with the number.

**Good charts.** A distribution, a day-of-week breakdown, a timeline with the
notable days marked — simple charts carry a lot. A well-chosen number with context
around it is often better than a chart. Make it something worth looking at.

**Honest sizing.** Every claim carries its n. Say plainly when something is too
thin to read. A short section that says "not enough data yet" is fine.

**Proportion.** Big, well-supported patterns get space. A narrow result on 20 days
gets a few sentences, however statistically clean it is.

## Rigor, mostly invisible

Do the work, show the conclusion:

- Detrend against `day_index` before trusting a correlation — some in this dataset
  are shared time trends.
- Control for `gym` when testing nutrition; intake runs higher on gym days.
- Correct for multiple comparisons when scanning many pairs. Say how many you ran.
- Prefer Spearman or a permutation test for the 1–5 ratings at small n.
- Never claim causation. Name the plausible confound in a sentence.

The reader doesn't need every control step rendered. If something dissolves under
controls, say it dissolved and move on.

## Data quality

Check coverage and look for impossible values, columns that have quietly gone
constant, and logging that stopped. Report it briefly near the top — a few lines,
not a section. I'll usually already know; it's context for reading the rest, not a
finding. Never silently drop a bad value: flag it with its date so I can fix it at
the source.

## Output

**An HTML dashboard**, single self-contained file.

**A short findings block** to paste into `FINDINGS.md`: a run-log line, plus
anything that changed the picture — something that held up, dissolved, or newly
appeared. A few lines. Don't restate the dashboard.