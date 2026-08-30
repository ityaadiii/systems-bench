/**
 * Analysis. Folds a flat list of attempts into the grid.
 *
 * Every headline number here carries an interval, every model-vs-model claim is
 * a paired test, and the whole family of tests is corrected for multiplicity
 * before anything is called a difference. Five models across three workloads and
 * seven dimensions is over a hundred simultaneous comparisons; at p<0.05 and no
 * correction you would manufacture about five winners out of noise alone, and
 * they would be the five you quote.
 */

import type { Attempt, CorruptionTag, Workload } from '../types.ts';
import { calibration, coverageRisk, aurc, fitIsotonic, type CalibrationReport, type CoveragePoint } from './calibrate.ts';
import { holm, mcnemarExact, pairCounts, quantile, tailLatency, wilson, type Interval } from './stats.ts';
import { DEFAULT_ECONOMICS, manualBaseline, optimiseCascade, optimiseDuet, optimiseSingle, type Deployment, type EconomicsConfig, type ItemOutcome } from './economics.ts';
import { canonicalAnswer, SOURCES } from '../confidence/index.ts';
import type { ConfidenceSource } from '../types.ts';

/** Below this many items a cell is reported but not ranked; the interval is wider than any effect. */
export const MIN_CELL = 15;

/**
 * Two properties, deliberately kept apart, because conflating them cost this
 * bench a false headline before it was caught.
 *
 *   RANKING  — does the confidence order right answers above wrong ones? This is
 *   what a threshold acts on, and it is measured by AURC on the RAW values.
 *
 *   CALIBRATION — does 0.9 mean 90%? Measured by ECE, and repairable by fitting
 *   an isotonic map on held-out items.
 *
 * Recalibration is a MONOTONE transform. It therefore cannot improve ranking,
 * and it can actively destroy it: pool-adjacent-violators merges distinct raw
 * values into one fitted value, and every merged pair stops being separable by
 * any threshold. Computing the coverage curve on recalibrated values — which is
 * the obvious thing to do — collapsed four models to "automates nothing" here,
 * when three of them cleared the budget comfortably on the raw ordering.
 *
 * So: the curve and AURC run on raw ordering; ECE is reported before and after.
 */
export type SourceAnalysis = {
  source: ConfidenceSource;
  n: number;
  calibrationRaw: CalibrationReport;
  calibrationFitted: CalibrationReport;
  /** Ranking quality on raw ordering. Invariant to any monotone recalibration. */
  aurc: number;
  /** AURC after recalibration. Shown only to demonstrate the tie-pooling cost. */
  aurcAfterRecalibration: number;
  /** Built on RAW confidence, so thresholds are in the units the model emits. */
  curve: CoveragePoint[];
};

export type Cell = {
  workloadId: string;
  modelKey: string;
  label: string;
  servedModels: string[];
  nativeSchema: boolean;

  n: number;
  nGradeable: number;
  nRefused: number;
  nInvalid: number;
  nCallFailed: number;

  accuracy: number;
  accuracyCi: Interval;
  schemaValidRate: number;
  refusalRate: number;
  repairRate: number;

  latencyP50: number;
  latencyP95: number;
  latencyP95Ci: Interval;
  meanQueueMs: number;

  usdPerCall: number;
  sources: SourceAnalysis[];
  bestSource: ConfidenceSource | null;

  deployment: Deployment;
  failureModes: { mode: string; n: number }[];
  byTag: { tag: CorruptionTag; n: number; accuracy: number; ci: Interval; thin: boolean }[];
  /** Per-field accuracy. A composite hides which half of a task is broken. */
  byField: { field: string; n: number; accuracy: number; ci: Interval; scored: boolean }[];
};

export type Comparison = {
  workloadId: string; a: string; b: string;
  accA: number; accB: number; delta: number;
  discordant: number; p: number; pAdj: number; significant: boolean;
};

export type WorkloadAnalysis = {
  workloadId: string;
  title: string;
  vertical: string;
  unit: string;
  n: number;
  manual: Deployment;
  cells: Cell[];
  comparisons: Comparison[];
  systems: Deployment[];
  positionBias?: { position: number; n: number; accuracy: number }[];
};

