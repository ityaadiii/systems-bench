import type { Adapter, CompletionRequest, CompletionResponse, ModelSpec } from '../types.ts';
import { describeSchema } from '../core/schema.ts';
import { postJson } from './http.ts';

/**
 * OpenAI Chat Completions.
 *
 * The only provider here that returns token logprobs, which makes it the one
 * place we can compare a self-reported confidence against the model's own
 * internal probability on the same items. That comparison is worth the wiring:
 * where they disagree, the self-report is usually the one that is lying.
 *
 * Reasoning-family models reject `temperature` and rename the token cap. Handled
 * by feature flags on the spec instead of by try/catch on a 400, because a 400
 * costs a round trip and tells you the same thing.
 */
export function openaiAdapter(
  spec: ModelSpec & { fixedTemperature?: boolean; completionTokensParam?: boolean },
  apiKey: string | undefined,
): Adapter {
  return {
    spec,
    available: () => Boolean(apiKey),
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      if (!apiKey) throw new Error('OPENAI_API_KEY not set');
      const body: Record<string, unknown> = {
        model: spec.model,
        messages: [
          { role: 'system', content: `${req.system}\n\nReply with JSON only, matching this shape exactly:\n${describeSchema(req.schema)}` },
          { role: 'user', content: req.user },
        ],
        n: req.n,
        response_format: { type: 'json_object' },
      };
      body[spec.completionTokensParam ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens;
      if (!spec.fixedTemperature) body.temperature = req.temperature;
      if (spec.logprobs) { body.logprobs = true; body.top_logprobs = 1; }
      if (req.seed !== undefined) body.seed = req.seed;

      const r = await postJson('https://api.openai.com/v1/chat/completions', body, {
        authorization: `Bearer ${apiKey}`,
      });
      const j = r.json;
      return {
        samples: (j.choices ?? []).map((c: any) => {
          const lps: number[] = (c.logprobs?.content ?? []).map((t: any) => t.logprob).filter((x: any) => typeof x === 'number');
          return {
            text: c.message?.content ?? '',
            meanLogprob: lps.length ? lps.reduce((a, b) => a + b, 0) / lps.length : null,
          };
        }),
        tokensIn: j.usage?.prompt_tokens ?? 0,
        tokensOut: j.usage?.completion_tokens ?? 0,
        // The dated snapshot, not the alias we asked for. This single field is
        // the whole silent-drift detector.
        servedModel: j.model ?? spec.model,
        queueMs: r.queueMs, serviceMs: r.serviceMs, retries: r.retries,
      };
    },
  };
}
