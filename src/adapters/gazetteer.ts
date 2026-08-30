import type { Adapter, CompletionRequest, CompletionResponse, ModelSpec } from '../types.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE NO-MODEL BASELINE.
 *
 * A deterministic address resolver: a PIN directory, an alias table, and edit
 * distance. No inference, no tokens, no network, no provider. It exists to
 * answer the question every AI deployment should be asked first and almost
 * never is — **how much of this needs a model at all?**
 *
 * It implements the same Adapter interface as the labs, so it drops into the
 * grid as another column and the entire analysis stack works on it unchanged:
 * calibration, coverage-risk, economics, and — the interesting part — the
 * cascade optimiser, which will happily discover `gazetteer → model` on its own
 * if that is genuinely the cheapest design.
 *
 * Two things make this an honest baseline rather than a rigged one:
 *
 *  1. IT ABSTAINS. Where the address does not resolve, it says so with low
 *     confidence instead of guessing, so the confidence signal is real and the
 *     threshold machinery has something true to work with. A deterministic
 *     component that knows the edge of its own competence is the whole point;
 *     one that guesses is just a bad model.
 *
 *  2. IT IS USELESS OFF ITS WORKLOAD. Point it at invoices or tickets and it
 *     refuses outright. That asymmetry is the finding, not a limitation: free
 *     and near-perfect where it applies, worth nothing where it does not, and
 *     knowing which is which is what an FDE firm is actually paid for.
 *
 * The confidence values below are hand-set priors. Whether they are CALIBRATED
 * is not asserted here — it is measured by the bench, like everything else, and
 * the isotonic pass will correct them if they are wrong.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE QUOTING THE NUMBER.
 *
 * This resolver holds the same PIN directory the eval items were generated
 * from. That is realistic — India Post publishes it and any real deployment
 * would have it — but it means the comparison is a LOOKUP against models given
 * no reference data whatsoever. It is not lookup versus a well-built retrieval
 * system, and presenting it as such would be dishonest.
 *
 * So the finding is not "models are bad at addresses". It is:
 *
 *     a prompt-only LLM is the wrong tool for a lookup,
 *     and that is a statement about deployment architecture,
 *     not about model quality.
 *
 * Which is the more useful claim anyway, and the one an FDE firm gets paid for.
 *
 * Two further limits, both real:
 *  - 45 cities here. The actual directory is ~155k rows with genuine locality
 *    ambiguity, where fuzzy matching is far harder and this accuracy will fall.
 *  - The missing third arm is the same models WITH the directory in context.
 *    Until that is run, the honest comparison is incomplete, and the cascade
 *    (gazetteer first, model on the residue) is the design this actually argues
 *    for — not the gazetteer alone.
 * ---------------------------------------------------------------------------
 */

type Pin = { pincode: string; city: string; state: string };

const SERVICEABLE_STATES = new Set([
  'Delhi', 'Maharashtra', 'Karnataka', 'Telangana', 'Tamil Nadu',
  'Haryana', 'Gujarat', 'West Bengal', 'Uttar Pradesh', 'Rajasthan',
]);

/** Reverse of the abbreviations the corruption model applies, plus Devanagari. */
const EXPANSIONS: [RegExp, string][] = [
  [/\bngr\b/g, 'nagar'], [/नगर/g, 'nagar'], [/मार्ग/g, 'marg'],
  [/\brd\b/g, 'road'], [/\bst\b/g, 'street'], [/\bcly\b/g, 'colony'],
  [/\bsec\b/g, 'sector'], [/\bnr\b/g, 'near'], [/\bopp\b/g, 'opposite'],
  [/\bbldg\b/g, 'building'], [/\bapt\b/g, 'apartment'], [/\bblk\b/g, 'block'],
  [/\bph\b/g, 'phase'], [/\bextn\b/g, 'extension'], [/\bpo\b/g, 'post office'],
];

