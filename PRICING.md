# Pricing

Every rupee figure in the report is downstream of two numbers you must set
yourself, because both move and neither can be inferred:

1. **Model prices** — `data/pricing.json`. Seeded with placeholders marked
   `"verified": false`. Check each against the provider's own pricing page, set
   `verifiedOn`, flip `verified` to true. The report prints a warning for every
   unverified entry rather than quietly quoting it.

2. **Loaded labour cost** — `DEFAULT_ECONOMICS.wageInrPerHour` in
   `src/core/economics.ts`. Default ₹238/hour assumes a ~₹30,000/month ops
   associate over 176 productive hours with a 1.4× load for benefits, space,
   supervision and attrition. Every saving figure scales linearly with it, so it
   is stated on the report rather than buried here.

Also worth setting before quoting anything:

- `monthlyVolume` — units per month at the customer.
- `reviewFactorCorrect` / `reviewFactorWrong` — how long review takes relative to
  doing the work from scratch, for a right draft and a wrong one. The second is
  greater than 1 on purpose. Together they set the **draft-assist break-even
  accuracy** (~38% at the defaults) below which a model makes the process more
  expensive than a blank page.
- `reworkSecondsPerEscapedError` — per workload, on the `Workload` object. This
  is the asymmetry that stops the optimiser automating everything.
- `maxEscapedErrorRate` — the SLA. Applied to the Wilson **upper bound**, not the
  point estimate, so the bench under-promises.

Local inference via Ollama is priced at zero, which is a simplification: it costs
GPU time and electricity. Set a non-zero rate to compare like for like at scale.
