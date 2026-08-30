/**
 * Economics.
 *
 * Cost per resolved unit, never cost per token. A token price tells you nothing
 * about whether a deployment pays; a model can be cheapest per token and most
 * expensive per correctly-handled document, because everything it gets wrong is
 * paid for twice — once to catch it and once to undo it.
 *
 * Four asymmetries drive every number here. All four are routinely left out of
 * enterprise ROI models, and leaving them out is most of why those models are
 * wrong in both directions at once.
 *
 *  1. Reviewing a CORRECT draft is much faster than doing the work from
 *     scratch. Omitting this understates a mediocre model.
 *  2. Reviewing a WRONG draft is SLOWER than from scratch — the reviewer has to
 *     detect the error before fixing it, against an anchor pulling the other
 *     way. Omitting this is the big one: it is why a weak model can raise the
 *     cost of a process it was bought to reduce, and why there is a break-even
 *     accuracy below which draft-assist is value-destroying.
 *  3. An error that ESCAPES review costs far more than one caught in review. A
 *     wrong serviceability call is a failed delivery. This is why optimal
 *     auto-approve coverage is never 100%.
 *  4. You still pay for inference on everything you end up reviewing anyway.
 *
 * The last section stops comparing models and starts composing them, because a
 * two-stage cascade routinely beats every single model on the frontier and no
 * leaderboard can tell you that.
 */

import type { CoveragePoint } from './calibrate.ts';
import { wilson } from './stats.ts';

export type EconomicsConfig = {
  /** Units per month for this workload at the customer. */
  monthlyVolume: number;
  /**
   * Fully-loaded hourly cost of whoever does this today, in INR. Default assumes
   * a ~30k/month ops associate over 176 productive hours with a 1.4x load for
   * benefits, space, supervision and attrition. State it, never bury it: every
   * rupee downstream is proportional to this one number.
   */
  wageInrPerHour: number;
  usdInr: number;
  /** Review time for a CORRECT draft, as a fraction of from-scratch time. */
  reviewFactorCorrect: number;
  /** Review time for a WRONG draft. Greater than 1 on purpose. */
  reviewFactorWrong: number;
  /** The SLA: escaped-error rate must stay at or under this. */
  maxEscapedErrorRate: number;
  /** Use the upper confidence bound on risk rather than the point estimate. */
  conservative: boolean;
};

export const DEFAULT_ECONOMICS: EconomicsConfig = {
  monthlyVolume: 100_000,
  wageInrPerHour: 238,
  usdInr: 88,
  reviewFactorCorrect: 0.35,
  reviewFactorWrong: 1.4,
  maxEscapedErrorRate: 0.02,
  conservative: true,
};

/**
 * Accuracy below which putting a draft in front of a reviewer costs more than
 * giving them a blank page. Falls straight out of the two review factors:
 * a·fC + (1−a)·fW < 1. At the defaults this is about 38%.
 *
 * Worth computing for every prospect before promising them anything.
 */
export const draftAssistBreakEven = (cfg: EconomicsConfig): number =>
  (cfg.reviewFactorWrong - 1) / (cfg.reviewFactorWrong - cfg.reviewFactorCorrect);

export type ItemOutcome = {
  itemId: string;
  correct: boolean | null;
  conf: number;
  costUsd: number;
};

export type Deployment = {
  name: string;
  design: 'manual' | 'single' | 'cascade' | 'duet';
  models: string[];
  thresholds: number[];
  coverage: number;
  escapedErrorRate: number;
  inferenceInr: number;
  reviewInr: number;
  reworkInr: number;
  totalInr: number;
  savingsInr: number;
  savingsPct: number;
  costPerResolvedUnitInr: number;
  humanHoursPerMonth: number;
  feasible: boolean;
  note?: string;
};

const inrPerSecond = (cfg: EconomicsConfig) => cfg.wageInrPerHour / 3600;

/**
 * The error-budget gate, applied identically to every design.
 *
 * Single models were originally gated on the Wilson upper bound while cascades
 * were gated on the point estimate, which handed compositions a laxer standard
 * than the models they were being compared against — and compositions are
 * exactly what this file exists to argue for. Same gate for everyone, or the
 * headline is an artefact of the scoring.
 */
const withinBudget = (cfg: EconomicsConfig, escaped: number, nAuto: number): boolean => {
  if (nAuto === 0) return false;
  const risk = cfg.conservative ? wilson(escaped, nAuto).hi : escaped / nAuto;
  return risk <= cfg.maxEscapedErrorRate;
};

