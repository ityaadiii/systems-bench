import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilson, mcnemarExact, binomUpperTailHalf, probit, quantile, holm, pairCounts, bootstrapCI, rng } from './stats.ts';

const near = (a: number, b: number, tol = 1e-4) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} within ${tol} of ${b}`);

test('probit matches the textbook 97.5th percentile', () => {
  near(probit(0.975), 1.959964, 1e-5);
  near(probit(0.5), 0, 1e-9);
  near(probit(0.95), 1.644854, 1e-5);
});

test('Wilson: 10/10 has a lower bound of 0.7225, not 1.0', () => {
  const w = wilson(10, 10);
  near(w.lo, 0.7225, 1e-3);
  assert.ok(w.hi > 0.99);
});

test('Wilson: interval brackets the point estimate and narrows with n', () => {
  const small = wilson(9, 10), big = wilson(900, 1000);
  assert.ok(small.lo < 0.9 && small.hi > 0.9);
  assert.ok(big.hi - big.lo < small.hi - small.lo);
});

test('Wilson: degenerate n=0 is total ignorance, not a crash', () => {
  assert.deepEqual(wilson(0, 0), { lo: 0, hi: 1 });
});

test('binomial upper tail: P(X>=10 | n=12, p=0.5) = 79/4096', () => {
  near(binomUpperTailHalf(10, 12), 79 / 4096, 1e-9);
});

test('McNemar exact: b=10 c=2 gives p=0.03857', () => {
  near(mcnemarExact({ b: 10, c: 2, both: 100, neither: 88 }), 0.038574, 1e-5);
});

test('McNemar: no discordant pairs means no evidence of difference', () => {
  assert.equal(mcnemarExact({ b: 0, c: 0, both: 200, neither: 0 }), 1);
});

test('McNemar: a 4-point accuracy gap at n=200 can still be null', () => {
  // 8 vs 0 discordant reads as significant; 8 vs 4 does not. Same headline gap,
  // different pairing. This is the whole argument for paired testing.
  assert.ok(mcnemarExact({ b: 8, c: 0, both: 150, neither: 42 }) < 0.05);
  assert.ok(mcnemarExact({ b: 8, c: 4, both: 150, neither: 38 }) > 0.05);
});

test('pairCounts drops pairs where either side was ungradeable', () => {
  const p = pairCounts([true, null, false, true], [true, true, true, false]);
  assert.deepEqual(p, { b: 1, c: 1, both: 1, neither: 0 });
});

test('quantile is type-7 interpolated', () => {
  near(quantile([1, 2, 3, 4], 0.5), 2.5);
  near(quantile([1, 2, 3, 4], 0), 1);
  near(quantile([1, 2, 3, 4], 1), 4);
});

test('Holm is monotone, capped at 1, and only shrinks power where it must', () => {
  const out = holm([
    { key: 'a', p: 0.001 }, { key: 'b', p: 0.02 },
    { key: 'c', p: 0.04 }, { key: 'd', p: 0.9 },
  ]);
  near(out[0]!.pAdj, 0.004);
  near(out[1]!.pAdj, 0.06);
  assert.ok(out[1]!.significant === false, 'p=0.02 stops being significant across 4 tests');
  for (let i = 1; i < out.length; i++) assert.ok(out[i]!.pAdj >= out[i - 1]!.pAdj);
  assert.ok(out.every((o) => o.pAdj <= 1));
});

test('bootstrap recovers a known mean and is reproducible under seed', () => {
  const xs = Array.from({ length: 400 }, (_, i) => (i % 10 === 0 ? 1 : 0));
  const stat = (idx: number[]) => idx.reduce((a, i) => a + xs[i]!, 0) / idx.length;
  const a = bootstrapCI(xs.length, stat, { B: 500, seed: 42 });
  const b = bootstrapCI(xs.length, stat, { B: 500, seed: 42 });
  near(a.point, 0.1, 1e-9);
  assert.deepEqual(a, b, 'same seed must give the same interval');
  assert.ok(a.lo < 0.1 && a.hi > 0.1);
});

test('rng is deterministic and in range', () => {
  const r1 = rng(9), r2 = rng(9);
  for (let i = 0; i < 50; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});
