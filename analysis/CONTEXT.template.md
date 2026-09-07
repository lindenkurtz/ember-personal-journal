# Ember — data context (template)

**This is the tracked template. The real file is `analysis/CONTEXT.md`, which is
gitignored** because it carries real health data and identifying detail about the
subject. Copy this to `CONTEXT.md` on a fresh checkout and fill it in as you log.

Read this before analyzing anything. It exists so every analysis run starts from
the same cleaning decisions instead of re-inventing them and producing results
that aren't comparable between runs.

Maintained by hand. Update it whenever the schema changes or a new data-quality
problem is found.

---

## What this is

Daily self-tracking from a personal PWA (Ember). One row per day in `entries`,
plus separate tables for nutrition, body weight, lift progression, and screen
time.

Record here: when logging started, whether there are missing days, and any
standing facts about the subject's situation that shape the data (living
arrangement, work/school schedule, anything that changes mid-dataset). The model
can't infer these and will misread a structural break without them.

---

## Files in the bundle

| File | What it is |
|---|---|
| `daily_merged.csv` | **Use this for most analysis.** One row per day, cleaned, with derived fields. |
| `raw/*.csv` | Raw table dumps. Use for lifts, or to check something in `daily_merged`. |
| `MANIFEST.md` | Generated per export: date range, row counts, per-column coverage. |
| `FINDINGS.md` | What's already been tested and what held up. |
| `ANALYZE.md` | What to actually do. |

---

## Derived fields in `daily_merged.csv`

Computed by `scripts/export-analysis-bundle.mjs`, not stored in the database.
**This section and `buildDaily` are one spec written twice — change one, change
the other**, or successive runs quietly stop being comparable.

- **`sleep_dur_hours`** — from `bedtime` + `wake_time`. A bedtime before 12:00 is
  treated as after-midnight. Implausible values are **not** removed; see cleaning
  rules.
- **`bedtime_hours`** — bedtime on a continuous scale where 24 = midnight, 26 =
  2am. Use this rather than raw clock time; clock time wraps and breaks
  correlations.
- **`day_index`** — 0-based row counter. **Regress against this to detrend.**
- **`away_night_index`** — 1, 2, 3… for consecutive `slept_away` nights, null
  otherwise. Lets you test whether sleep recovers by night 2 or 3 of a trip
  rather than treating all away-nights as identical.
- **`next_sleep_quality` / `next_day_quality` / `next_gym`** — next-day values,
  but only when the next row is actually the following calendar day.
- **`social`** — the backward-compatible binary spanning the switch to the
  `social_level` ordinal: `social_level > 0` wherever a level exists, the raw
  boolean before that. `social_level` is the real column; `social` exists so the
  full span stays one column. The export warns, with dates, on any row whose level
  and boolean disagree.
- **`sick` / `sick_level`** — both emitted **raw**, and deliberately unlike
  `social` above: `sick` is not rebuilt from the level. `sick` is the long series
  and goes on meaning a major day across the split; `sick_level` is the finer
  three-state column that starts at the cutover. The export warns, with dates, on
  any row where the two disagree.
- **`context`** — resolved from `context_periods` by date.

## Cleaning rules already applied

- Days with `calories` under 1200 → all macros nulled (failed logging, not a real
  day).
