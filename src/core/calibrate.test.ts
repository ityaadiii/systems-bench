import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibration, fitIsotonic, coverageRisk, aurc, maxCoverageAtRisk } from './calibrate.ts';
import { rng } from './stats.ts';

const near = (a: number, b: number, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} within ${tol} of ${b}`);

/** conf p, correct with probability p. Well calibrated by construction. */
function honest(n: number, seed = 3) {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const conf = Math.round((0.5 + r() * 0.5) * 20) / 20;
    return { conf, correct: r() < conf };
  });
}

test('an honest model has small ECE', () => {
  const c = calibration(honest(4000));
  assert.ok(c.eceEqualMass < 0.03, `ece ${c.eceEqualMass}`);
});

test('an overconfident model is caught: says 0.99, right 70% of the time', () => {
  const pairs = Array.from({ length: 1000 }, (_, i) => ({ conf: 0.99, correct: i % 10 < 7 }));
  const c = calibration(pairs);
  near(c.eceEqualMass, 0.29, 1e-9);
  near(c.mce, 0.29, 1e-9);
});

test('THE ONE MOST BENCHES MISS: perfectly calibrated, zero resolution', () => {
  // Emits 0.7 on everything and is right 70% of the time. ECE is a flawless
  // zero. There is no threshold that separates anything, so it can automate
  // nothing. Reporting ECE alone would call this model excellent.
  const pairs = Array.from({ length: 1000 }, (_, i) => ({ conf: 0.7, correct: i % 10 < 7 }));
  const c = calibration(pairs);
  near(c.eceEqualMass, 0, 1e-9);
  near(c.resolution, 0, 1e-9);
  near(c.resolutionRatio, 0, 1e-9);
  near(c.brier, c.uncertainty, 1e-9);          // decomposition is exact here
  assert.equal(aurc(pairs), 0.3, 'no ordering means risk is the base rate at every coverage');
});

test('perfect resolution: brier 0, resolutionRatio 1', () => {
  const pairs = Array.from({ length: 1000 }, (_, i) => {
    const correct = i % 10 < 7;
    return { conf: correct ? 1 : 0, correct };
  });
  const c = calibration(pairs);
  near(c.brier, 0, 1e-9);
  near(c.reliability, 0, 1e-9);
  near(c.resolutionRatio, 1, 1e-9);
});

test('Murphy decomposition holds: brier = reliability - resolution + uncertainty', () => {
  const pairs = Array.from({ length: 2000 }, (_, i) => {
    const conf = [0.6, 0.75, 0.9, 0.99][i % 4]!;
    return { conf, correct: (i * 7919) % 100 < conf * 100 };
  });
  const c = calibration(pairs);
  near(c.brier, c.reliability - c.resolution + c.uncertainty, 1e-9);
});

test('discrete confidence does not collapse the bins', () => {
  // Every value the model can emit gets its own bin. Quantile binning on four
  // distinct values dedups to one bin and reports resolution 0.
  const pairs = Array.from({ length: 400 }, (_, i) => {
    const conf = [0.8, 0.9, 0.95, 0.99][i % 4]!;
    return { conf, correct: (i % 4) >= 2 };
  });
  const c = calibration(pairs);
  assert.equal(c.binsEqualMass.filter((b) => b.n > 0).length, 4);
  assert.ok(c.resolution > 0.2, 'a strong signal must not read as zero resolution');
});

test('isotonic fit is monotone and repairs an overconfident model', () => {
  const r = rng(11);
  // Raw confidence is inflated; true accuracy is roughly conf - 0.25.
  const data = Array.from({ length: 3000 }, () => {
    const conf = Math.round((0.6 + r() * 0.4) * 100) / 100;
    return { conf, correct: r() < Math.max(0, conf - 0.25) };
  });
  const fit = data.slice(0, 1500), held = data.slice(1500);
  const cal = fitIsotonic(fit);

  for (let i = 1; i < cal.knots.length; i++) assert.ok(cal.knots[i]!.y >= cal.knots[i - 1]!.y - 1e-12);

  const before = calibration(held).eceEqualMass;
  const after = calibration(held.map((p) => ({ conf: cal.apply(p.conf), correct: p.correct }))).eceEqualMass;
  assert.ok(after < before / 2, `ece ${before.toFixed(3)} -> ${after.toFixed(3)} on HELD-OUT items`);
});

test('coverage falls monotonically as the threshold rises', () => {
  const c = coverageRisk(honest(800));
  for (let i = 1; i < c.length; i++) assert.ok(c[i]!.coverage <= c[i - 1]!.coverage + 1e-12);
  near(c[0]!.coverage, 1, 1e-12);
});

test('AURC rewards knowing when you are wrong, at identical accuracy', () => {
  const n = 1000, errs = 200;
  const ranked = Array.from({ length: n }, (_, i) => ({ conf: 1 - i / n, correct: i < n - errs }));
  const blind = Array.from({ length: n }, (_, i) => ({ conf: 0.8, correct: i % 5 !== 0 }));
  const accA = ranked.filter((p) => p.correct).length / n;
  const accB = blind.filter((p) => p.correct).length / n;
  near(accA, accB, 1e-9);                       // same accuracy
  assert.ok(aurc(ranked) < aurc(blind) / 3);    // wildly different deployability
});

test('maxCoverageAtRisk uses the interval, not the point estimate', () => {
  const pairs = Array.from({ length: 300 }, (_, i) => ({ conf: 0.5 + (i / 300) * 0.5, correct: i > 30 }));
  const curve = coverageRisk(pairs);
  const optimistic = maxCoverageAtRisk(curve, 0.02, false)!;
  const careful = maxCoverageAtRisk(curve, 0.02, true)!;
  assert.ok(careful.coverage <= optimistic.coverage,
    'the conservative reading can never promise more coverage than the optimistic one');
});