const pct = (k: number, n: number) => (n ? k / n : 0);

function analyseSource(
  attempts: Attempt[],
  source: ConfidenceSource,
): SourceAnalysis | null {
  const withConf = attempts.filter((a) => a.correct !== null && a.confidence[source] !== undefined);
  if (withConf.length < MIN_CELL) return null;

  const asPair = (a: Attempt) => ({ conf: a.confidence[source]!, correct: a.correct === true });
  const calib = withConf.filter((a) => a.split === 'calib').map(asPair);
  const test = withConf.filter((a) => a.split === 'test').map(asPair);
  // Fall back to reporting on everything only when the split is too thin to be
  // meaningful, and the fitted numbers are then in-sample and flagged as such.
  const evalSet = test.length >= MIN_CELL ? test : withConf.map(asPair);

  const fitted = calib.length >= MIN_CELL
    ? (() => { const f = fitIsotonic(calib); return evalSet.map((p) => ({ conf: f.apply(p.conf), correct: p.correct })); })()
    : evalSet;

  return {
    source,
    n: evalSet.length,
    calibrationRaw: calibration(evalSet),
    calibrationFitted: calibration(fitted),
    aurc: aurc(evalSet),
    aurcAfterRecalibration: aurc(fitted),
    curve: coverageRisk(evalSet),
  };
}

