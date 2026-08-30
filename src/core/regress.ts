/**
 * Drift detection.
 *
 * The failure this exists for: a lab repoints an alias, your deployment gets a
 * different model, and nothing in your codebase changed. There is no deploy to
 * roll back and no commit to blame. The first symptom is a customer noticing.
 *
 * Two independent signals, and the interesting information is in how they
 * combine rather than in either alone:
 *
 *   VERSION — did `servedModel` change? Recorded per attempt because the alias
 *   you request cannot tell you this. A repointed alias and a genuine
 *   regression are indistinguishable unless you write down what actually served
 *   the request.
 *
 *   BEHAVIOUR — did per-item correctness move by more than sampling noise?
 *   Paired McNemar on the identical eval set, which is far more sensitive than
 *   comparing two accuracy percentages: two runs can both read 91% while
 *   quietly disagreeing on a fifth of the items.
 *
 * The combination that should page someone is not "accuracy fell". It is
 * "behaviour moved and the version did not", because that means something
 * changed upstream that the provider is not telling you about.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Attempt } from '../types.ts';
import { mcnemarExact, pairCounts, wilson } from './stats.ts';

export type Baseline = {
  runId: string;
  capturedAt: string;
  evidential: boolean;
  cells: {
    workloadId: string;
    modelKey: string;
    servedModels: string[];
    accuracy: number;
    n: number;
    items: Record<string, boolean | null>;
  }[];
};

export type DriftVerdict =
  | 'STABLE'
  | 'NOISE'
  | 'IMPROVED'
  | 'REGRESSED'
  | 'SILENT_REGRESSION'
  | 'VERSION_CHANGED_BEHAVIOUR_HELD'
  | 'NEW';

export type DriftRow = {
  workloadId: string;
  modelKey: string;
  verdict: DriftVerdict;
  baselineAccuracy: number | null;
  currentAccuracy: number;
  delta: number | null;
  /** Items that flipped in each direction. A large churn with a flat headline is still a change. */
  brokeCount: number;
  fixedCount: number;
  p: number | null;
  versionBefore: string[];
  versionAfter: string[];
  message: string;
};

export function captureBaseline(runId: string, attempts: Attempt[], evidential: boolean): Baseline {
  const byCell = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const k = `${a.workloadId}|${a.modelKey}`;
    (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(a);
  }
  return {
    runId, capturedAt: new Date().toISOString(), evidential,
    cells: [...byCell.entries()].map(([k, list]) => {
      const [workloadId, modelKey] = k.split('|') as [string, string];
      const gradeable = list.filter((a) => a.correct !== null);
      return {
        workloadId, modelKey,
        servedModels: [...new Set(list.map((a) => a.servedModel))].sort(),
        accuracy: gradeable.length ? gradeable.filter((a) => a.correct === true).length / gradeable.length : NaN,
        n: gradeable.length,
        items: Object.fromEntries(list.map((a) => [a.itemId, a.correct])),
      };
    }),
  };
}

export async function saveBaseline(root: string, name: string, b: Baseline): Promise<string> {
  const dir = join(root, 'baselines');
  await mkdir(dir, { recursive: true });
  const p = join(dir, `${name}.json`);
  await writeFile(p, JSON.stringify(b, null, 2), 'utf8');
  return p;
}

export async function loadBaseline(root: string, name: string): Promise<Baseline | null> {
  try { return JSON.parse(await readFile(join(root, 'baselines', `${name}.json`), 'utf8')) as Baseline; }
  catch { return null; }
}

