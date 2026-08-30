/**
 * One guarded model call, shared by every scenario.
 *
 * Exists because a single hung request took a 150-item run down with it: the
 * adapter timed out at five minutes, retried four times, and threw twenty-five
 * minutes later, discarding every item that had already succeeded. The main
 * runner has always recorded a failed call and moved on; the scenarios did not,
 * and inherited none of that discipline by being written later.
 *
 * A failure here is COUNTED and returned as null. Never dropped, never fatal.
 */

import type { Adapter } from '../types.ts';
import { Cache } from '../core/cache.ts';
import { extractJson, validate } from '../core/schema.ts';
import { costOf } from '../adapters/index.ts';

export type CallResult = {
  parsed: unknown | null;
  costUsd: number;
  cached: boolean;
  /** 'ok' | 'invalid' (unparseable or off-schema) | 'failed' (the call itself died) */
  status: 'ok' | 'invalid' | 'failed';
  error?: string;
};

export async function callModel(
  adapter: Adapter,
  cache: Cache,
  args: {
    scenario: string; system: string; user: string;
    schema: Record<string, unknown>; maxTokens: number;
    mockTruth?: unknown;
  },
): Promise<CallResult> {
  const key = cache.key({
    s: args.scenario, p: adapter.spec.provider, m: adapter.spec.model,
    u: args.user, sys: args.system,
  });
  try {
    let res = await cache.get<any>(key);
    const cached = res !== null;
    if (!res) {
      res = await adapter.complete({
        system: args.system, user: args.user, schema: args.schema,
        temperature: 0, maxTokens: args.maxTokens, n: 1,
        ...(adapter.spec.provider === 'mock' ? { mockTruth: args.mockTruth } : {}),
      });
      await cache.set(key, res);
    }
    const costUsd = cached ? 0 : costOf(adapter.spec, res.tokensIn, res.tokensOut);
    const parsed = extractJson(res.samples[0]?.text ?? '')?.value ?? null;
    const ok = parsed !== null && validate(parsed, args.schema as any).length === 0;
    return { parsed: ok ? parsed : null, costUsd, cached, status: ok ? 'ok' : 'invalid' };
  } catch (err) {
    return {
      parsed: null, costUsd: 0, cached: false, status: 'failed',
      error: err instanceof Error ? err.message.slice(0, 160) : String(err),
    };
  }
}