- **A field that replaces a coarser one is never reconstructed from it.** Rows
  before the finer field's start date stay null — they were rated on the old scale,
  and deriving a level from a boolean would invent observations that were never
  made. Record the start date in the schema table and leave the nulls alone. (This
  is the same rule as `mac_minutes`' 0-vs-null.)
- **An ordinal is not automatically an interval.** Some levels are ordered by
  impact but name genuinely different kinds of day rather than doses of one thing.
  Where the schema table says so, compare the levels as separate categories against
  the baseline — never average them, and never read a coefficient on the level as a
  per-step effect.

Nothing else is removed. Bad values are left in on purpose: an implausible sleep
duration or a resting HR of 0 should be **flagged with its date** so it can be
fixed at the source, not silently dropped into a null. Exclude them from a
specific calculation if they'd distort it, and say that you did.

---

## Known data-quality problems

**These are real and will produce false findings if ignored.** This is the most
valuable section of the file — it's the guardrail that stops a run from reporting
an artifact as a discovery. Add to it the moment you notice something.

Worth recording for each: which fields, what the problem is, how it shows up in
the data, and what the analysis should do about it. The kinds that come up:

1. **A passive-sync source that drops out intermittently.** Note the coverage
   percentage and whether the gaps are a clean start/stop or scattered. If the
   correlations run backwards from known physiology, say so and set a bar for
   when the field becomes usable again.
2. **A retired field.** Which date it stopped meaning anything, and the date
   range it's still valid for. Exclude it from any analysis spanning past that.
3. **A field with very little variance.** It will produce weaker correlations for
   measurement reasons, not substantive ones. A null result on it is not
   evidence of no effect.
4. **Fields that are near-collinear** (e.g. calories and carbs). Not independent
   variables; don't report both as separate discoveries.
5. **Logging that starts late or pauses.** Distinguish "a gap in updating the
   source" from "a change in behavior" — they look identical in the data.
6. **Manually entered data with known upstream quirks.** Note which of several
   related columns is most trustworthy and why.
7. **An event type that had no field before some date.** Those days are invisible
   and silently depress whatever they affect.
8. **A coarse field split into a finer one mid-series.** The old column keeps
   running, but its rows before the split are undifferentiated — they silently
   contain whichever sub-states the split later separated. Note the cutover date,
   which side of the split the old column now tracks, and that a rate computed
   across the boundary is comparing two different definitions.
9. **A field that has saturated.** A boolean stuck at true (or an ordinal pinned to
   one level) under the subject's current circumstances has no variance left and
   cannot predict anything. Note the date it saturated and the context that caused
   it: findings on that field come only from the earlier rows where it still
   varied, they will not replicate going forward, and the analysis must say so
   rather than carry them as standing results. If a finer-grained replacement was
   added, note that it restarts at n = 0.

---

## Schema changes — start dates matter

New fields have different start dates, so coverage varies by design. **Every new
tracked field goes in this table** — coverage on a new field is low by
definition, and an undocumented one reads as a logging failure.

Check `MANIFEST.md` for actual counts before drawing conclusions from a short
series.

| Field | Added | Notes |
|---|---|---|
| _field_ | _YYYY-MM_ | _units, level definitions, null semantics_ |
| _field replacing a coarser one_ | _YYYY-MM-DD_ | _what the old column now means, and that its earlier rows are undifferentiated_ |

Also record definitions that aren't obvious from the field name — where the
boundary sits on an ordinal scale, what exactly counts as a `travel_day`, whether
a flag covers every night of a trip or just the first.

---

## Context periods

Resolved into the `context` column. A transition that changes sleep, food,
social patterns, and exercise access all at once is a natural experiment.

**Any correlation that holds across two contexts is far more credible than one
that only appears in a single context.** When there's enough data on both sides,
check key findings separately by context and say whether they replicate.

---

## Statistical standards for this dataset

Small-n observational data from one person, analyzed repeatedly. The defenses
that matter:

- **Report n for every claim.** Coverage varies enormously by column.
- **Detrend against `day_index`** before believing a correlation — several will
  be shared time trends.
- **Control for the obvious confound** when testing anything nutrition-related;
  intake tracks activity.
- **Correct for multiple comparisons** when scanning many pairs, and say how many
  you ran.
- **Prefer Spearman or a permutation test** for the 1–5 ordinal ratings at small n.
- **Never claim causation.** Name the plausible confound.

Do this work; don't render all of it. A finding that only survives without
controls isn't a finding — say it dissolved and move on.
