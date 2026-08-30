# Twenty ways an evaluation bench lies

Every one of these has appeared in a published model comparison. Most appear in
several. Each is listed with the failure, why it survives review, and the file
here that handles it — so the claim is checkable rather than asserted.

Six of them were found *in this code* — by its own tests, or by the first real
run against live models. Those are marked **[found here]**, because a list of
traps I avoided is worth less than a list of traps I fell into. Three of the six
only surfaced when synthetic providers were swapped for real ones, which is its
own lesson about how far a mock can take you.

---

### 1. Bare percentages, no intervals
90% at n=200 and 90% at n=20,000 are not the same claim, and printing them the
same way is the single most common defect in model comparisons.
→ `src/core/stats.ts` — Wilson intervals on every proportion. At 10/10 it
reports a lower bound of 0.72, not "100%".

### 2. Unpaired comparison of models that saw identical items
An unpaired two-proportion test discards most of the available power and mixes
between-item difficulty into the variance.
→ `stats.ts:pairCounts`, `mcnemarExact`. A worked case in the tests: 8 vs 0
discordant is significant, 8 vs 4 is not — identical headline gap.

### 3. No correction for multiplicity
Five models × three workloads × seven dimensions is over a hundred simultaneous
tests. At p<0.05 uncorrected you manufacture ~5 winners from noise, and those
are the ones that get quoted.
→ `stats.ts:holm`, applied per workload across the whole comparison family.

### 4. Benchmark contamination
Public eval sets are in the training data. Scores measure memorisation.
→ `src/workloads/corrupt.ts`. Every item is generated at run time from a seeded
model. These strings did not exist before the run.

### 5. Reporting mean latency
The mean hides the tail, and the tail is what breaks a workflow.
→ p95 everywhere, with a bootstrap interval, because a p95 at n=200 rests on
about ten observations.

### 6. **[found here, twice]** Your own scheduling counted as model latency
Rate limiting makes a provider look slow and you pick a worse model on the
strength of your own quota.
→ `src/adapters/http.ts` keeps `queueMs` and `serviceMs` separate.

Then the first real run committed the same sin in a place the HTTP layer cannot
see. Two local models ran concurrently, both reported a **12,757ms** median, and
neither was slow: they were taking turns on one GPU and the wait was inside the
measured request. Alone, the same model answers in **2,331ms**. A 5.5x
distortion, and it would have made every local column look unusable.

The first fix — one concurrency pool per model — was worthless, because the
contention is between *different* models sharing one device.
→ `ModelSpec.resourceGroup`. Every local model shares one lane; each hosted
provider gets its own. The lesson generalises: concurrency limits belong to the
**resource**, not the caller.

### 6b. **[found here]** A credential check that passes on a comment
`.env.example` shipped `GOOGLE_API_KEY=    # https://aistudio.google.com/apikey`.
The parser took everything after `=`, so the key was the comment string —
truthy. The bench therefore believed it held a Google credential, marked the run
`evidential: true`, **switched off the "not evidence" banner**, and would have
rendered a grid of 401 errors as a measurement. The same line broke `OLLAMA_HOST`
into an unusable URL.

Worse than a missing check, because it removed the warning that would have said
the data was fake.
→ `bench.ts:loadEnv` strips unquoted trailing comments, treats empty as unset,
and refuses any value containing whitespace.

### 7. Silent retries until the JSON parses
A harness that retries until valid is reporting a number that includes a fixer
the customer also has to run.
→ `src/core/runner.ts` allows exactly one repair pass and records `repairs` on
every attempt. The report shows the repair rate next to validity.

### 8. Refusals scored as wrong answers
"I don't know" and a confident wrong answer are different properties with
different remedies. Merging them flatters or punishes cautious models by turns.
→ `Attempt.correct` is `boolean | null`. Never coerced. Refusal rate reported
separately, and `pairCounts` drops the pair rather than guessing.

