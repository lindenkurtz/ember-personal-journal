# Findings so far (template)

**This is the tracked template. The real file is `analysis/FINDINGS.md`, which is
gitignored** because it carries real health data. Copy this to `FINDINGS.md` on a
fresh checkout; it fills up one run at a time.

**Reference, not an agenda.** This exists so the same things don't get
rediscovered as news every run, and so results already killed don't come back.
It is not a checklist to work through, and it should not shape how the dashboard
is organized — the data should do that.

Worth a compact table near the end of the dashboard: what's held up, what hasn't,
where it stands now. Not a section, not a per-hypothesis walkthrough.

Explore freely. Something new and interesting beats another pass over the list
below.

---

## How to maintain this file

**This is state, not a report.** Three rules:

- **Append; don't rewrite past run lines.** Their whole value is that the
  hypothesis was fixed *before* the later data existed. Editing them retroactively
  turns a prediction into a postdiction and destroys the evidence.
- **Promote, don't publish.** An exploratory hit gets moved into the confirmatory
  register below to be retested on future data — it is never written up as a
  discovery on the run that found it.
- **Record the kills too.** "Dissolved" is the section that saves the most time;
  without it every run re-finds the same artifact.

---

## Held up so far

Relationships that have survived detrending, the obvious controls, and at least
one retest on fresh data.

| | n at last check | Notes |
|---|---|---|
| **_predictor → outcome_** | _n_ | _effect size, what it survives, what it doesn't, and the standing caveat_ |

## Corrected

Things that looked real and turned out to be a different relationship than they
appeared — usually mediated by a third variable. Say what the actual chain is.

## Dissolved — don't re-report as news

Things that went away under controls, or that the data can't distinguish. One
line each: what it looked like, and what it actually was.

## Worth checking when there's data

Hypotheses that are fixed but not yet testable — a field that starts too late, a
transition that hasn't happened yet, a comparison that needs more instances. Note
what specifically has to exist before the test is possible.

---

## Run log

One entry per analysis run. Date, n, and what changed in the picture — something
that held up, dissolved, or newly appeared. A few lines; don't restate the
dashboard.

- **Run 1 — _YYYY-MM-DD_.** n = _n_. _What was established or overturned._