export function compareToBaseline(baseline: Baseline, attempts: Attempt[]): DriftRow[] {
  const rows: DriftRow[] = [];
  const cells = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const k = `${a.workloadId}|${a.modelKey}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(a);
  }

  for (const [k, list] of cells) {
    const [workloadId, modelKey] = k.split('|') as [string, string];
    const base = baseline.cells.find((c) => c.workloadId === workloadId && c.modelKey === modelKey);
    const gradeable = list.filter((a) => a.correct !== null);
    const currentAccuracy = gradeable.length ? gradeable.filter((a) => a.correct === true).length / gradeable.length : NaN;
    const versionAfter = [...new Set(list.map((a) => a.servedModel))].sort();

    if (!base) {
      rows.push({
        workloadId, modelKey, verdict: 'NEW', baselineAccuracy: null, currentAccuracy, delta: null,
        brokeCount: 0, fixedCount: 0, p: null, versionBefore: [], versionAfter,
        message: 'No baseline for this cell. Capture one before trusting any later comparison.',
      });
      continue;
    }

    // Paired over the items present in BOTH runs. An item added or dropped
    // between runs is not evidence of drift, it is a change of ruler.
    const shared = list.filter((a) => a.itemId in base.items);
    const before = shared.map((a) => base.items[a.itemId] ?? null);
    const after = shared.map((a) => a.correct);
    // pairCounts(before, after): .b is before-right/after-wrong (BROKE),
    // .c is before-wrong/after-right (FIXED). Naming them in local variables
    // because reading them off the wrong side is exactly the mistake that made
    // an earlier version report "0 items now fail" while declaring a regression.
    const pc = pairCounts(before, after);
    const broke = pc.b, fixed = pc.c;
    const p = mcnemarExact(pc);
    const delta = currentAccuracy - base.accuracy;
    const versionChanged = JSON.stringify(versionAfter) !== JSON.stringify(base.servedModels);
    const significant = p < 0.05;

    let verdict: DriftVerdict;
    let message: string;
    if (significant && delta < 0 && !versionChanged) {
      verdict = 'SILENT_REGRESSION';
      message = `Behaviour moved but the served version did not. ${broke} items now fail that previously passed, p=${p.toFixed(4)}. Something changed upstream that the version string does not expose. This is the one worth paging someone about.`;
    } else if (significant && delta < 0) {
      verdict = 'REGRESSED';
      message = `Version changed (${base.servedModels.join(',')} → ${versionAfter.join(',')}) and ${broke} items regressed, p=${p.toFixed(4)}. Pin the previous version and re-run before shipping.`;
    } else if (significant && delta > 0) {
      verdict = 'IMPROVED';
      message = `${fixed} items now pass that previously failed, p=${p.toFixed(4)}. Recapture the baseline so this becomes the new floor.`;
    } else if (versionChanged) {
      verdict = 'VERSION_CHANGED_BEHAVIOUR_HELD';
      message = `Served version changed (${base.servedModels.join(',')} → ${versionAfter.join(',')}) with no detectable behaviour change (p=${p.toFixed(3)}). Note it; do not act on it.`;
    } else if (broke + fixed > shared.length * 0.1) {
      verdict = 'NOISE';
      message = `Headline accuracy is flat but ${broke + fixed} of ${shared.length} items flipped. Non-determinism at this rate limits how small a real regression you can ever detect.`;
    } else {
      verdict = 'STABLE';
      message = `No material change (${fixed} fixed, ${broke} broken, p=${p.toFixed(3)}).`;
    }

    rows.push({
      workloadId, modelKey, verdict,
      baselineAccuracy: base.accuracy, currentAccuracy, delta,
      brokeCount: broke, fixedCount: fixed, p,
      versionBefore: base.servedModels, versionAfter, message,
    });
  }

  const order: DriftVerdict[] = ['SILENT_REGRESSION', 'REGRESSED', 'NOISE', 'VERSION_CHANGED_BEHAVIOUR_HELD', 'IMPROVED', 'NEW', 'STABLE'];
  return rows.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict));
}

/**
 * Smallest true regression this eval set could detect, at the given power.
 * Worth printing next to every "no change detected": at n=200 a bench cannot
 * see a three-point drop, and reporting stability without saying so is a
 * promise the sample size cannot keep.
 *
 * Uses the unpaired two-proportion formula, which OVERSTATES the detectable
 * effect for the paired test actually used above — paired is strictly more
 * powerful. Conservative in the safe direction: the bench will not claim to see
 * smaller regressions than it can.
 */
export function minimumDetectableEffect(n: number, baseAccuracy: number, power = 0.8): number {
  const z = { alpha: 1.959963985, beta: power === 0.8 ? 0.8416212336 : 1.2815515655 };
  const p = Math.min(0.999, Math.max(0.001, baseAccuracy));
  const se = Math.sqrt((2 * p * (1 - p)) / n);
  return (z.alpha + z.beta) * se;
}

export { wilson };
