import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ECONOMICS, manualBaseline, optimiseSingle, optimiseCascade, optimiseDuet, draftAssistBreakEven, type ItemOutcome } from './economics.ts';
import { coverageRisk } from './calibrate.ts';
import { rng } from './stats.ts';

const cfg = { ...DEFAULT_ECONOMICS, monthlyVolume: 100_000, conservative: false };
const HUMAN = 45, REWORK = 360;

function make(n: number, acc: number, sep: number, usd: number, seed: number): ItemOutcome[] {
  // `sep` controls how well confidence separates right from wrong: 0 = no signal.
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const correct = r() < acc;
    const conf = Math.min(0.999, Math.max(0.001, (correct ? 0.5 + sep / 2 : 0.5 - sep / 2) + (r() - 0.5) * (1 - sep)));
    return { itemId: `i${i}`, correct, conf, costUsd: usd };
  });
}
const curveOf = (o: ItemOutcome[]) => coverageRisk(o.map((x) => ({ conf: x.conf, correct: x.correct === true })));

test('manual baseline is just hours times wage', () => {
  const b = manualBaseline(cfg, HUMAN);
  assert.equal(b.humanHoursPerMonth, (100_000 * 45) / 3600);
  assert.equal(b.totalInr, b.humanHoursPerMonth * cfg.wageInrPerHour);
  assert.equal(b.savingsInr, 0);
});

test('a confident-but-unrankable model is marked infeasible and can cost MORE than manual', () => {
  // 88% accurate, zero separation: no threshold isolates the good answers, so
  // everything must be reviewed and the inference bill is pure addition.
  const o = make(600, 0.88, 0, 0.004, 5);
  const flat = o.map((x) => ({ ...x, conf: 0.9 }));
  const d = optimiseSingle({ ...cfg, maxEscapedErrorRate: 0.02 }, HUMAN, REWORK, flat, curveOf(flat), 'flat');
  assert.equal(d.feasible, false);
  assert.equal(d.coverage, 0);
  assert.match(d.note ?? '', /must be reviewed/);
  // At 88% it still pays as draft-assist, and the note has to say so rather
  // than let "infeasible" read as "worthless".
  assert.match(d.note ?? '', /draft-assist/);
  assert.ok(d.totalInr < manualBaseline(cfg, HUMAN).totalInr);
});

test('separation, not accuracy, is what produces savings', () => {
  const blunt = make(800, 0.92, 0.05, 0.004, 7);
  const sharp = make(800, 0.92, 0.85, 0.004, 7);
  const a = optimiseSingle(cfg, HUMAN, REWORK, blunt, curveOf(blunt), 'blunt');
  const b = optimiseSingle(cfg, HUMAN, REWORK, sharp, curveOf(sharp), 'sharp');
  assert.ok(b.coverage > a.coverage + 0.2, `coverage ${a.coverage.toFixed(2)} vs ${b.coverage.toFixed(2)}`);
  assert.ok(b.savingsInr > a.savingsInr);
});

test('a cascade beats the strong model alone at the same error budget', () => {
  const items = 900;
  const r = rng(31);
  const truth = Array.from({ length: items }, () => r());
  const cheap: ItemOutcome[] = [], strong: ItemOutcome[] = [];
  for (let i = 0; i < items; i++) {
    const hard = truth[i]!;                       // higher = harder item
    const cOK = hard < 0.82, sOK = hard < 0.95;   // strong model handles more
    cheap.push({ itemId: `i${i}`, correct: cOK, conf: 1 - hard, costUsd: 0.0004 });
    strong.push({ itemId: `i${i}`, correct: sOK, conf: 1 - hard * 0.7, costUsd: 0.02 });
  }
  const solo = optimiseSingle(cfg, HUMAN, REWORK, strong, curveOf(strong), 'strong');
  const casc = optimiseCascade(cfg, HUMAN, REWORK, { label: 'cheap', outcomes: cheap }, { label: 'strong', outcomes: strong })!;
  assert.ok(casc, 'cascade should be computable');
  assert.ok(casc.inferenceInr < solo.inferenceInr, 'the expensive model should only see the tail');
  assert.ok(casc.totalInr <= solo.totalInr, `cascade ${casc.totalInr.toFixed(0)} vs solo ${solo.totalInr.toFixed(0)}`);
  assert.equal(casc.thresholds.length, 2);
});

test('agreement routing detects correlated failure instead of trusting it', () => {
  // Two models that fail on the SAME items. They agree everywhere, including on
  // every wrong answer, so agreement carries no evidence at all.
  const n = 400;
  const answers = new Map<string, string>();
  const a: ItemOutcome[] = [], b: ItemOutcome[] = [];
  for (let i = 0; i < n; i++) {
    const ok = i % 10 !== 0;
    answers.set(`i${i}`, ok ? 'right' : 'wrong-but-same');
    a.push({ itemId: `i${i}`, correct: ok, conf: 0.9, costUsd: 0.001 });
    b.push({ itemId: `i${i}`, correct: ok, conf: 0.9, costUsd: 0.001 });
  }
  const duet = optimiseDuet({ ...cfg, maxEscapedErrorRate: 0.02 }, HUMAN, REWORK,
    { label: 'a', outcomes: a, answers }, { label: 'b', outcomes: b, answers })!;
  assert.equal(duet.feasible, false);
  assert.match(duet.note ?? '', /Correlated failure/);
});

test('escaped errors are charged at the rework rate, not the review rate', () => {
  const o = make(500, 0.9, 0.8, 0.002, 13);
  const cheapRework = optimiseSingle(cfg, HUMAN, 45, o, curveOf(o), 'x');
  const dearRework = optimiseSingle(cfg, HUMAN, 3600, o, curveOf(o), 'x');
  assert.ok(dearRework.coverage <= cheapRework.coverage,
    'when being wrong gets more expensive, the optimiser should automate less');
});

test('below the draft-assist break-even, the model makes the process MORE expensive', () => {
  // The result nobody puts in a pilot report: a weak model does not save a
  // little, it costs extra, because reviewing wrong drafts is slower than
  // starting clean.
  const be = draftAssistBreakEven(cfg);
  assert.ok(be > 0.3 && be < 0.5, `break-even ${be}`);
  const weak = make(600, be - 0.15, 0, 0.004, 3).map((x) => ({ ...x, conf: 0.9 }));
  const d = optimiseSingle(cfg, HUMAN, REWORK, weak, curveOf(weak), 'weak');
  assert.equal(d.feasible, false);
  assert.ok(d.totalInr > manualBaseline(cfg, HUMAN).totalInr,
    'a sub-break-even model should show up as a cost increase, not a saving');
  assert.ok(d.savingsInr < 0);
  assert.match(d.note ?? '', /costs MORE/);
});
