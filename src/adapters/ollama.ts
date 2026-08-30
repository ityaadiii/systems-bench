import type { Adapter, CompletionRequest, CompletionResponse, ModelSpec } from '../types.ts';
import { postJson } from './http.ts';

/**
 * Ollama, local. Zero marginal cost and zero data egress, which makes it the
 * only row on the grid a regulated customer can run inside their own network —
 * often the difference between a deployment that clears review and one that
 * does not.
 *
 * Priced at zero here, which is a simplification worth naming: local inference
 * costs GPU time and someone's electricity. For a like-for-like comparison at
 * scale, set a non-zero rate in pricing.json reflecting amortised hardware.
 *
 * THINKING MODE IS OFF BY DEFAULT. Qwen3 and its peers are hybrid reasoning
 * models that deliberate before answering unless told not to. On extraction and
 * classification that buys little and costs a lot: generations several times
 * longer, latency to match, and a p95 that reflects the deliberation budget
 * rather than the model. Leaving it on would have made every local column look
 * far slower than it is, for no accuracy gained.
 *
 * Pass `think: true` on the spec to measure the other side of that trade — it is
 * a legitimate bench question, just not the default.
 */
export function ollamaAdapter(spec: ModelSpec & { think?: boolean }, host: string | undefined): Adapter {
  return {
    spec,
    available: () => Boolean(host),
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      if (!host) throw new Error('OLLAMA_HOST not set');
      let tokensIn = 0, tokensOut = 0, queueMs = 0, serviceMs = 0, retries = 0;
      const samples = [];
      for (let i = 0; i < req.n; i++) {
        const r = await postJson(`${host.replace(/\/$/, '')}/api/chat`, {
          model: spec.model,
          stream: false,
          think: spec.think ?? false,
          format: req.schema,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          options: {
            temperature: i === 0 ? req.temperature : Math.max(req.temperature, 0.8),
            ...(req.seed !== undefined ? { seed: req.seed + i } : {}),
          },
        }, {}, { timeoutMs: 120_000, maxRetries: 1 });
        // 2 minutes, one retry. Local inference on laptop hardware is slow but
        // not THAT slow: a call past two minutes is wedged, and the old
        // 5-minute-times-four budget meant one bad request cost 25 minutes and
        // took the whole run with it.
        const j = r.json;
        samples.push({ text: j.message?.content ?? '', meanLogprob: null });
        tokensIn += j.prompt_eval_count ?? 0;
        tokensOut += j.eval_count ?? 0;
        queueMs += r.queueMs; serviceMs = Math.max(serviceMs, r.serviceMs); retries += r.retries;
      }
      return { samples, tokensIn, tokensOut, servedModel: spec.model, queueMs, serviceMs, retries };
    },
  };
}