### 9. Cost measured per token
The cheapest model per token is regularly the most expensive per correctly
handled document.
→ `src/core/economics.ts` prices everything per resolved unit.

### 10. Ignoring calibration entirely
Accuracy without a usable confidence signal automates nothing, because you
cannot tell which answers to trust.
→ `src/core/calibrate.ts` — ECE, MCE, Brier, reliability curves.

### 11. Reporting ECE alone
**The subtle one.** A model that emits 0.87 on every item and is right 87% of
the time has a *flawless* ECE and is completely useless — no threshold separates
anything. Calibration without resolution is a well-behaved coin.
→ Murphy decomposition separates reliability from resolution; `resolutionRatio`
is reported per model, and the report calls out any model below 0.08 explicitly.
There is a test named after this one.

### 12. Fitting the calibrator on the data you report
Fit and evaluate on the same items and any model looks perfectly calibrated.
That is a leak, not a finding.
→ Every item carries `split: 'calib' | 'test'`. Isotonic is fit on the first,
reported on the second, and the fallback path is flagged when the split is thin.

### 13. **[found here]** Recalibrating away the ranking
Isotonic regression is *monotone*, so it can never improve ranking — and it can
destroy it, because pool-adjacent-violators merges distinct confidence values
into one and no threshold can separate them afterwards. Building the coverage
curve on recalibrated values reported all four models as "automates nothing"
when three cleared the budget comfortably on raw ordering.
→ `src/core/analyse.ts:SourceAnalysis`. Ranking (AURC, coverage curve) uses raw
ordering; calibration is reported before and after. The report shows AURC after
recalibration in its own column precisely so the degradation is visible.

### 14. **[found here]** Judging composed systems more leniently than single models
Single models were gated on the Wilson upper bound while cascades were gated on
the point estimate. Compositions are exactly what this bench argues for, so the
headline was partly an artefact of its own scoring.
→ `economics.ts:withinBudget` — one gate, every design.

### 15. Position and ordering bias
A model that partly reads the option list rather than the message will score
differently under a different ordering, and a fixed-order evaluation records the
ordering as capability.
→ `src/workloads/ticket/index.ts` shuffles options per item and reports accuracy
by the correct option's position.

### 15b. **[found here]** A grader that contradicts its own prompt
The system prompt said: *if the PIN cannot be determined, return an empty string
rather than guessing.* On `pin_missing` items the truth then demanded the
original PIN anyway. So a model that **followed the instruction was marked
wrong**, and one that happened to recall the right six digits was rewarded — for
memorising the India Post directory, which is not the task and not what a
deployment would ever rely on.

It cost qwen2.5 five of twelve items on the first real run. Accuracy went 3/12 →
8/12 on the fix, with no change to the model.
→ `workloads/address/index.ts` accepts abstention **or** correct inference when
the PIN is absent, and gives an invented PIN its own failure mode
(`hallucinated_pincode`) — because making up an address is a different defect
from misreading one, and only one of them is dangerous.

The general form: **read your prompt and your grader together, as one artefact.**
Any instruction the grader punishes is a trap you built and then walked into.

### 15c. A baseline that quietly holds the answer key
The no-model gazetteer scores 96.7% against 65.0% and 53.3% for two live
models — a 32-point gap in favour of not using AI. It is a real result and it is
not a fair fight: the resolver holds the same PIN directory the items were
generated from, while the models were given no reference data at all.

Both halves have to be said. Suppressing the caveat sells a rigged comparison;
suppressing the result hides the most useful thing the bench found. Stated
correctly it is stronger than either: **a prompt-only LLM is the wrong tool for
a lookup, which is a claim about deployment architecture rather than about model
quality.**
→ `adapters/gazetteer.ts` carries the caveat in its header, the report renders it
above the grid, and the missing third arm (models *with* the directory in
context) is named rather than quietly skipped.