export function analyseCell(
  workload: Workload<any, any, any>,
  modelKey: string,
  label: string,
  nativeSchema: boolean,
  attempts: Attempt[],
  econ: EconomicsConfig,
): Cell {
  const n = attempts.length;
  const gradeable = attempts.filter((a) => a.correct !== null);
  const correct = gradeable.filter((a) => a.correct === true).length;

  const lat = attempts.filter((a) => !a.cached && a.serviceMs > 0).map((a) => a.serviceMs).sort((x, y) => x - y);
  const p95 = lat.length ? tailLatency(lat, 0.95) : { point: NaN, lo: NaN, hi: NaN };

  const sources = SOURCES.map((s) => analyseSource(attempts, s)).filter((x): x is SourceAnalysis => x !== null);
  // Ranked on AURC, because that is the quantity that decides how much can be
  // automated — not on ECE, which a flat and entirely useless signal wins outright.
  const best = sources.length ? sources.reduce((a, b) => (b.aurc < a.aurc ? b : a)) : null;

  /**
   * THE SAME ITEMS THE CURVE WAS BUILT FROM.
   *
   * `nAuto` comes from a curve computed on the test split; `nTotal` came from
   * every gradeable attempt. Coverage is nAuto/nTotal, so dividing a 266-item
   * numerator by a 400-item denominator understated every single model's
   * coverage by a third — and made compositions look like the only designs that
   * could clear the error budget. The gazetteer alone reaches 92%; it was
   * reported at 61%.
   *
   * Third instance of one bug class: two parts of the analysis disagreeing about
   * which items they are talking about. Nothing here may choose its own set.
   */
  const evalAttempts = (() => {
    const test = gradeable.filter((a) => a.split === 'test');
    return test.length >= MIN_CELL ? test : gradeable;      // same rule as analyseSource
  })();

  const outcomes: ItemOutcome[] = best
    ? evalAttempts.filter((a) => a.confidence[best.source] !== undefined)
        .map((a) => ({ itemId: a.itemId, correct: a.correct, conf: a.confidence[best.source]!, costUsd: a.costUsd }))
    : evalAttempts.map((a) => ({ itemId: a.itemId, correct: a.correct, conf: 0.5, costUsd: a.costUsd }));

  const deployment = optimiseSingle(
    econ, workload.humanSecondsPerUnit, workload.reworkSecondsPerEscapedError,
    outcomes, best ? best.curve : coverageRisk(outcomes.map((o) => ({ conf: o.conf, correct: o.correct === true }))), label,
  );

  const modes = new Map<string, number>();
  for (const a of attempts) if (a.failureMode) modes.set(a.failureMode, (modes.get(a.failureMode) ?? 0) + 1);

  const tagSet = new Set<CorruptionTag>();
  for (const a of attempts) for (const t of a.tags) tagSet.add(t);
  const byTag = [...tagSet].map((tag) => {
    const sub = gradeable.filter((a) => a.tags.includes(tag));
    const k = sub.filter((a) => a.correct === true).length;
    return { tag, n: sub.length, accuracy: pct(k, sub.length), ci: wilson(k, sub.length), thin: sub.length < MIN_CELL };
  }).sort((a, b) => a.accuracy - b.accuracy);

  // Field names discovered from a graded sample. A field counts as `scored`
  // only if it can never be wrong on an item marked correct overall — which
  // is how a deliberately-excluded subjective field (ticket/priority)
  // reports itself honestly instead of looking like a gap.
  const probe = gradeable.find((x) => x.fieldVerdicts);
  const fieldNames = probe?.fieldVerdicts ? Object.keys(probe.fieldVerdicts) : [];
  const byField = fieldNames.map((field) => {
    const sub = gradeable.filter((x) => x.fieldVerdicts && field in x.fieldVerdicts);
    const k = sub.filter((x) => x.fieldVerdicts![field] === true).length;
    const scored = !sub.some((x) => x.fieldVerdicts![field] === false && x.correct === true);
    return { field, n: sub.length, accuracy: pct(k, sub.length), ci: wilson(k, sub.length), scored };
  });

  return {
    workloadId: workload.id, modelKey, label, nativeSchema,
    servedModels: [...new Set(attempts.map((a) => a.servedModel))],
    n,
    nGradeable: gradeable.length,
    nRefused: attempts.filter((a) => a.refused).length,
    nInvalid: attempts.filter((a) => !a.schemaValid && !a.refused && a.failureMode !== 'call_failed').length,
    nCallFailed: attempts.filter((a) => a.failureMode === 'call_failed').length,
    accuracy: pct(correct, gradeable.length),
    accuracyCi: wilson(correct, gradeable.length),
    schemaValidRate: pct(attempts.filter((a) => a.schemaValid).length, n),
    refusalRate: pct(attempts.filter((a) => a.refused).length, n),
    repairRate: pct(attempts.filter((a) => a.repairs > 0).length, n),
    latencyP50: lat.length ? quantile(lat, 0.5) : NaN,
    latencyP95: p95.point, latencyP95Ci: { lo: p95.lo, hi: p95.hi },
    meanQueueMs: attempts.length ? attempts.reduce((a, x) => a + x.queueMs, 0) / attempts.length : 0,
    usdPerCall: gradeable.length ? gradeable.reduce((a, x) => a + x.costUsd, 0) / gradeable.length : 0,
    sources, bestSource: best?.source ?? null,
    deployment,
    failureModes: [...modes.entries()].map(([mode, n]) => ({ mode, n })).sort((a, b) => b.n - a.n),
    byTag, byField,
  };
}

