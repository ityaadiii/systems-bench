import type { Adapter, CompletionRequest, CompletionResponse, ModelSpec } from '../types.ts';
import { rng } from '../core/stats.ts';
import { createHash } from 'node:crypto';

/**
 * MOCK PROVIDER — SYNTHETIC OUTPUT, NOT EVIDENCE.
 *
 * This exists so the harness can be developed, tested and demonstrated with no
 * API keys and no bill. It fabricates answers from the ground truth. Nothing it
 * produces is a measurement of any real model, and no number derived from it
 * may be shown to anyone as a finding.
 *
 * Enforcement is structural, not a matter of remembering: every attempt it
 * produces is stamped `provider: 'mock'`, the run manifest flips `evidential`
 * to false the moment one such attempt appears, and the report renders a
 * full-width banner and a watermark it has no option to suppress. Given how
 * this artefact is used — screen-shared, on a call, at speed — a convention
 * would not have survived. See BLINDSPOTS.md #20.
 *
 * The personas below are deliberately drawn from failure shapes that show up in
 * real deployments, so the demo teaches the right lessons:
 *   overconfident — high accuracy, useless confidence signal
 *   honest        — lower accuracy, well-separated confidence, deploys better
 *   flat          — emits one confidence value; perfectly calibrated, unusable
 *   brittle       — fine on clean input, collapses on corruption
 */

export type Persona = {
  baseAccuracy: number;
  /** Extra error probability per corruption tag on the item. */
  corruptionPenalty: number;
  confidenceStyle: 'overconfident' | 'honest' | 'flat' | 'brittle';
  schemaFailureRate: number;
  hedgeRate: number;
  latencyMsMean: number;
  latencyMsTail: number;
};

export const PERSONAS: Record<string, Persona> = {
  'mock:overconfident-large': { baseAccuracy: 0.93, corruptionPenalty: 0.05, confidenceStyle: 'overconfident', schemaFailureRate: 0.01, hedgeRate: 0.01, latencyMsMean: 1900, latencyMsTail: 7000 },
  'mock:honest-mid':          { baseAccuracy: 0.88, corruptionPenalty: 0.06, confidenceStyle: 'honest',        schemaFailureRate: 0.02, hedgeRate: 0.03, latencyMsMean: 900,  latencyMsTail: 2600 },
  'mock:flat-small':          { baseAccuracy: 0.81, corruptionPenalty: 0.09, confidenceStyle: 'flat',          schemaFailureRate: 0.04, hedgeRate: 0.02, latencyMsMean: 380,  latencyMsTail: 1100 },
  'mock:brittle-local':       { baseAccuracy: 0.86, corruptionPenalty: 0.17, confidenceStyle: 'brittle',       schemaFailureRate: 0.09, hedgeRate: 0.06, latencyMsMean: 2600, latencyMsTail: 12000 },
};

const seedOf = (...parts: string[]): number =>
  parseInt(createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8), 16);

/** Type-aware corruption, so a wrong answer is wrong the way a model is wrong. */
function perturb(value: unknown, r: () => number): unknown {
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Math.abs(value) > 100) {
      const digits = String(Math.abs(value)).split('');
      const i = Math.floor(r() * digits.length);
      const swaps: Record<string, string> = { '0': '8', '1': '7', '5': '6', '8': '0', '7': '1', '6': '5', '3': '9', '9': '3', '2': '2', '4': '4' };
      digits[i] = swaps[digits[i]!] ?? '0';
      return Number(digits.join(''));
    }
    return Math.round(value * (1 + (r() - 0.5) * 0.3) * 100) / 100;
  }
  if (typeof value === 'string') {
    if (value.length < 3) return value + 'x';
    const i = 1 + Math.floor(r() * (value.length - 2));
    return value.slice(0, i) + value.slice(i + 1);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    const out = [...value];
    const i = Math.floor(r() * out.length);
    out[i] = perturb(out[i], r);
    // Dropping a row is the characteristic extraction failure, not just a typo.
    if (r() < 0.3 && out.length > 1) out.splice(Math.floor(r() * out.length), 1);
    return out;
  }
  if (value && typeof value === 'object') {
    const obj = { ...(value as Record<string, unknown>) };
    const keys = Object.keys(obj).filter((k) => k !== 'confidence');
    if (keys.length === 0) return obj;
    const k = keys[Math.floor(r() * keys.length)]!;
    obj[k] = perturb(obj[k], r);
    return obj;
  }
  return value;
}

function confidenceFor(style: Persona['confidenceStyle'], correct: boolean, corrupted: boolean, r: () => number): number {
  const pick = (vals: number[]) => vals[Math.floor(r() * vals.length)]!;
  switch (style) {
    // High and near-constant whether right or wrong: the signal carries almost
    // nothing, which is the most common real failure.
    case 'overconfident': return correct ? pick([0.95, 0.97, 0.99]) : pick([0.9, 0.95, 0.97]);
    // Genuinely separating, but OVERLAPPING — the distributions have to share a
    // middle band or the demo teaches a lie. No real model's confidence
    // partitions right from wrong cleanly; if it did, deployment would be a
    // solved problem and none of this would be worth building.
    case 'honest':        return correct ? pick([0.7, 0.8, 0.85, 0.9, 0.95, 0.99]) : pick([0.35, 0.5, 0.6, 0.7, 0.8, 0.9]);
    // One value, always. Perfect calibration, zero resolution, nothing to route on.
    case 'flat':          return 0.85;
    // Knows it is struggling only when the input is visibly mangled.
    case 'brittle':       return corrupted ? pick([0.35, 0.5, 0.65]) : correct ? pick([0.9, 0.95]) : pick([0.75, 0.85]);
  }
}

export function mockAdapter(spec: ModelSpec, persona: Persona): Adapter {
  return {
    spec,
    available: () => true,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const r = rng(seedOf(spec.key, JSON.stringify(req.mockTruth ?? {}), req.user.slice(0, 200)));
      const corruptionCount = Math.max(0, (req.user.match(/\n/g)?.length ?? 0) % 3);
      const pWrong = Math.min(0.95, (1 - persona.baseAccuracy) + persona.corruptionPenalty * corruptionCount);

      const samples = [];
      for (let i = 0; i < req.n; i++) {
        if (r() < persona.schemaFailureRate) {
          samples.push({ text: 'Here is the answer:\n\n{ "queue": "billing", ', meanLogprob: null });  // truncated JSON
          continue;
        }
        if (r() < persona.hedgeRate) {
          samples.push({ text: JSON.stringify({ error: 'insufficient information to answer confidently' }), meanLogprob: null });
          continue;
        }
        const correct = r() >= pWrong;
        const truth = req.mockTruth ?? {};
        const body = correct ? truth : perturb(structuredClone(truth), r);
        const conf = confidenceFor(persona.confidenceStyle, correct, corruptionCount > 0, r);
        samples.push({ text: JSON.stringify({ ...(body as object), confidence: conf }), meanLogprob: Math.log(Math.max(0.02, conf)) });
      }

      // Log-normal-ish latency: a long right tail is what real p95 looks like.
      const lat = persona.latencyMsMean + (persona.latencyMsTail - persona.latencyMsMean) * Math.max(0, r() - 0.85) / 0.15;
      return {
        samples,
        tokensIn: 400 + Math.floor(req.user.length / 4),
        tokensOut: 60 * req.n,
        servedModel: `${spec.model}-MOCK`,
        queueMs: 0,
        serviceMs: Math.round(lat),
        retries: 0,
      };
    },
  };
}
