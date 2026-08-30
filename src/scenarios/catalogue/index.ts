/**
 * ARCHETYPE A — VOLUME GRIND.  Hypothesised account: Meesho.
 *
 * Millions of seller-written listings, most typed on a phone by someone whose
 * first language is not English and whose incentive is search visibility rather
 * than accuracy. Titles are keyword-stuffed, code-mixed, ALL CAPS in bursts,
 * with size and colour buried in prose and the brand often absent or invented.
 *
 * This is the one archetype the standard benchmark shape actually fits: there
 * IS a right answer per item, the label is cheap, feedback is immediate, and
 * the objective really is cost per resolved unit. Everything the previous
 * version of this bench knew how to do applies here, unchanged.
 *
 * It is also, for exactly those reasons, the worst place to make money. It is
 * the most legible workload in the market, so it is the most benchmarked, the
 * most competed, and the most easily priced per unit by a procurement team.
 */

import type { Adapter } from '../../types.ts';
import type { Scenario, ScenarioResult, RunOpts } from '../types.ts';
import { rng } from '../../core/stats.ts';
import { Cache } from '../../core/cache.ts';
import { callModel } from '../call.ts';
import { calibration, coverageRisk, aurc } from '../../core/calibrate.ts';
import { wilson } from '../../core/stats.ts';

type Item = { id: string; raw: string; truth: Truth; tags: string[] };
type Truth = { category: string; brand: string; colour: string; size: string; material: string };

const CATS = [
  ['Kurta & Kurti', ['Cotton','Rayon','Georgette','Crepe'], ['S','M','L','XL','XXL']],
  ['Sarees', ['Silk','Georgette','Cotton','Chiffon'], ['Free Size']],
  ['Mens T-Shirts', ['Cotton','Polyester','Cotton Blend'], ['S','M','L','XL']],
  ['Kids Ethnic Wear', ['Cotton','Rayon'], ['1-2Y','3-4Y','5-6Y']],
  ['Home Bedsheets', ['Cotton','Microfibre','Polycotton'], ['Single','Double','King']],
  ['Kitchen Storage', ['Plastic','Steel','Glass'], ['500ml','1L','2L']],
  ['Mobile Covers', ['Silicone','Polycarbonate','Leather'], ['Free Size']],
  ['Womens Footwear', ['PU','Rubber','Synthetic'], ['4','5','6','7','8']],
] as const;

const COLOURS = ['Blue','Black','Red','Green','Yellow','Pink','White','Maroon','Navy','Beige','Mustard','Grey'];
const BRANDS = ['Anouk','Vaamsi','Sharda Creation','Fabclub','Kesarya','Trendy Fab','Jaipuri Adaah','Shreeji', 'Divena', 'Aayu'];

/** Seller-speak. Every transform is one real listing habit. */
const STUFF = ['for girls','for ladies','party wear','daily wear','latest design 2026','new collection',
  'best quality','combo pack','free delivery','trending','stylish','fancy','premium quality','under 500'];