/**
 * Items needed to certify an error budget at all, with a perfect run.
 *
 * Rule of three: observing zero failures in n trials puts the 95% upper bound at
 * about 3/n. So a 2% budget cannot be demonstrated on fewer than ~150 clean
 * items no matter how good the model is — the evidence does not exist at that
 * sample size. A bench that reports "nothing is automatable" without separating
 * "the model cannot" from "this eval set cannot tell" is blaming the model for
 * its own sample size.
 */
export const minItemsToCertify = (maxRisk: number): number => Math.ceil(3 / maxRisk);

export function manualBaseline(cfg: EconomicsConfig, humanSecondsPerUnit: number): Deployment {
  const hours = (cfg.monthlyVolume * humanSecondsPerUnit) / 3600;
  const cost = hours * cfg.wageInrPerHour;
  return {
    name: 'Manual today', design: 'manual', models: [], thresholds: [],
    coverage: 0, escapedErrorRate: 0,
    inferenceInr: 0, reviewInr: cost, reworkInr: 0, totalInr: cost,
    savingsInr: 0, savingsPct: 0,
    costPerResolvedUnitInr: cost / cfg.monthlyVolume,
    humanHoursPerMonth: hours, feasible: true,
  };
}

type PriceOpts = {
  nTotal: number;
  nAuto: number;
  nEscapedErrors: number;
  /** Of the items a human reviews, how many carried a wrong draft. */
  nReviewedErrors: number;
  inferenceUsdPerUnit: number;
};

function price(
  cfg: EconomicsConfig,
  humanSecondsPerUnit: number,
  reworkSecondsPerEscapedError: number,
  o: PriceOpts,
): Omit<Deployment, 'name' | 'design' | 'models' | 'thresholds' | 'feasible'> {
  const V = cfg.monthlyVolume;
  const coverage = o.nTotal ? o.nAuto / o.nTotal : 0;
  const escapedErrorRate = o.nAuto ? o.nEscapedErrors / o.nAuto : 0;
  const nReviewed = o.nTotal - o.nAuto;
  // With nothing reviewed there is no draft-quality evidence. Assuming the
  // drafts are perfect (share = 0) is the optimistic default and it silently
  // credited a model that scored NOTHING with a 65% saving. Unknown means
  // assume the worse of the two, and say so upstream.
  const wrongDraftShare = nReviewed > 0 ? o.nReviewedErrors / nReviewed : (o.nTotal === 0 ? 1 : 0);

  const inferenceInr = o.inferenceUsdPerUnit * cfg.usdInr * V;

  const reviewedUnits = V * (1 - coverage);
  const factor = (1 - wrongDraftShare) * cfg.reviewFactorCorrect + wrongDraftShare * cfg.reviewFactorWrong;
  const reviewSeconds = reviewedUnits * humanSecondsPerUnit * factor;
  const reviewInr = reviewSeconds * inrPerSecond(cfg);

  const escapedUnits = V * coverage * escapedErrorRate;
  const reworkSeconds = escapedUnits * reworkSecondsPerEscapedError;
  const reworkInr = reworkSeconds * inrPerSecond(cfg);

  const totalInr = inferenceInr + reviewInr + reworkInr;
  const baseline = manualBaseline(cfg, humanSecondsPerUnit).totalInr;

  return {
    coverage, escapedErrorRate, inferenceInr, reviewInr, reworkInr, totalInr,
    savingsInr: baseline - totalInr,
    savingsPct: baseline > 0 ? (baseline - totalInr) / baseline : 0,
    costPerResolvedUnitInr: totalInr / V,
    humanHoursPerMonth: (reviewSeconds + reworkSeconds) / 3600,
  };
}

// ------------------------------------------------------------- single model