export function analyseWorkload(
  workload: Workload<any, any, any>,
  attempts: Attempt[],
  models: { key: string; label: string; nativeSchema: boolean }[],
  econ: EconomicsConfig = DEFAULT_ECONOMICS,
): WorkloadAnalysis {
  const mine = attempts.filter((a) => a.workloadId === workload.id);
  const cells = models.map((m) =>
    analyseCell(workload, m.key, m.label, m.nativeSchema, mine.filter((a) => a.modelKey === m.key), econ));

  // ---- paired comparisons, corrected as one family
  const itemIds = workload.items.map((i) => i.id);
  const vecOf = (key: string) => {
    const by = new Map(mine.filter((a) => a.modelKey === key).map((a) => [a.itemId, a.correct]));
    return itemIds.map((id) => by.get(id) ?? null);
  };
  const raw: { key: string; p: number; meta: Omit<Comparison, 'p' | 'pAdj' | 'significant'> }[] = [];
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const A = cells[i]!, B = cells[j]!;
      if (A.nGradeable < MIN_CELL || B.nGradeable < MIN_CELL) continue;
      const pc = pairCounts(vecOf(A.modelKey), vecOf(B.modelKey));
      raw.push({
        key: `${workload.id}|${A.modelKey}|${B.modelKey}`,
        p: mcnemarExact(pc),
        meta: {
          workloadId: workload.id, a: A.modelKey, b: B.modelKey,
          accA: A.accuracy, accB: B.accuracy, delta: A.accuracy - B.accuracy,
          discordant: pc.b + pc.c,
        },
      });
    }
  }
  const adjusted = holm(raw.map((r) => ({ key: r.key, p: r.p })));
  const comparisons: Comparison[] = raw.map((r) => {
    const a = adjusted.find((x) => x.key === r.key)!;
    return { ...r.meta, p: r.p, pAdj: a.pAdj, significant: a.significant };
  }).sort((x, y) => x.pAdj - y.pAdj);

  // ---- system designs, not just model rankings
  const systems: Deployment[] = [manualBaseline(econ, workload.humanSecondsPerUnit)];
  for (const c of cells) if (c.nGradeable >= MIN_CELL) systems.push(c.deployment);

  /**
   * The evaluation set for a cell — ONE definition, used by every design.
   *
   * This function exists because the bug it prevents already happened twice.
   * `optimiseSingle` scored on the test split while the cascade and duet
   * optimisers pulled every gradeable attempt including the calibration third.
   * With 400 items instead of 266 the Wilson upper bound is tighter, so the
   * compositions cleared the error budget at coverage the single models could
   * not reach — and the bench reported "the cheapest design is a composition"
   * when the only thing the composition had was a bigger sample.
   *
   * That is blindspot #14 a second time, in a new disguise: the first fix made
   * the risk GATE uniform and left the DATA it was applied to different. The
   * structural answer is not another spot fix — it is that no call site gets to
   * choose its own evaluation set.
   */
  const evalSetFor = (modelKey: string): Attempt[] => {
    const gradeable = mine.filter((a) => a.modelKey === modelKey && a.correct !== null);
    const test = gradeable.filter((a) => a.split === 'test');
    // Mirrors analyseSource: fall back to everything only when the split is too
    // thin to be meaningful, and then it is thin for every design equally.
    return test.length >= MIN_CELL ? test : gradeable;
  };

  const outcomesOf = (c: Cell): ItemOutcome[] => {
    const src = c.bestSource;
    return evalSetFor(c.modelKey).map((a) => ({
      itemId: a.itemId, correct: a.correct,
      conf: src ? (a.confidence[src] ?? 0.5) : 0.5, costUsd: a.costUsd,
    }));
  };
  const answersOf = (key: string) =>
    new Map(evalSetFor(key).filter((a) => a.parsed !== null).map((a) => [a.itemId, canonicalAnswer(a.parsed)]));

  const ranked = [...cells].filter((c) => c.nGradeable >= MIN_CELL).sort((a, b) => a.usdPerCall - b.usdPerCall);
  for (let i = 0; i < ranked.length; i++) {
    for (let j = 0; j < ranked.length; j++) {
      if (i === j) continue;
      const cheap = ranked[i]!, strong = ranked[j]!;
      if (strong.usdPerCall < cheap.usdPerCall) continue;
      const casc = optimiseCascade(econ, workload.humanSecondsPerUnit, workload.reworkSecondsPerEscapedError,
        { label: cheap.label, outcomes: outcomesOf(cheap) }, { label: strong.label, outcomes: outcomesOf(strong) });
      if (casc) systems.push(casc);
    }
  }
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      const x = ranked[i]!, y = ranked[j]!;
      const duet = optimiseDuet(econ, workload.humanSecondsPerUnit, workload.reworkSecondsPerEscapedError,
        { label: x.label, outcomes: outcomesOf(x), answers: answersOf(x.modelKey) },
        { label: y.label, outcomes: outcomesOf(y), answers: answersOf(y.modelKey) });
      if (duet) systems.push(duet);
    }
  }
  systems.sort((a, b) => a.totalInr - b.totalInr);

  return {
    workloadId: workload.id, title: workload.title, vertical: workload.vertical,
    unit: workload.unit, n: workload.items.length,
    manual: manualBaseline(econ, workload.humanSecondsPerUnit),
    cells, comparisons, systems,
  };
}
