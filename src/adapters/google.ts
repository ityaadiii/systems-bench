import type { Adapter, CompletionRequest, CompletionResponse, ModelSpec } from '../types.ts';
import { postJson } from './http.ts';

/**
 * Google Gemini. Enforces the JSON schema server-side, which removes a class of
 * structural failure the other providers leave to us.
 *
 * That is worth stating plainly rather than quietly enjoying: on the
 * schema-adherence dimension Gemini is not being measured on the same task as
 * the others, because part of the task has been done for it by the API. The
 * report flags any model with nativeSchema so a reader does not mistake a
 * platform feature for a model capability.
 */
export function googleAdapter(spec: ModelSpec, apiKey: string | undefined): Adapter {
  return {
    spec,
    available: () => Boolean(apiKey),
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      if (!apiKey) throw new Error('GOOGLE_API_KEY not set');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(spec.model)}:generateContent`;
      const r = await postJson(url, {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens,
          candidateCount: req.n,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(req.schema),
        },
      }, { 'x-goog-api-key': apiKey });

      const j = r.json;
      return {
        samples: (j.candidates ?? []).map((c: any) => ({
          text: (c.content?.parts ?? []).map((p: any) => p.text ?? '').join(''),
          meanLogprob: typeof c.avgLogprobs === 'number' ? c.avgLogprobs : null,
        })),
        tokensIn: j.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: j.usageMetadata?.candidatesTokenCount ?? 0,
        servedModel: j.modelVersion ?? spec.model,
        queueMs: r.queueMs, serviceMs: r.serviceMs, retries: r.retries,
      };
    },
  };
}

/** Gemini's schema dialect drops most validation keywords and wants upper-case types. */
function toGeminiSchema(s: any): any {
  if (!s || typeof s !== 'object') return s;
  const out: any = {};
  if (s.type) out.type = String(s.type).toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum.map(String);
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    if (s.required) out.required = s.required;
  }
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}
