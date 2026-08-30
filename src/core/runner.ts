/**
 * The runner. One model, one workload, one item at a time, fully instrumented.
 *
 * Guarantees it makes, in the order they matter:
 *
 *  1. HARD COST CEILING. Checked before every call, not after. A bench that
 *     discovers it overspent is a bench that overspent.
 *  2. RESUMABLE. Every response is cached content-addressed, so a run that dies
 *     at item 340 continues rather than restarting — and the restart is what
 *     usually burns the budget.
 *  3. REPAIRS ARE COUNTED. Invalid JSON gets exactly one repair attempt, and it
 *     is recorded. A harness that silently retries until it parses is reporting
 *     a number that quietly includes a fixer the customer also has to run.
 *  4. REFUSALS ARE NOT ERRORS. A model that declines is recorded as refused,
 *     never coerced to "wrong". Those are different properties with different
 *     remedies, and merging them flatters cautious models and punishes them by
 *     turns depending on the workload.
 *  5. IDENTICAL ITEMS FOR EVERY MODEL, so every comparison downstream is paired.
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Adapter, Attempt, RunManifest, Workload } from '../types.ts';
import { costOf } from '../adapters/index.ts';
import { Cache } from './cache.ts';
import { extractJson, validate } from './schema.ts';
import { canonicalAnswer, fromLogprob, samplingAgreement, selfReport } from '../confidence/index.ts';

export type RunOptions = {
  runId: string;
  outDir: string;
  cacheDir: string;
  maxUsd: number;
  concurrency: number;
  /** Samples per item. >1 enables the sampling-agreement estimator at k times the cost. */
  samples: number;
  temperature: number;
  seed: number;
  evidential: boolean;
  onProgress?: (done: number, total: number, spentUsd: number) => void;
};

export class BudgetExceeded extends Error {}

const REFUSAL = /\b(cannot|can't|unable to|insufficient information|not enough information|I don't have)\b/i;

