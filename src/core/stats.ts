/**
 * Statistics.
 *
 * A bench at n=200 that reports bare percentages is a bench that will one day
 * tell you a model got worse when it did not. Every number this file produces
 * carries either an interval or a p-value.
 *
 * Design notes that matter:
 *  - Accuracy intervals are Wilson, not Wald. Wald is degenerate near 0 and 1,
 *    which is exactly where model comparisons live.
 *  - Model-vs-model and run-vs-run comparisons are PAIRED. Every model sees the
 *    identical item set, so an unpaired two-proportion test throws away most of
 *    the power and inflates the variance with between-item difficulty.
 *  - Comparing m models across k dimensions is m*k simultaneous tests. Without
 *    a correction you manufacture a winner roughly one time in twenty per cell.
 *  - Everything random is seeded. An unreproducible bench is an anecdote.
 */

// ------------------------------------------------------------------ rng

/** mulberry32. Small, fast, seeded. Reproducibility is not optional here. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ normal

/** Inverse standard normal CDF. Acklam's rational approximation, |err| < 1.2e-9. */
export function probit(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError('probit expects 0 < p < 1');
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > ph) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
         (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

const zFor = (level: number) => probit(1 - (1 - level) / 2);

// ------------------------------------------------------------------ intervals

export type Interval = { lo: number; hi: number };

/**
 * Wilson score interval for a binomial proportion.
 * At n=10, k=10 this returns a lower bound of ~0.7225 — which is the honest
 * answer, and the reason we do not print "100%" without it.
 */
export function wilson(k: number, n: number, level = 0.95): Interval {
  if (n <= 0) return { lo: 0, hi: 1 };
  const z = zFor(level), z2 = z * z, p = k / n;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, centre - margin), hi: Math.min(1, centre + margin) };
}

// ------------------------------------------------------------------ binomial

/** log Γ(x), Lanczos g=7, n=9. Used for exact binomial tails without overflow. */
function lgamma(x: number): number {
  const g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = g[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += g[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const logChoose = (n: number, k: number) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

/** P(X >= k) for X ~ Binomial(n, 0.5). */
export function binomUpperTailHalf(k: number, n: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let s = 0;
  for (let i = k; i <= n; i++) s += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, s);
}

// ------------------------------------------------------------------ paired tests

export type Paired = {
  /** a right, b wrong */ b: number;
  /** a wrong, b right */ c: number;
  /** both right */ both: number;
  /** both wrong */ neither: number;
};

export function pairCounts(a: (boolean | null)[], b: (boolean | null)[]): Paired {
  if (a.length !== b.length) throw new Error('paired comparison needs aligned item vectors');
  let bb = 0, cc = 0, both = 0, neither = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    // An ungradeable attempt on either side removes the pair. Coercing it to
    // "wrong" would silently punish whichever model refused more, which is a
    // different property and is reported separately.
    if (x === null || y === null) continue;
    if (x && y) both++;
    else if (x && !y) bb++;
    else if (!x && y) cc++;
    else neither++;
  }
  return { b: bb, c: cc, both, neither };
}

/**
 * McNemar's exact test. Two-sided p for "these two models differ on this workload".
 * Exact rather than chi-square: at the discordant counts a 200-item bench
 * produces, the chi-square approximation is not trustworthy.
 * Worked check: b=10, c=2 -> p = 0.03857.
 */
export function mcnemarExact(p: Paired): number {
  const n = p.b + p.c;
  if (n === 0) return 1;
  return Math.min(1, 2 * binomUpperTailHalf(Math.max(p.b, p.c), n));
}

// ------------------------------------------------------------------ bootstrap

/**
 * Percentile bootstrap over ITEMS, not over attempts. Resampling attempts would
 * treat the same item scored by two models as two independent draws and shrink
 * the interval on a difference that is actually paired.
 */
export function bootstrapCI(
  n: number,
  statistic: (idx: number[]) => number,
  opts: { B?: number; level?: number; seed?: number } = {},
): Interval & { point: number } {
  const B = opts.B ?? 2000, level = opts.level ?? 0.95, r = rng(opts.seed ?? 1);
  const base = Array.from({ length: n }, (_, i) => i);
  const point = statistic(base);
  const draws: number[] = [];
  for (let bIdx = 0; bIdx < B; bIdx++) {
    const idx = new Array<number>(n);
    for (let i = 0; i < n; i++) idx[i] = Math.floor(r() * n);
    const v = statistic(idx);
    if (Number.isFinite(v)) draws.push(v);
  }
  draws.sort((x, y) => x - y);
  const a = (1 - level) / 2;
  return { point, lo: quantile(draws, a), hi: quantile(draws, 1 - a) };
}

/** Type-7 (linear interpolation) quantile, the R and NumPy default. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * p95 with a bootstrap interval. A bare p95 at n=200 is estimated from about ten
 * observations; printing it without an interval implies a precision that is not there.
 */
export function tailLatency(ms: number[], q = 0.95, seed = 7): Interval & { point: number } {
  const arr = [...ms];
  return bootstrapCI(arr.length, (idx) => {
    const s = idx.map((i) => arr[i]!).sort((a, b) => a - b);
    return quantile(s, q);
  }, { B: 1000, seed });
}

// ------------------------------------------------------------------ multiplicity

/**
 * Holm-Bonferroni. Strong family-wise error control, uniformly more powerful
 * than plain Bonferroni, and it makes no independence assumption — which we
 * could not defend anyway, since the same items are reused across every model.
 */
export function holm(pvals: { key: string; p: number }[]): { key: string; p: number; pAdj: number; significant: boolean }[] {
  const m = pvals.length;
  const order = [...pvals].sort((a, b) => a.p - b.p);
  let running = 0;
  const out = order.map((row, i) => {
    running = Math.max(running, Math.min(1, (m - i) * row.p));
    return { key: row.key, p: row.p, pAdj: running, significant: running < 0.05 };
  });
  return out;
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
