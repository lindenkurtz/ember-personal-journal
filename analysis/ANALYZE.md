# How to analyze this bundle

---

## Paste this into the chat

> I've uploaded an export from my personal daily-tracking app. Read `CONTEXT.md`
> first — it has the data dictionary, known quality problems, and the cleaning rules
> I've already settled on. Then read `FINDINGS.md`, which lists what's already been
> tested.
>
> Follow the protocol in `ANALYZE.md`: re-test the confirmatory register first, then
> do an exploratory pass clearly labeled as hypothesis-generating. Use
> `daily_merged.csv` as the primary table.
>
> Finish with an HTML dashboard and an updated findings block I can paste back into
> `FINDINGS.md`.
>
> Be skeptical. I'd rather hear "this dissolved under controls" than a list of
> impressive-looking correlations.

For a targeted question instead, swap the last two paragraphs for the question — but
still ask it to read `CONTEXT.md` first, or it will re-derive fields that are already
in `daily_merged.csv` and use different cleaning rules than the last run.

---

## Protocol

### Step 0 — Orient
Read `CONTEXT.md` and `FINDINGS.md`. Check `MANIFEST.md` for the date range and
per-column coverage. **Flag any column whose coverage dropped since the last run** —
that's a logging failure worth catching early, and it's the kind of thing that
silently ruins a dataset for months.

### Step 1 — Data quality check
Before any statistics:
- New missing days? Coverage changes? New impossible values?
- Has the Apple Health sync problem resolved (coverage up, sign problem reversed)?
- Any column that has quietly gone constant — the `deep_work` failure mode?

Report this first. A logging problem found early is worth more than any correlation.

### Step 2 — Confirmatory tests
Re-run every hypothesis in the confirmatory register, using the method specified
there. For each, report: n, raw r, detrended r, r with the specified controls, and
whether it still holds. Compare against the baseline in `FINDINGS.md` and say whether
it strengthened, weakened, or dissolved.

**These are the results that carry weight**, because they were specified before
seeing this run's data.

### Step 3 — Exploratory pass
Now hunt. Scan across the numeric columns, look at new fields, check interactions.

Requirements:
- **State how many tests you ran** and apply FDR correction.
- Detrend anything before believing it.
- **Label everything here as hypothesis-generating, not findings.** A promising
  exploratory result goes onto the confirmatory list to be tested on future data —
  it does not get reported as a discovery.
- Watch for the gym confound specifically (see `CONTEXT.md`).

### Step 4 — Free-text notes
Read the `note` column. In run 1 this resolved two mysteries that no amount of
statistics would have: why the deep-work field died, and when nutrition logging
started. Notes explain outliers. Read them.

### Step 5 — Output

**A. HTML dashboard**, single self-contained file. Sections in this order:
1. Data quality — coverage, gaps, anything that regressed
2. Confirmatory results — each hypothesis with its history and current status
3. Exploratory — clearly marked as speculative
4. Trajectory — weight, lifts, whatever's tracking over time
5. Open questions

Keep every reported n visible next to its correlation. Charts over tables where a
trend matters. No conclusion without its sample size attached.

**B. An updated findings block** to paste back into `FINDINGS.md`: a new run-log line,
status updates for each confirmatory hypothesis, any promotions from exploratory to
confirmatory, and anything newly dissolved.

Step 5B is what makes this a system rather than a series of disconnected analyses.
Don't skip it.

---

## Standing cautions

- **Small n.** Coverage varies enormously by column. Report it every time.
- **Repeated testing across runs.** The same variable pairs get scanned every run, so
  something will cross p < .05 by chance eventually. This is exactly why the
  confirmatory/exploratory split exists — respect it.
- **Everything is observational.** Never claim causation. Name the plausible confound.
- **Subjective ratings are 1–5 ordinals** with limited range, especially `day_quality`.
  A null result there may be a measurement ceiling, not an absence of effect.
- **Don't let a good story override a weak result.** If something dissolves under
  controls, that's the finding. Say so plainly.