export async function run(
  workloads: Workload<any, any, any>[],
  adapters: Adapter[],
  opts: RunOptions,
): Promise<{ manifest: RunManifest; attempts: Attempt[] }> {
  await mkdir(opts.outDir, { recursive: true });
  const cache = new Cache(opts.cacheDir);
  const attemptsPath = join(opts.outDir, 'attempts.jsonl');
  const attempts: Attempt[] = [];
  const served = new Map<string, Set<string>>();
  const notes: string[] = [];

  let spentUsd = 0;
  let done = 0;
  const total = workloads.reduce((a, w) => a + w.items.length, 0) * adapters.length;

  type Job = { w: Workload<any, any, any>; a: Adapter; itemIndex: number };
  // Grouped by shared RESOURCE. Every local model lands in one group and takes
  // turns on the GPU; each hosted provider gets its own group and its own
  // parallelism. Groups run concurrently with each other.
  const byGroup = new Map<string, Job[]>();
  for (const w of workloads) {
    for (const a of adapters) {
      const g = a.spec.resourceGroup ?? a.spec.key;
      const list = byGroup.get(g) ?? [];
      for (let i = 0; i < w.items.length; i++) list.push({ w, a, itemIndex: i });
      byGroup.set(g, list);
    }
  }

  let aborted = false;

  const runJob = async (job: Job) => {
      const { w, a, itemIndex } = job;
      const item = w.items[itemIndex]!;

      // Checked BEFORE the call. Cached hits are free and do not count.
      if (spentUsd >= opts.maxUsd) {
        if (!aborted) {
          aborted = true;
          notes.push(`Run stopped at ${done}/${total} attempts: spend reached the $${opts.maxUsd.toFixed(2)} ceiling. Results below are partial and every interval is wider than it looks.`);
        }
        return;
      }

      const req = {
        system: w.systemPrompt,
        user: w.renderUser(item.input),
        schema: w.schema,
        temperature: opts.temperature,
        maxTokens: 2048,
        n: opts.samples,
        seed: opts.seed,
        ...(a.spec.provider === 'mock' ? { mockTruth: item.truth } : {}),
      };

      const key = cache.key({
        provider: a.spec.provider, model: a.spec.model, system: req.system, user: req.user,
        schema: req.schema, temperature: req.temperature, n: req.n, seed: req.seed,
      });

      let res = await cache.get<Awaited<ReturnType<Adapter['complete']>>>(key);
      let cached = res !== null;
      let repairs = 0;

      try {
        if (!res) {
          res = await a.complete(req);
          await cache.set(key, res);
        }

        let parsedSamples = res.samples.map((s) => extractJson(s.text)?.value ?? null);
        let primary = parsedSamples[0] ?? null;

        // One repair pass, then stop. If a model cannot produce valid JSON twice
        // that is a finding about the model, not a problem to engineer around.
        if (primary === null && !cached) {
          repairs = 1;
          const repairReq = {
            ...req, n: 1,
            user: `${req.user}\n\nYour previous reply was not valid JSON. Reply with the JSON object only, no prose, no code fences.`,
          };
          const rkey = cache.key({ ...key, repair: true, user: repairReq.user });
          let rres = await cache.get<typeof res>(rkey);
          if (!rres) { rres = await a.complete(repairReq); await cache.set(rkey, rres); }
          const rp = extractJson(rres.samples[0]?.text ?? '')?.value ?? null;
          if (rp !== null) { primary = rp; parsedSamples = [rp, ...parsedSamples.slice(1)]; }
          res = { ...res, tokensIn: res.tokensIn + rres.tokensIn, tokensOut: res.tokensOut + rres.tokensOut, retries: res.retries + rres.retries };
        }

        const errors = primary === null ? [{ path: '$', message: 'no JSON found' }] : validate(primary, w.schema);
        const schemaValid = errors.length === 0;
        const rawText = res.samples[0]?.text ?? '';
        const refused = primary === null ? REFUSAL.test(rawText)
          : typeof (primary as any)?.error === 'string' && REFUSAL.test(String((primary as any).error));

        // Gradeable means: valid shape AND not a refusal. Anything else scores
        // null and is excluded from accuracy, then reported on its own.
        const gradeable = schemaValid && !refused;
        const g = gradeable ? w.grade(item, primary) : null;

        const costUsd = cached ? 0 : costOf(a.spec, res.tokensIn, res.tokensOut);
        spentUsd += costUsd;

        const set = served.get(a.spec.key) ?? new Set<string>();
        set.add(res.servedModel);
        served.set(a.spec.key, set);

        const attempt: Attempt = {
          runId: opts.runId, workloadId: w.id, modelKey: a.spec.key, itemId: item.id,
          split: item.split, tags: item.tags,
          parsed: primary, schemaValid, repairs, refused,
          correct: g ? g.correct : null,
          fieldScore: g ? g.fieldScore : null,
          fieldVerdicts: g ? Object.fromEntries(g.fields.map((f) => [f.field, f.correct])) : null,
          failureMode: g ? g.failureMode : (refused ? 'refused' : 'invalid_output'),
          confidence: {
            ...(selfReport(primary) !== null ? { self_report: selfReport(primary)! } : {}),
            ...(samplingAgreement(parsedSamples) !== null ? { sampling_agreement: samplingAgreement(parsedSamples)! } : {}),
            ...(fromLogprob(res.samples[0]?.meanLogprob ?? null) !== null ? { mean_logprob: fromLogprob(res.samples[0]!.meanLogprob)! } : {}),
          },
          queueMs: res.queueMs, serviceMs: res.serviceMs,
          tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd,
          servedModel: res.servedModel, retries: res.retries, cached,
          ts: new Date().toISOString(),
        };
        attempts.push(attempt);
        await appendFile(attemptsPath, JSON.stringify(attempt) + '\n', 'utf8');
      } catch (err) {
        // A failed call is recorded, not dropped. Silently losing the attempts
        // that errored is how a flaky provider comes out looking reliable.
        const attempt: Attempt = {
          runId: opts.runId, workloadId: w.id, modelKey: a.spec.key, itemId: item.id,
          split: item.split, tags: item.tags,
          parsed: null, schemaValid: false, repairs, refused: false,
          correct: null, fieldScore: null, fieldVerdicts: null, failureMode: 'call_failed',
          confidence: {}, queueMs: 0, serviceMs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0,
          servedModel: 'error', retries: 0, cached: false, ts: new Date().toISOString(),
        };
        attempts.push(attempt);
        await appendFile(attemptsPath, JSON.stringify(attempt) + '\n', 'utf8');
        notes.push(`${a.spec.key} / ${w.id} / ${item.id}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
      } finally {
        done++;
        opts.onProgress?.(done, total, spentUsd);
      }
  };

  // One pool per RESOURCE GROUP. Local models share a single lane.
  await Promise.all([...byGroup.entries()].map(async ([, jobs]) => {
    const limit = Math.max(1, Math.min(jobs[0]?.a.spec.maxConcurrency ?? opts.concurrency, opts.concurrency));
    let cursor = 0;
    const worker = async () => {
      while (!aborted) {
        const idx = cursor++;
        if (idx >= jobs.length) return;
        await runJob(jobs[idx]!);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  }));

  // A model whose alias resolved to more than one version mid-run makes every
  // comparison involving it suspect. Say so loudly rather than averaging over it.
  for (const [k, versions] of served) {
    if (versions.size > 1) notes.push(`${k} served more than one version during this run (${[...versions].join(', ')}). Its numbers mix two models.`);
  }

  const manifest: RunManifest = {
    runId: opts.runId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    models: adapters.map((a) => ({
      key: a.spec.key, label: a.spec.label,
      servedModels: [...(served.get(a.spec.key) ?? [])],
      evidential: a.spec.provider !== 'mock',
    })),
    workloads: workloads.map((w) => ({ id: w.id, title: w.title, n: w.items.length })),
    evidential: opts.evidential && adapters.every((a) => a.spec.provider !== 'mock'),
    totalCostUsd: spentUsd,
    seed: opts.seed,
    notes,
  };
  await writeFile(join(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { manifest, attempts };
}

export { canonicalAnswer };
