/**
 * Provider registry.
 *
 * Resolution rule: a model is on the grid only if its credential is present.
 * A missing key produces an absent column, never an empty one and never a
 * silent fallback to something else — a bench that quietly substitutes a
 * provider is worse than a bench that runs three columns instead of five.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, ModelSpec } from '../types.ts';
import { anthropicAdapter } from './anthropic.ts';
import { openaiAdapter } from './openai.ts';
import { googleAdapter } from './google.ts';
import { ollamaAdapter } from './ollama.ts';
import { mockAdapter, PERSONAS } from './mock.ts';
import { gazetteerAdapter } from './gazetteer.ts';

export type Pricing = {
  usdInr: { rate: number; verifiedOn: string };
  models: { key: string; usdPerMTokIn: number; usdPerMTokOut: number; verifiedOn: string | null; verified: boolean; source: string }[];
};

export function loadPricing(root: string): Pricing {
  return JSON.parse(readFileSync(join(root, 'data', 'pricing.json'), 'utf8')) as Pricing;
}

/**
 * The catalogue. `model` strings are the aliases you request; the version that
 * actually serves the request is recorded per attempt and is what drift compares.
 * Edit these to match what your partners have actually given you access to.
 */
const CATALOGUE: (ModelSpec & { fixedTemperature?: boolean; completionTokensParam?: boolean; persona?: string })[] = [
  { key: 'anthropic:sonnet',  provider: 'anthropic', model: 'claude-sonnet-4-5',    label: 'Anthropic Sonnet',  usdPerMTokIn: 3,     usdPerMTokOut: 15,  logprobs: false, nativeSchema: false },
  { key: 'anthropic:haiku',   provider: 'anthropic', model: 'claude-haiku-4-5',     label: 'Anthropic Haiku',   usdPerMTokIn: 0.8,   usdPerMTokOut: 4,   logprobs: false, nativeSchema: false },
  { key: 'openai:mini',       provider: 'openai',    model: 'gpt-4o-mini',          label: 'OpenAI mini',       usdPerMTokIn: 0.15,  usdPerMTokOut: 0.6, logprobs: true,  nativeSchema: true },
  { key: 'openai:flagship',   provider: 'openai',    model: 'gpt-4o',               label: 'OpenAI flagship',   usdPerMTokIn: 2.5,   usdPerMTokOut: 10,  logprobs: true,  nativeSchema: true },
  { key: 'google:flash',      provider: 'google',    model: 'gemini-2.0-flash',     label: 'Google Flash',      usdPerMTokIn: 0.075, usdPerMTokOut: 0.3, logprobs: false, nativeSchema: true },
  { key: 'google:pro',        provider: 'google',    model: 'gemini-2.5-pro',       label: 'Google Pro',        usdPerMTokIn: 1.25,  usdPerMTokOut: 5,   logprobs: false, nativeSchema: true },

  { key: 'mock:overconfident-large', provider: 'mock', model: 'overconfident-large', label: 'MOCK overconfident', usdPerMTokIn: 3,    usdPerMTokOut: 15,  logprobs: false, nativeSchema: false, persona: 'mock:overconfident-large' },
  { key: 'mock:honest-mid',          provider: 'mock', model: 'honest-mid',          label: 'MOCK honest',        usdPerMTokIn: 0.8,  usdPerMTokOut: 4,   logprobs: false, nativeSchema: false, persona: 'mock:honest-mid' },
  { key: 'mock:flat-small',          provider: 'mock', model: 'flat-small',          label: 'MOCK flat',          usdPerMTokIn: 0.15, usdPerMTokOut: 0.6, logprobs: false, nativeSchema: false, persona: 'mock:flat-small' },
  { key: 'mock:brittle-local',       provider: 'mock', model: 'brittle-local',       label: 'MOCK brittle',       usdPerMTokIn: 0,    usdPerMTokOut: 0,   logprobs: false, nativeSchema: false, persona: 'mock:brittle-local' },
];

/**
 * Ask the local Ollama daemon what it actually has.
 *
 * Local models are discovered rather than listed, because a hardcoded entry for
 * a model nobody pulled produces a column of failures that reads like the model
 * is broken. Whatever is installed shows up; nothing else does.
 */
export async function discoverOllama(host: string | undefined): Promise<string[]> {
  if (!host) return [];
  try {
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const j = await res.json() as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name).sort();
  } catch { return []; }
}

const ollamaSpec = (model: string): ModelSpec & { think?: boolean } => ({
  key: `ollama:${model}`,
  provider: 'ollama',
  model,
  label: `${model.split(':')[0]} ${model.split(':')[1] ?? ''}`.trim() + ' (local)',
  // Zero marginal cost is a simplification: local inference burns GPU time and
  // power. See PRICING.md. Zero is defensible for a laptop; not at scale.
  usdPerMTokIn: 0,
  usdPerMTokOut: 0,
  logprobs: false,
  nativeSchema: true,
  // Hybrid reasoning models deliberate by default. Off for extraction work;
  // see the note in adapters/ollama.ts.
  think: false,
  // One at a time, across EVERY local model — they share one GPU.
  maxConcurrency: 1,
  resourceGroup: 'local-gpu',
});

export function buildAdapters(env: NodeJS.ProcessEnv, pricing: Pricing, ollamaModels: string[] = [], root = process.cwd()): Adapter[] {
  const priceOf = (key: string) => pricing.models.find((m) => m.key === key);
  const catalogue = [...CATALOGUE, ...ollamaModels.map(ollamaSpec)];
  // The no-model baseline is always present. It costs nothing to run and it
  // is the control every AI grid should have and almost never does.
  const extra: Adapter[] = [gazetteerAdapter(root)];
  const built = catalogue.map((raw) => {
    const p = priceOf(raw.key);
    const spec = p ? { ...raw, usdPerMTokIn: p.usdPerMTokIn, usdPerMTokOut: p.usdPerMTokOut } : raw;
    switch (spec.provider) {
      case 'anthropic': return anthropicAdapter(spec, env.ANTHROPIC_API_KEY);
      case 'openai':    return openaiAdapter(spec, env.OPENAI_API_KEY);
      case 'google':    return googleAdapter(spec, env.GOOGLE_API_KEY);
      case 'ollama':    return ollamaAdapter(spec, env.OLLAMA_HOST);
      case 'mock':      return mockAdapter(spec, PERSONAS[spec.persona!]!);
    }
  });
  return [...built, ...extra];
}

/**
 * Live providers if any credential is present, mock otherwise.
 *
 * Never both: mixing a real column with a fabricated one on the same grid is
 * how a demo turns into a false claim. All-real or all-mock, and the manifest
 * records which.
 */
export function selectAdapters(
  env: NodeJS.ProcessEnv,
  pricing: Pricing,
  only?: string[],
  ollamaModels: string[] = [],
  root = process.cwd(),
): { adapters: Adapter[]; evidential: boolean } {
  const all = buildAdapters(env, pricing, ollamaModels, root);
  const live = all.filter((a) => a.spec.provider !== 'mock' && a.available());
  if (live.length > 0) {
    const chosen = only?.length ? live.filter((a) => only.includes(a.spec.key)) : live;
    return { adapters: chosen, evidential: true };
  }
  const mocks = all.filter((a) => a.spec.provider === 'mock');
  return { adapters: only?.length ? mocks.filter((a) => only.includes(a.spec.key)) : mocks, evidential: false };
}

export const costOf = (spec: ModelSpec, tokensIn: number, tokensOut: number): number =>
  (tokensIn / 1e6) * spec.usdPerMTokIn + (tokensOut / 1e6) * spec.usdPerMTokOut;
