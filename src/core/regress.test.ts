import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureBaseline, compareToBaseline, minimumDetectableEffect } from './regress.ts';
import type { Attempt } from '../types.ts';

const mk = (itemId: string, correct: boolean | null, servedModel: string): Attempt => ({
  runId: 'r', workloadId: 'w', modelKey: 'm', itemId, split: 'test', tags: ['clean'],
  parsed: {}, schemaValid: true, repairs: 0, refused: false,
  correct, fieldScore: correct ? 1 : 0, failureMode: correct ? null : 'x',
  confidence: { self_report: 0.9 }, queueMs: 0, serviceMs: 100,
  tokensIn: 10, tokensOut: 10, costUsd: 0.001, servedModel, retries: 0, cached: false,
  ts: '2026-01-01T00:00:00Z',
});

/** n items, first `errors` of them wrong. */
const run = (n: number, errors: number, version: string) =>
  Array.from({ length: n }, (_, i) => mk(`i${i}`, i >= errors, version));

test('identical re-run reads as stable', () => {
  const base = captureBaseline('r1', run(200, 20, 'v1'), true);
  const rows = compareToBaseline(base, run(200, 20, 'v1'));
  assert.equal(rows[0]!.verdict, 'STABLE');
  assert.equal(rows[0]!.brokeCount, 0);
});

test('the dangerous case: behaviour moved, version did not', () => {
  const base = captureBaseline('r1', run(200, 10, 'v1'), true);
  const now = run(200, 45, 'v1');                       // 35 more failures, same version string
  const rows = compareToBaseline(base, now);
  assert.equal(rows[0]!.verdict, 'SILENT_REGRESSION');
  assert.equal(rows[0]!.brokeCount, 35);
  assert.ok(rows[0]!.p! < 0.05);
  assert.match(rows[0]!.message, /paging someone/);
});

test('a version change with a real drop is an ordinary regression', () => {
  const base = captureBaseline('r1', run(200, 10, 'v1'), true);
  const rows = compareToBaseline(base, run(200, 45, 'v2'));
  assert.equal(rows[0]!.verdict, 'REGRESSED');
  assert.match(rows[0]!.message, /Pin the previous version/);
});

test('a version change with no behaviour change is noted, not acted on', () => {
  const base = captureBaseline('r1', run(200, 20, 'v1'), true);
  const rows = compareToBaseline(base, run(200, 20, 'v2'));
  assert.equal(rows[0]!.verdict, 'VERSION_CHANGED_BEHAVIOUR_HELD');
  assert.match(rows[0]!.message, /do not act on it/);
});

test('flat headline accuracy with heavy item churn is surfaced, not called stable', () => {
  // Same 90% both times, but a different 10% fails each run. Comparing two
  // accuracy percentages would report "no change" and be wrong about the system.
  const base = captureBaseline('r1', Array.from({ length: 200 }, (_, i) => mk(`i${i}`, i >= 20, 'v1')), true);
  const now = Array.from({ length: 200 }, (_, i) => mk(`i${i}`, !(i >= 20 && i < 40), 'v1'));
  const rows = compareToBaseline(base, now);
  assert.equal(rows[0]!.currentAccuracy, rows[0]!.baselineAccuracy);
  assert.equal(rows[0]!.verdict, 'NOISE');
  assert.ok(rows[0]!.brokeCount + rows[0]!.fixedCount >= 40);
});

test('improvement prompts a baseline recapture', () => {
  const base = captureBaseline('r1', run(200, 50, 'v1'), true);
  const rows = compareToBaseline(base, run(200, 10, 'v1'));
  assert.equal(rows[0]!.verdict, 'IMPROVED');
  assert.match(rows[0]!.message, /Recapture the baseline/);
});

test('a cell with no baseline is NEW, never silently compared', () => {
  const base = captureBaseline('r1', run(50, 5, 'v1'), true);
  const other = run(50, 5, 'v1').map((a) => ({ ...a, modelKey: 'different-model' }));
  const rows = compareToBaseline(base, other);
  assert.equal(rows[0]!.verdict, 'NEW');
});

test('items added or removed between runs do not count as drift', () => {
  const base = captureBaseline('r1', run(100, 10, 'v1'), true);
  const now = run(160, 16, 'v1');                       // 60 new items, same error rate
  const rows = compareToBaseline(base, now);
  assert.equal(rows[0]!.verdict, 'STABLE', 'new items are a change of ruler, not a regression');
});

test('ungradeable attempts on either side drop the pair rather than counting as failures', () => {
  const base = captureBaseline('r1', run(100, 5, 'v1'), true);
  const now = run(100, 5, 'v1').map((a, i) => (i < 30 ? { ...a, correct: null } : a));
  const rows = compareToBaseline(base, now);
  assert.equal(rows[0]!.brokeCount, 0);
  assert.equal(rows[0]!.verdict, 'STABLE');
});

test('minimum detectable effect shrinks with n and is honest about small samples', () => {
  assert.ok(minimumDetectableEffect(100, 0.9) > minimumDetectableEffect(1000, 0.9));
  assert.ok(minimumDetectableEffect(200, 0.9) > 0.05, 'n=200 cannot see a 5-point drop');
  assert.ok(minimumDetectableEffect(5000, 0.9) < 0.03);
});
