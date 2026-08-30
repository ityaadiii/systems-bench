import type { Adapter, CompletionRequest, CompletionResponse, ModelSpec } from '../types.ts';
import { describeSchema } from '../core/schema.ts';
import { postJson } from './http.ts';

/**
 * Anthropic Messages API.
 *
 * Two provider facts that shape the bench rather than the other way round:
 *  - no token logprobs, so `mean_logprob` is unavailable here and the
 *    confidence comparison has to fall back to self-report and sampling
 *    agreement. Reported as null, never as zero.
 *  - no server-side n, so k samples cost k calls. The sampling-agreement
 *    estimator is priced accordingly instead of being treated as free.
 */
export function anthropicAdapter(spec: ModelSpec, apiKey: string | undefined): Adapter {
  return {
    spec,
    available: () => Boolean(apiKey),
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
      const system = `${req.system}\n\nReply with JSON only, matching this shape exactly:\n${describeSchema(req.schema)}`;

      let tokensIn = 0, tokensOut = 0, queueMs = 0, serviceMs = 0, retries = 0, servedModel = spec.model;
      const samples = [];
      for (let i = 0; i < req.n; i++) {
        const r = await postJson('https://api.anthropic.com/v1/messages', {
          model: spec.model,
          max_tokens: req.maxTokens,
          // Samples after the first need spread, or agreement is measured
          // against a near-deterministic copy of the first answer and reads as
          // certainty that was never tested.
          temperature: i === 0 ? req.temperature : Math.max(req.temperature, 0.8),
          system,
          messages: [{ role: 'user', content: req.user }],
        }, {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        });
        const j = r.json;
        samples.push({
          text: (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join(''),
          meanLogprob: null,
        });
        tokensIn += j.usage?.input_tokens ?? 0;
        tokensOut += j.usage?.output_tokens ?? 0;
        queueMs += r.queueMs; serviceMs = Math.max(serviceMs, r.serviceMs); retries += r.retries;
        if (j.model) servedModel = j.model;
      }
      return { samples, tokensIn, tokensOut, servedModel, queueMs, serviceMs, retries };
    },
  };
}
