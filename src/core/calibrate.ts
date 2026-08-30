/**
 * Calibration and selective prediction.
 *
 * The premise of the whole bench: a model at 92% accuracy does not remove 92%
 * of the work. It removes work only to the extent you can tell WHICH answers to
 * trust. So the question is never "how accurate", it is "how much of this can I
 * let through untouched, and what escapes when I do".
 *
 * Two properties are needed and they are routinely confused:
 *
 *   CALIBRATION — when it says 0.9, is it right 90% of the time?
 *   RESOLUTION  — does the number vary with whether it is actually right?
 *
 * A model that emits 0.87 on every single item and is right 87% of the time is
 * perfectly calibrated and completely useless: there is no threshold that
 * separates anything. Calibration without resolution is a well-behaved coin.
 * Reporting ECE alone hides this, which is why the Brier decomposition below
 * reports both terms separately.
 */

import { quantile, wilson, type Interval } from './stats.ts';

export type Bin = {
  lo: number; hi: number; n: number;
  meanConf: number; accuracy: number; ci: Interval;
};

export type CalibrationReport = {
  n: number;
  /** Equal-width bins: the conventional ECE. */
  eceEqualWidth: number;
  /**
   * Equal-mass bins. LLM confidence clusters hard at 0.9/0.95/0.99, which leaves
   * equal-width bins nearly empty across most of the range and makes ECE a
   * function of the binning rather than the model. When these two disagree by a
   * lot, trust the equal-mass one and say so.
   */
  eceEqualMass: number;
  /** Worst single bin. One catastrophic bucket can hide inside a good average. */
  mce: number;
  brier: number;
  /** Murphy decomposition: brier ≈ reliability − resolution + uncertainty. */
  reliability: number;
  resolution: number;
  uncertainty: number;
  /** Fraction of the theoretical maximum resolution actually achieved. 0 = useless signal. */
  resolutionRatio: number;
  bins: Bin[];
  binsEqualMass: Bin[];
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function summarise(pairs: { conf: number; correct: boolean }[], edges: number[]): Bin[] {
  const bins: Bin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!, hi = edges[i + 1]!;
    const last = i === edges.length - 2;
    const inBin = pairs.filter((p) => p.conf >= lo && (last ? p.conf <= hi : p.conf < hi));
    const k = inBin.filter((p) => p.correct).length;
    bins.push({
      lo, hi, n: inBin.length,
      meanConf: inBin.length ? inBin.reduce((a, p) => a + p.conf, 0) / inBin.length : (lo + hi) / 2,
      accuracy: inBin.length ? k / inBin.length : NaN,
      ci: wilson(k, inBin.length),
    });
  }
  return bins;
}

/** One bin per distinct confidence value. */
function binByValue(pairs: { conf: number; correct: boolean }[]): Bin[] {
  const groups = new Map<number, { conf: number; correct: boolean }[]>();
  for (const p of pairs) {
    const g = groups.get(p.conf);
    if (g) g.push(p); else groups.set(p.conf, [p]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([v, g]) => {
    const k = g.filter((p) => p.correct).length;
    return { lo: v, hi: v, n: g.length, meanConf: v, accuracy: k / g.length, ci: wilson(k, g.length) };
  });
}

/**
 * Adaptive binning.
 *
 * Self-reported LLM confidence is not continuous. Models emit a handful of
 * values — 0.8, 0.9, 0.95, 0.99 — and nothing in between. Quantile binning on
 * such a distribution collapses every edge onto the same value, dedups to a
 * single bin, and then reports zero resolution for a signal that may in fact be
 * perfect. So: few distinct values means bin by value, which is both correct
 * and makes the Brier decomposition exact (no within-bin confidence variance).
 */
function adaptiveBins(pairs: { conf: number; correct: boolean }[], nBins: number): Bin[] {
  const distinct = new Set(pairs.map((p) => p.conf));
  if (distinct.size <= Math.max(nBins, 12)) return binByValue(pairs);
  const sortedConf = pairs.map((p) => p.conf).sort((a, b) => a - b);
  const edges = [0, ...Array.from({ length: nBins - 1 }, (_, i) => quantile(sortedConf, (i + 1) / nBins)), 1];
  const dedup = edges.filter((v, i, arr) => i === 0 || v > arr[i - 1]!);
  if (dedup.length < 2) return binByValue(pairs);
  return summarise(pairs, dedup);
}

const eceOf = (bins: Bin[], n: number) =>
  bins.filter((b) => b.n > 0).reduce((a, b) => a + (b.n / n) * Math.abs(b.meanConf - b.accuracy), 0);

export function calibration(pairs: { conf: number; correct: boolean }[], nBins = 10): CalibrationReport {
  const n = pairs.length;
  if (n === 0) return {
    n: 0, eceEqualWidth: NaN, eceEqualMass: NaN, mce: NaN, brier: NaN,
    reliability: NaN, resolution: NaN, uncertainty: NaN, resolutionRatio: NaN, bins: [], binsEqualMass: [],
  };

  const bins = summarise(pairs, Array.from({ length: nBins + 1 }, (_, i) => i / nBins));
  const binsAdaptive = adaptiveBins(pairs, nBins);

  const base = pairs.filter((p) => p.correct).length / n;
  const brier = pairs.reduce((a, p) => a + (p.conf - (p.correct ? 1 : 0)) ** 2, 0) / n;

  // Murphy decomposition on the adaptive bins. Exact when bins hold a single
  // confidence value; otherwise short by the within-bin confidence variance.
  const used = binsAdaptive.filter((b) => b.n > 0);
  const reliability = used.reduce((a, b) => a + (b.n / n) * (b.meanConf - b.accuracy) ** 2, 0);
  const resolution = used.reduce((a, b) => a + (b.n / n) * (b.accuracy - base) ** 2, 0);
  const uncertainty = base * (1 - base);

  return {
    n,
    eceEqualWidth: eceOf(bins, n),
    eceEqualMass: eceOf(binsAdaptive, n),
    mce: Math.max(...bins.filter((b) => b.n > 0).map((b) => Math.abs(b.meanConf - b.accuracy)), 0),
    brier, reliability, resolution, uncertainty,
    resolutionRatio: uncertainty > 0 ? resolution / uncertainty : 0,
    bins, binsEqualMass: binsAdaptive,
  };
}

// ------------------------------------------------------- isotonic regression

export type Calibrator = {
  /** Fitted knots, monotone non-decreasing. */
  knots: { x: number; y: number }[];
  apply: (conf: number) => number;
};

/**
 * Pool-adjacent-violators. Fits a monotone map from raw confidence to observed
 * accuracy — the standard, distribution-free recalibration.
 *
 * IMPORTANT: fit this on the `calib` split and evaluate on `test`. Fitting and
 * reporting on the same items produces an ECE near zero for any model at all,
 * which is not a finding, it is a leak. runner.ts enforces the split.
 */
export function fitIsotonic(pairs: { conf: number; correct: boolean }[]): Calibrator {
  const pts = [...pairs].sort((a, b) => a.conf - b.conf);
  const blocks: { sum: number; w: number; xlo: number; xhi: number }[] = [];
  for (const p of pts) {
    blocks.push({ sum: p.correct ? 1 : 0, w: 1, xlo: p.conf, xhi: p.conf });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!, a = blocks[blocks.length - 2]!;
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, w: a.w + b.w, xlo: a.xlo, xhi: b.xhi });
    }
  }
  const knots = blocks.map((b) => ({ x: (b.xlo + b.xhi) / 2, y: b.sum / b.w }));
  if (knots.length === 0) knots.push({ x: 0.5, y: 0.5 });

  const apply = (conf: number): number => {
    const c = clamp01(conf);
    if (c <= knots[0]!.x) return knots[0]!.y;
    if (c >= knots[knots.length - 1]!.x) return knots[knots.length - 1]!.y;
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1]!, b = knots[i]!;
      if (c <= b.x) {
        const t = b.x === a.x ? 0 : (c - a.x) / (b.x - a.x);
        return clamp01(a.y + t * (b.y - a.y));
      }
    }
    return knots[knots.length - 1]!.y;
  };
  return { knots, apply };
}