export function optimiseSingle(
  cfg: EconomicsConfig,
  humanSecondsPerUnit: number,
  reworkSecondsPerEscapedError: number,
  outcomes: ItemOutcome[],
  curve: CoveragePoint[],
  label: string,
): Deployment {
  const gradeable = outcomes.filter((o) => o.correct !== null);
  const n = gradeable.length;
  const totalErrors = gradeable.filter((o) => o.correct === false).length;
  const usdPerUnit = n ? gradeable.reduce((a, o) => a + o.costUsd, 0) / n : 0;

  // Nothing scored. Report that, rather than pricing a deployment out of an
  // empty set — every cost below would be an assumption wearing a number.
  if (n === 0) {
    const base = manualBaseline(cfg, humanSecondsPerUnit);
    return {
      name: label, design: 'single', models: [label], thresholds: [], feasible: false,
      note: `Nothing was gradeable for this model on this workload — every attempt was refused, malformed, or failed. No cost can be estimated from zero observations, so the figure shown is the manual baseline unchanged.`,
      coverage: 0, escapedErrorRate: 0,
      inferenceInr: 0, reviewInr: base.totalInr, reworkInr: 0, totalInr: base.totalInr,
      savingsInr: 0, savingsPct: 0,
      costPerResolvedUnitInr: base.costPerResolvedUnitInr,
      humanHoursPerMonth: base.humanHoursPerMonth,
    };
  }

  let best: Deployment | null = null;
  for (const pt of curve) {
    // Zero coverage trivially satisfies any error budget. That is the absence of
    // a deployment, not a feasible one, and scoring it as feasible would let a
    // model with no usable confidence signal pass the gate.
    if (!withinBudget(cfg, pt.nEscapedErrors, pt.nAuto)) continue;
    const p = price(cfg, humanSecondsPerUnit, reworkSecondsPerEscapedError, {
      nTotal: n, nAuto: pt.nAuto, nEscapedErrors: pt.nEscapedErrors,
      nReviewedErrors: totalErrors - pt.nEscapedErrors, inferenceUsdPerUnit: usdPerUnit,
    });
    const d: Deployment = { name: label, design: 'single', models: [label], thresholds: [pt.threshold], feasible: true, ...p };
    if (!best || d.totalInr < best.totalInr) best = d;
  }
  if (best) return best;

  // Nothing can be automated inside the error budget. The model is not useless —
  // it can still assist review — but it automates nothing, and saying so is the
  // point of this branch.
  const p = price(cfg, humanSecondsPerUnit, reworkSecondsPerEscapedError, {
    nTotal: n, nAuto: 0, nEscapedErrors: 0, nReviewedErrors: totalErrors, inferenceUsdPerUnit: usdPerUnit,
  });
  const acc = n ? 1 - totalErrors / n : 0;
  const be = draftAssistBreakEven(cfg);
  const need = minItemsToCertify(cfg.maxEscapedErrorRate);
  const underpowered = cfg.conservative && n < need;
  return {
    name: label, design: 'single', models: [label], thresholds: [1], feasible: false,
    note: (underpowered
      ? `UNDERPOWERED, not necessarily unusable: certifying a ${(cfg.maxEscapedErrorRate * 100).toFixed(1)}% error budget needs about ${need} evaluated items even with a flawless run, and this cell has ${n}. The evidence to clear the gate does not exist at this sample size — that is a statement about the eval set, not about the model. Re-run with --n ${Math.ceil(need * 1.5)}. `
      : '') +
      `No threshold holds escaped errors at or under ${(cfg.maxEscapedErrorRate * 100).toFixed(1)}%, so every item must be reviewed. ` +
      (acc >= be
        ? `It still pays as draft-assist at ${(acc * 100).toFixed(1)}% accuracy (break-even ${(be * 100).toFixed(0)}%), but it automates nothing.`
        : `At ${(acc * 100).toFixed(1)}% accuracy it is below the ${(be * 100).toFixed(0)}% draft-assist break-even: reviewing its output costs MORE than doing the work from scratch.`),
    ...p,
  };
}

// ------------------------------------------------------------- compositions

type Aligned = { itemId: string; a: ItemOutcome; b: ItemOutcome };

function align(a: ItemOutcome[], b: ItemOutcome[]): Aligned[] {
  const bx = new Map(b.map((o) => [o.itemId, o]));
  const out: Aligned[] = [];
  for (const x of a) {
    const y = bx.get(x.itemId);
    if (y && x.correct !== null && y.correct !== null) out.push({ itemId: x.itemId, a: x, b: y });
  }
  return out;
}

/**
 * Two-stage cascade: the cheap model answers, and only what it is unsure about
 * escalates to the expensive one. You pay the expensive model on the tail
 * instead of on everything, which is where most of an inference bill goes.
 * Grid search over both thresholds — 101x101 is free, and the surface is not
 * convex enough to trust a hill climb.
 */