### 15d. **[found here, three times]** Two parts of the analysis disagreeing about which items they mean
The same bug class, in three disguises, each one surviving the fix for the last:

1. Compositions gated on the point estimate while single models were gated on
   the Wilson upper bound. Fixed by making the **gate** uniform.
2. Compositions then scored on all 400 gradeable items while single models were
   scored on the 266-item test split. Same gate, different **data**.
3. And finally: `nAuto` taken from a curve built on 266 items, divided by an
   `nTotal` of 400. Same data, mismatched **denominator** — which understated
   every single model's coverage by a third and made compositions look like the
   only designs that could clear the budget. The gazetteer alone reaches 92%
   coverage; it was reported at 61%.

All three pointed the same way, toward the conclusion the bench was built to
argue for. That is what makes this class dangerous: the errors were not random,
they flattered the thesis, and each spot fix left the next one standing.

The structural answer is the **same-items rule**: no part of the analysis may
choose its own evaluation set. `evalSetFor()` and `evalAttempts` are now the only
definitions, and everything downstream takes what they return.

Corrected, the finding is the opposite of the one the bugs were manufacturing —
the cheapest design contains **no model at all**, and every cascade that adds one
ties or costs more.

### 16. Ground truth nobody audited
A wrong label is charged to whichever model was right and is invisible in every
chart downstream.
→ `node bench.ts audit --workload address` prints a sample for human checking.
`data/pincodes.json` carries an explicit provenance warning.

### 17. **[found here]** Corruption tags that did not fire
`unicode_mixed` finds no "Nagar" to replace, the item keeps the tag anyway, and
the per-corruption chart attributes accuracy to a perturbation that never
happened — confidently wrong in a way no reader could detect.
→ `corrupt.ts:applyCorruptions` returns the tags that *actually changed the
string*, and the item is labelled from those.

### 18. Ground truth that contradicts itself
"Bandra West, Tiruchirappalli" invites a model to infer Mumbai from the locality,
then marks it wrong for a sound inference.
→ `workloads/address/index.ts` keeps localities consistent with their city.

### 19. Confusing "cannot" with "cannot tell"
Certifying a 2% error budget needs ~150 clean observations (rule of three:
zero failures in n trials puts the 95% bound at about 3/n). Below that, "nothing
is automatable" is a statement about your sample size that reads as a statement
about the model.
→ `economics.ts:minItemsToCertify`, surfaced as a banner on any underpowered
grid, and `regress.ts:minimumDetectableEffect` printed beside every drift result.

### 20. Demo data that looks like measurement
The one that actually damages a company. A synthetic run screen-shared at speed
is indistinguishable from a real one.
→ Structural, not conventional: the mock provider stamps `provider: 'mock'` on
every attempt, the manifest flips `evidential` to false if a single such attempt
appears, live and mock providers can never appear on the same grid, and the
report renders a full-width banner plus an unsuppressable watermark. There is no
flag to turn it off.

---

## Still open

Named because a limits section that lists only solved problems is marketing.

- **The eval sets are synthetic.** Contamination-free and fully labelled by
  failure mode, at the cost of realism. The harness is the artefact; the numbers
  are a demonstration. Point it at three real deployments and the grid becomes a
  negotiating position.
- **Prompts are held constant across providers.** Fair, and it under-serves
  models that want a different prompt style. Per-model tuning would measure the
  tuning.
- **Temperature 0 is not determinism.** Re-runs differ. `drift` reports item
  churn separately from accuracy for exactly this reason.
- **Providers that enforce schemas server-side are not being measured on the
  same task** on the schema-adherence dimension. Flagged per model in the grid,
  not silently enjoyed.
- **One human labeller, no inter-annotator agreement**, because the labels are
  generated. Real workloads need two annotators and a reported kappa.
- **`gradeArithmetic` is weaker than the labelled grader.** The gap between them
  estimates what a production monitor would miss once the eval set is gone —
  worth measuring explicitly, currently only reported per item.
