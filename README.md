# Systems Bench

Enterprise AI work divides once, and it divides hard: work with a right answer per
row, and work where nobody can say. The first is cheap to prove and easy to
benchmark, so it gets priced per unit. The second is where a deployment company
compounds, and the reason it stays open is that it is hard to prove.

**So proof is the product.** This is three of those problems, each with the
machinery it actually takes to show the work paid off.

> **Accounts below are hypothesised from public business models.** Nothing here is a
> claim about any company's actual systems, vendors, roadmap or performance, and no
> figure shown is theirs. Outcomes are simulated, because an eighteen-month lending
> cohort cannot be assembled for a demonstration. **The machinery is the artefact.**

| | account | unit of evaluation | method |
|---|---|---|---|
| **A** | MSME underwriting | the **cohort** | delayed-label backtest, selective labels |
| **B** | used-car pricing | the **policy** | off-policy evaluation, propensity corrected |
| **C** | collections | the **trajectory** | adversarial rollout over a horizon |

None can be graded item by item, and bringing that toolkit to them does not give a
worse number. It gives a confident number about the wrong quantity.

## The deck

**[ityaadiii.github.io/systems-bench](https://ityaadiii.github.io/systems-bench/)** — 29 slides.
Arrow keys or click to advance. Every chart in it is generated from a real run of the
code in this repo, not drawn.

## Run it

No build step. Node ≥22.6 strips the types. Zero runtime dependencies.

```bash
node bench.ts list                   # workloads and reachable models
node bench.ts scenarios --n 120      # the three archetypes
node --test src/core/*.test.ts       # 40 tests
```

With no API keys it runs a mock provider and **stamps every output non-evidential** —
a banner and a watermark with no flag to disable them. Add any subset to `.env` for
real measurements. Local models via Ollama are discovered automatically and cost
nothing.

## What it found

- **Underwriting** — the model emits so few distinct risk scores that the book can only
  run at **10%, 72% or 100%** approval, nothing between. The first thing to build is not
  a better model, it is a calibration layer that turns a coarse score into a dial.
- **Pricing** — fit a demand model on history and simulate a new policy through it and
  you will believe it earns **82% more than it does**. Effective sample: **15 of 115
  rows**. With no exploration in the log, the estimate collapses ₹5,617 → ₹342.
- **Collections** — three policies walked forward against the same simulated borrowers,
  because a logged test set has a policy already baked into its states.
- **Models split the workloads.** qwen2.5 7b wins underwriting, qwen3 8b wins
  collections. `qwen2.5:14b` was disqualified on measured latency: 72.8s per invoice,
  roughly 2,000 GPU-hours a month at volume.

## What it caught me doing

[`BLINDSPOTS.md`](BLINDSPOTS.md) lists twenty ways an evaluation bench lies, each mapped
to the file that handles it, and **nine defects this code was caught committing** — four
that surfaced only when simulated providers were replaced with real ones, and three that
all pointed toward the conclusion the bench was built to argue for.

A bench that only reports what worked is a brochure.

## Layout

```
bench.ts              CLI
src/scenarios/        three archetypes, three evaluation machines
src/core/             stats, calibration, economics, drift, runner
src/adapters/         one per provider, plus a mock that cannot pass as real
src/workloads/        earlier single-call workloads and their graders
docs/                 case study and deck, served by GitHub Pages
```

## Limits

Read [`BLINDSPOTS.md`](BLINDSPOTS.md) before quoting anything. Eval sets are synthetic,
`n` is small, ground truth is asserted rather than audited, and model prices in
`data/pricing.json` are unverified placeholders until you check them.

---

Built by **Aditi Singh**. Runs on a laptop, on local models, for ₹0.