export function optimiseCascade(
  cfg: EconomicsConfig,
  humanSecondsPerUnit: number,
  reworkSecondsPerEscapedError: number,
  cheap: { label: string; outcomes: ItemOutcome[] },
  strong: { label: string; outcomes: ItemOutcome[] },
  steps = 101,
): Deployment | null {
  const pairs = align(cheap.outcomes, strong.outcomes);
  if (pairs.length < 20) return null;
  const n = pairs.length;
  const cheapUsd = pairs.reduce((s, p) => s + p.a.costUsd, 0) / n;
  const strongUsd = pairs.reduce((s, p) => s + p.b.costUsd, 0) / n;

  let best: Deployment | null = null;
  for (let i = 0; i < steps; i++) {
    const t1 = i / (steps - 1);
    const stage1 = pairs.filter((p) => p.a.conf >= t1);
    const escalated = pairs.filter((p) => p.a.conf < t1);
    const e1 = stage1.filter((p) => p.a.correct === false).length;
    for (let j = 0; j < steps; j++) {
      const t2 = j / (steps - 1);
      const stage2 = escalated.filter((p) => p.b.conf >= t2);
      const reviewed = escalated.filter((p) => p.b.conf < t2);
      const nAuto = stage1.length + stage2.length;
      const escaped = e1 + stage2.filter((p) => p.b.correct === false).length;
      if (!withinBudget(cfg, escaped, nAuto)) continue;             // same gate as every other design

      const usdPerUnit = cheapUsd + (escalated.length / n) * strongUsd;
      const p = price(cfg, humanSecondsPerUnit, reworkSecondsPerEscapedError, {
        nTotal: n, nAuto, nEscapedErrors: escaped,
        // Whatever reaches a human arrives with the STRONG model's draft attached.
        nReviewedErrors: reviewed.filter((p) => p.b.correct === false).length,
        inferenceUsdPerUnit: usdPerUnit,
      });
      const d: Deployment = {
        name: `${cheap.label} → ${strong.label}`, design: 'cascade',
        models: [cheap.label, strong.label], thresholds: [t1, t2], feasible: true,
        // A first stage that answers nothing is the second model alone wearing a
        // cascade's name. It reported four "different" cascades at identical cost
        // because the first stage was empty in all four.
        note: stage1.length === 0
          ? `Degenerate: the first stage auto-approves nothing at this threshold, so this is ${strong.label} alone. Not a composition.`
          : undefined,
        ...p,
      };
      if (!best || d.totalInr < best.totalInr) best = d;
    }
  }
  return best;
}

/**
 * Agreement routing. Run two models, auto-approve only where they independently
 * agree, send every disagreement to a human. No self-reported confidence
 * involved at all — which matters, because self-report is the least trustworthy
 * signal in the stack. Often beats both models alone on escaped errors while
 * costing less than the strong model alone.
 *
 * Its failure mode is the interesting one: models that share training data fail
 * on the same items, so agreement can be confident and wrong together. The
 * check below reports that instead of assuming independence.
 */
export function optimiseDuet(
  cfg: EconomicsConfig,
  humanSecondsPerUnit: number,
  reworkSecondsPerEscapedError: number,
  x: { label: string; outcomes: ItemOutcome[]; answers: Map<string, string> },
  y: { label: string; outcomes: ItemOutcome[]; answers: Map<string, string> },
): Deployment | null {
  const pairs = align(x.outcomes, y.outcomes);
  if (pairs.length < 20) return null;
  const n = pairs.length;
  const usdPerUnit = pairs.reduce((s, p) => s + p.a.costUsd + p.b.costUsd, 0) / n;

  const agree = (p: Aligned) => {
    const ax = x.answers.get(p.itemId), ay = y.answers.get(p.itemId);
    return ax !== undefined && ay !== undefined && ax === ay;
  };
  const agreed = pairs.filter(agree);
  const disagreed = pairs.filter((p) => !agree(p));
  const escaped = agreed.filter((p) => p.a.correct === false).length;
  // On a disagreement the human sees two candidate answers. Treated as a wrong
  // draft only when BOTH are wrong; otherwise the right answer is on the page.
  const reviewedErrors = disagreed.filter((p) => p.a.correct === false && p.b.correct === false).length;

  const pr = price(cfg, humanSecondsPerUnit, reworkSecondsPerEscapedError, {
    nTotal: n, nAuto: agreed.length, nEscapedErrors: escaped,
    nReviewedErrors: reviewedErrors, inferenceUsdPerUnit: usdPerUnit,
  });
  const rate = agreed.length ? escaped / agreed.length : 0;
  const empty = agreed.length === 0;
  return {
    name: `${x.label} + ${y.label} (agree)`, design: 'duet',
    models: [x.label, y.label], thresholds: [],
    feasible: withinBudget(cfg, escaped, agreed.length),
    note: empty
      ? 'The two models never produced the same answer, so agreement routing automates nothing.'
      : rate > cfg.maxEscapedErrorRate
        ? `Agreement is not evidence on this workload: where they agree they are still wrong ${(rate * 100).toFixed(1)}% of the time. Correlated failure, most likely shared training data.`
        : undefined,
    ...pr,
  };
}

export const inr = (v: number): string =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString('en-IN')}`;