function makeListing(t: Truth, brand: string, r: () => number): { raw: string; tags: string[] } {
  const tags: string[] = [];
  var parts = [t.category.replace(' & ', ' '), t.colour, t.material];
  if (r() < 0.62) parts.unshift(brand); else tags.push('brand_absent');
  if (r() < 0.75) parts.push('Size ' + t.size); else tags.push('size_buried');

  // keyword stuffing: the dominant habit, and the thing that breaks naive extraction
  var stuffCount = Math.floor(r() * 4);
  for (var i = 0; i < stuffCount; i++) parts.push(STUFF[Math.floor(r() * STUFF.length)]!);
  if (stuffCount >= 2) tags.push('keyword_stuffed');

  var s = parts.join(' ');
  if (r() < 0.3) { s = s.toUpperCase(); tags.push('all_caps'); }
  if (r() < 0.35) { s = s.replace(/\s/g, r() < 0.5 ? ' | ' : ' '); tags.push('delimiter_noise'); }
  if (r() < 0.28) { s += ' ' + ['सुंदर','नया','बेस्ट'][Math.floor(r() * 3)]; tags.push('devanagari'); }
  if (r() < 0.22) { s = s.replace(/[aeiou]/i, ''); tags.push('misspelled'); }
  if (r() < 0.18) { s = '★ ' + s + ' ★★'; tags.push('symbols'); }
  if (r() < 0.2) { s = s.slice(0, Math.max(24, Math.floor(s.length * 0.62))); tags.push('truncated'); }
  return { raw: s.replace(/\s+/g, ' ').trim(), tags: tags.length ? tags : ['clean'] };
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['category','brand','colour','size','material','confidence'],
  properties: {
    category: { type: 'string', enum: CATS.map(c => c[0] as string) },
    brand: { type: 'string', description: 'empty string if not stated' },
    colour: { type: 'string' }, size: { type: 'string' }, material: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const SYSTEM =
  'You normalise marketplace listings written by Indian sellers on their phones.\n\n' +
  'Titles are keyword-stuffed for search, mix Hindi and English, and bury size and colour in prose. ' +
  'Extract the true attributes and ignore the marketing filler.\n' +
  'Return an empty string for ANY attribute the listing does not state. Do not infer a plausible value: ' +
  'an invented attribute is worse than a blank one, because nothing downstream can tell it was invented.\n' +
  'Set confidence to your probability that EVERY field is correct.';

export function build(n: number, seed: number): Item[] {
  const r = rng(seed), items: Item[] = [];
  for (let i = 0; i < n; i++) {
    const c = CATS[Math.floor(r() * CATS.length)]!;
    const truth: Truth = {
      category: c[0], material: c[1][Math.floor(r() * c[1].length)]!,
      size: c[2][Math.floor(r() * c[2].length)]!,
      colour: COLOURS[Math.floor(r() * COLOURS.length)]!,
      brand: BRANDS[Math.floor(r() * BRANDS.length)]!,
    };
    const { raw, tags } = makeListing(truth, truth.brand, r);
    items.push({ id: `cat-${String(i).padStart(4,'0')}`, raw, tags, truth });
  }
  return items;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');

/**
 * TRUTH IS DERIVED FROM THE TEXT, NOT FROM THE RECORD IT CAME FROM.
 *
 * The generator knows the size is "5-6Y". The listing it produced says nothing
 * about size. Demanding "5-6Y" anyway marks a model wrong for correctly
 * declining to invent one, and rewards whichever model hallucinates the most
 * plausible value. That is the third time this exact defect has appeared in
 * this project, in three different workloads, which is what makes it a class
 * rather than a slip: any generator that keeps a record and shows a degraded
 * view of it will demand more than it showed unless truth is re-derived.
 *
 * So each field returns the set of answers a careful human would accept:
 * the value when it survived into the text, the surviving fragment when it was
 * truncated mid-way, and an empty string whenever it is simply not there.
 */
export function acceptableFor(value: string, raw: string): string[] {
  const nv = norm(value), nr = norm(raw);
  if (nv && nr.indexOf(nv) >= 0) return [nv];
  for (let len = nv.length - 1; len >= 3; len--) {
    if (nr.indexOf(nv.slice(0, len)) >= 0) return ['', nv.slice(0, len)];   // truncated: abstain or report the fragment
  }
  return [''];
}

export function catalogueScenario(): Scenario {
  return {
    id: 'catalogue',
    account: 'Meesho',
    accountNote: 'Hypothesised from a marketplace model built on very large numbers of small, phone-typed sellers.',
    archetype: 'volume',
    title: 'Seller listing → structured catalogue',
    brief: 'Millions of seller-written listings, keyword-stuffed and code-mixed, have to become structured attributes before anything downstream, search, filters, recommendations, can work.',
    whyThisMethod: 'A right answer exists per listing, labels are cheap, and feedback is immediate. Item-level grading is valid here, and this is the only one of the four where it is.',
    scale: { volume: 4_000_000, valuePerDecisionInr: 1.6 },

    async run(adapter: Adapter, opts: RunOpts): Promise<ScenarioResult> {
      const items = build(opts.n, opts.seed);
      const cache = new Cache(opts.cacheDir);
      const pairs: { conf: number; correct: boolean }[] = [];
      const outcomes: { correct: boolean | null; conf: number; costUsd: number }[] = [];
      let spent = 0, invalid = 0, invented = 0, failed = 0, done = 0;
      const byTag = new Map<string, { n: number; k: number }>();

      for (const it of items) {
        if (spent >= opts.maxUsd) break;
        const call = await callModel(adapter, cache, {
          scenario: 'catalogue', system: SYSTEM, user: `Listing:\n${it.raw}`,
          schema: SCHEMA as Record<string, unknown>, maxTokens: 400, mockTruth: it.truth,
        });
        const cost = call.costUsd; spent += cost;
        const parsed = call.parsed;
        const ok = call.status === 'ok';
        if (call.status === 'invalid') invalid++;
        if (call.status === 'failed') failed++;
        const p: any = parsed;
        let correct: boolean | null = null;
        if (ok) {
          const ok1 = (got: unknown, want: string) => acceptableFor(want, it.raw).indexOf(norm(got)) >= 0;
          const fields = [
            // Category is always inferable from the listing, so it is graded strictly.
            norm(p.category) === norm(it.truth.category),
            ok1(p.brand, it.truth.brand),
            ok1(p.colour, it.truth.colour),
            ok1(p.size, it.truth.size),
            ok1(p.material, it.truth.material),
          ];
          correct = fields.every(Boolean);
          // Inventing an attribute the listing never stated is the failure that
          // actually costs a marketplace money, so it is counted separately.
          for (const [got, want] of [[p.brand, it.truth.brand],[p.colour,it.truth.colour],[p.size,it.truth.size],[p.material,it.truth.material]] as [unknown,string][]) {
            const acc = acceptableFor(want, it.raw);
            if (acc.length === 1 && acc[0] === '' && norm(got) !== '') { invented++; break; }
          }
          const conf = typeof p.confidence === 'number' ? Math.min(1, Math.max(0, p.confidence)) : 0.5;
          pairs.push({ conf, correct });
          outcomes.push({ correct, conf, costUsd: cost });
          for (const t of it.tags) {
            const b = byTag.get(t) ?? { n: 0, k: 0 };
            b.n++; if (correct) b.k++; byTag.set(t, b);
          }
        } else {
          outcomes.push({ correct: null, conf: 0, costUsd: cost });
        }
        done++; opts.onProgress?.(done, items.length);
      }

      const graded = pairs.length;
      const acc = graded ? pairs.filter(p => p.correct).length / graded : 0;
      const curve = coverageRisk(pairs);
      const cal = calibration(pairs);

      // Volume economics: 30s of human handling per listing, 2% escaped-error
      // budget, and inference charged on every item whether or not it is trusted.
      const HUMAN_S = 30, WAGE = 238, V = 4_000_000;
      const usdPerUnit = outcomes.length ? outcomes.reduce((a,o) => a + o.costUsd, 0) / outcomes.length : 0;
      const best = curve.filter(p => p.nAuto > 0 && p.riskCi.hi <= 0.02).sort((a,b) => b.coverage - a.coverage)[0] ?? null;
      const cov = best ? best.coverage : 0;
      const manualInr = (V * HUMAN_S / 3600) * WAGE;
      const reviewInr = (V * (1 - cov) * HUMAN_S * 0.35 / 3600) * WAGE;
      const inferInr = usdPerUnit * 88 * V;
      const value = manualInr - (reviewInr + inferInr);

      return {
        scenarioId: 'catalogue', account: 'Meesho', archetype: 'volume',
        modelKey: adapter.spec.key, modelLabel: adapter.spec.label,
        valueInrPerMonth: value, baselineInrPerMonth: manualInr,
        headline: {
          label: 'Auto-approved inside a 2% error budget',
          value: best ? `${(cov * 100).toFixed(0)}%` : 'none',
          sub: `${(acc * 100).toFixed(1)}% accurate on ${graded} graded`,
        },
        detail: {
          accuracy: acc, accuracyCi: wilson(pairs.filter(p=>p.correct).length, graded),
          n: graded, invalid, failed, inventedBrands: invented,
          aurc: graded ? aurc(pairs) : null,
          ece: cal.eceEqualMass, resolution: cal.resolutionRatio,
          coverage: cov, curve: curve.filter(p => p.nAuto > 0),
          usdPerUnit, manualInr, reviewInr, inferInr,
          // Cells under ten items are dropped rather than ranked: at n=4 the interval
          // is wider than any effect the row could be showing.
          byTag: [...byTag.entries()].filter(([,b]) => b.n >= 10).map(([tag,b]) => ({ tag, n: b.n, acc: b.k / b.n })).sort((a,b) => a.acc - b.acc),
        },
        caveats: [
          'Listings are generated from structured records and then degraded with documented seller habits, so the mess is realistic in kind but not sampled from a real catalogue.',
          'Brand truth is empty whenever the seller never wrote one, so inventing a plausible brand counts as wrong. That is the failure mode that actually costs a marketplace money.',
        ],
        costUsd: spent, attempts: done,
      };
    },
  };
}