// ------------------------------------------------------- selective prediction

export type CoveragePoint = {
  threshold: number;
  /** Share of items auto-approved at this threshold. */
  coverage: number;
  /** Error rate AMONG the auto-approved. This is what escapes to production. */
  risk: number;
  riskCi: Interval;
  nAuto: number;
  nEscapedErrors: number;
};

/**
 * The coverage-risk curve. For every threshold: how much can you let through,
 * and what fraction of what you let through is wrong.
 *
 * This is the actual deliverable of a deployment. Accuracy is a by-product.
 */
export function coverageRisk(pairs: { conf: number; correct: boolean }[], steps = 101): CoveragePoint[] {
  const n = pairs.length;
  if (n === 0) return [];
  const out: CoveragePoint[] = [];
  for (let s = 0; s < steps; s++) {
    const t = s / (steps - 1);
    const auto = pairs.filter((p) => p.conf >= t);
    const errs = auto.filter((p) => !p.correct).length;
    out.push({
      threshold: t,
      coverage: auto.length / n,
      risk: auto.length ? errs / auto.length : 0,
      riskCi: wilson(errs, auto.length),
      nAuto: auto.length,
      nEscapedErrors: errs,
    });
  }
  return out;
}

/**
 * Area under the risk-coverage curve. Lower is better, and unlike accuracy it
 * rewards a model for KNOWING when it is wrong. Two models with identical
 * accuracy can differ several-fold here, and that difference is the entire
 * difference in what they cost to deploy.
 *
 * Integrated over BLOCKS of equal confidence, not over individual items.
 * Sorting items by confidence leaves ties in whatever order they arrived in, so
 * an item-wise integral makes the score a function of input ordering — a model
 * that emits 0.9 on everything would score differently on a shuffled eval set.
 * Blocks make it order-invariant. For distinct confidences the two definitions
 * coincide exactly.
 */
export function aurc(pairs: { conf: number; correct: boolean }[]): number {
  const n = pairs.length;
  if (n === 0) return NaN;
  const blocks = new Map<number, { n: number; errs: number }>();
  for (const p of pairs) {
    const b = blocks.get(p.conf) ?? { n: 0, errs: 0 };
    b.n++; if (!p.correct) b.errs++;
    blocks.set(p.conf, b);
  }
  const desc = [...blocks.entries()].sort((a, b) => b[0] - a[0]);
  let cumN = 0, cumErr = 0, prevCov = 0, area = 0;
  for (const [, b] of desc) {
    cumN += b.n; cumErr += b.errs;
    const cov = cumN / n;
    area += (cumErr / cumN) * (cov - prevCov);
    prevCov = cov;
  }
  return area;
}

/** Highest threshold whose escaped-error rate stays inside the tolerance, using the CI upper bound. */
export function maxCoverageAtRisk(curve: CoveragePoint[], maxRisk: number, conservative = true): CoveragePoint | null {
  const ok = curve.filter((p) => p.nAuto > 0 && (conservative ? p.riskCi.hi : p.risk) <= maxRisk);
  return ok.length ? ok.reduce((a, b) => (b.coverage > a.coverage ? b : a)) : null;
}