function normalise(s: string): string {
  let out = s.toLowerCase();
  for (const [re, rep] of EXPANSIONS) out = out.replace(re, rep);
  return out.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Levenshtein with an early bail. The directory here is tiny; a real 155k-row
 *  India Post load needs a BK-tree or a trigram index instead of a linear scan. */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      best = Math.min(best, cur[j]!);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export type Resolution = {
  pincode: string; city: string; state: string; serviceable: boolean;
  confidence: number; basis: string;
};

export function buildResolver(root: string): (raw: string) => Resolution {
  const j = JSON.parse(readFileSync(join(root, 'data', 'pincodes.json'), 'utf8'));
  const records = j.records as Pin[];
  const aliasMap = new Map<string, string>();
  for (const [canon, alts] of Object.entries(j.aliases as Record<string, string[]>)) {
    const c = canon.replace(/_state$/, '');
    for (const a of alts) aliasMap.set(a, c);
    aliasMap.set(c, c);
  }
  const byPin = new Map(records.map((r) => [r.pincode, r]));
  const cityKeys = records.map((r) => ({ key: normalise(r.city), rec: r }));
  const states = [...new Set(records.map((r) => r.state))];

  return (raw: string): Resolution => {
    const norm = normalise(raw);
    const tokens = norm.split(' ');

    // --- PIN, if one is present and known
    const pinTok = tokens.find((t) => /^\d{6}$/.test(t));
    const pinRec = pinTok ? byPin.get(pinTok) : undefined;

    // --- city, over 1- and 2-word windows, aliases first then fuzzy
    let bestCity: { rec: Pin; dist: number } | null = null;
    for (let w = 1; w <= 2; w++) {
      for (let i = 0; i + w <= tokens.length; i++) {
        const span = tokens.slice(i, i + w).join(' ');
        if (span.length < 4) continue;
        const canon = aliasMap.get(span);
        if (canon) {
          const rec = cityKeys.find((c) => c.key === canon)?.rec;
          if (rec) { bestCity = { rec, dist: 0 }; break; }
        }
        for (const c of cityKeys) {
          const d = editDistance(span, c.key, 2);
          if (d <= 2 && (!bestCity || d < bestCity.dist)) bestCity = { rec: c.rec, dist: d };
        }
      }
      if (bestCity?.dist === 0) break;
    }

    // --- state, as a fallback when no city resolves
    let bestState: string | null = null;
    for (const st of states) {
      const k = normalise(st);
      if (norm.includes(k)) { bestState = st; break; }
      for (const t of tokens) if (t.length > 4 && editDistance(t, k, 1) <= 1) { bestState = st; break; }
      if (bestState) break;
    }

    const out = (rec: Pin | null, conf: number, basis: string, pincode?: string): Resolution => ({
      pincode: pincode ?? rec?.pincode ?? '',
      city: rec?.city ?? '',
      state: rec?.state ?? bestState ?? '',
      serviceable: SERVICEABLE_STATES.has(rec?.state ?? bestState ?? ''),
      confidence: conf, basis,
    });

    // The locality wins over a PIN that disagrees with it — same rule the models
    // are given, so the comparison is like for like. A conflict is also evidence
    // that something is wrong, so confidence drops rather than staying high.
    if (bestCity && bestCity.dist === 0) {
      if (pinRec && pinRec.city === bestCity.rec.city) return out(bestCity.rec, 0.97, 'city+pin agree');
      if (pinRec) return out(bestCity.rec, 0.88, 'city exact, pin disagrees');
      return out(bestCity.rec, 0.92, 'city exact, no pin');
    }
    if (bestCity && bestCity.dist === 1) return out(bestCity.rec, 0.78, 'city fuzzy d=1');
    if (bestCity && bestCity.dist === 2) return out(bestCity.rec, 0.55, 'city fuzzy d=2');
    if (pinRec) return out(pinRec, 0.70, 'pin only');
    if (bestState) return out(null, 0.30, 'state only');
    return out(null, 0.05, 'unresolved');
  };
}

const NOT_APPLICABLE = JSON.stringify({
  error: 'insufficient information: this resolver only handles Indian postal addresses',
});

export function gazetteerAdapter(root: string): Adapter {
  const resolve = buildResolver(root);
  const spec: ModelSpec = {
    key: 'baseline:gazetteer',
    provider: 'ollama',            // reuses the local lane; nothing is served
    model: 'gazetteer',
    label: 'Gazetteer (no model)',
    usdPerMTokIn: 0, usdPerMTokOut: 0,
    logprobs: false, nativeSchema: true,
    maxConcurrency: 8,             // pure CPU, no device contention
    resourceGroup: 'deterministic',
  };
  return {
    spec,
    available: () => true,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const props = (req.schema as any)?.properties ?? {};
      const applicable = 'pincode' in props && 'city' in props && 'state' in props;
      const t0 = process.hrtime.bigint();
      const body = applicable
        ? (() => { const { basis, ...rest } = resolve(req.user.replace(/^Address:\s*/i, '')); return JSON.stringify(rest); })()
        : NOT_APPLICABLE;
      const serviceMs = Number(process.hrtime.bigint() - t0) / 1e6;
      return {
        samples: Array.from({ length: req.n }, () => ({ text: body, meanLogprob: null })),
        tokensIn: 0, tokensOut: 0,
        servedModel: 'gazetteer-v1',
        queueMs: 0,
        // Real measured wall time. Sub-millisecond, and that is the point.
        serviceMs: Math.max(serviceMs, 0.01),
        retries: 0,
      };
    },
  };
}
