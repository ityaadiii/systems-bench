#!/usr/bin/env node
/**
 * Systems Bench — four business archetypes, four evaluation machines.
 *
 *   node bench.ts scenarios [--n 120]   the four archetypes
 *   node bench.ts run [--n 200] [--samples 1] [--workloads a,b] [--models x,y] [--max-usd 5]
 *   node bench.ts report [runId]
 *   node bench.ts baseline <name> [runId]
 *   node bench.ts drift <name> [runId]
 *   node bench.ts audit --workload address [--sample 25]
 *   node bench.ts list
 *
 * No build step: Node strips the types. No dependencies: everything here is
 * readable in one sitting, which is the only property that makes a bench worth
 * believing.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import type { Attempt, Workload } from './src/types.ts';
import { discoverOllama, loadPricing, selectAdapters } from './src/adapters/index.ts';
import { addressWorkload } from './src/workloads/address/index.ts';
import { invoiceWorkload } from './src/workloads/invoice/index.ts';
import { ticketWorkload } from './src/workloads/ticket/index.ts';
import { run } from './src/core/runner.ts';
import { analyseWorkload } from './src/core/analyse.ts';
import { DEFAULT_ECONOMICS } from './src/core/economics.ts';
import { captureBaseline, compareToBaseline, loadBaseline, saveBaseline, minimumDetectableEffect } from './src/core/regress.ts';
import { buildReport } from './src/report/build.ts';
import { positionBias } from './src/workloads/ticket/index.ts';
import { SCENARIOS, runScenarios } from './src/scenarios/index.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- args + env

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) out[k!] = inline;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) out[k!] = argv[++i]!;
      else out[k!] = true;
    } else positional.push(a);
  }
  return { flags: out, positional };
}

/**
 * Minimal .env loader.
 *
 * It strips inline comments, and that is not a nicety. Without it the commented
 * placeholder shipped in .env.example —
 *     GOOGLE_API_KEY=          # https://aistudio.google.com/apikey
 * — parses as a non-empty value, so the bench believes it holds a Google key,
 * marks the run `evidential: true`, and renders a grid of 401s as if it were a
 * measurement. A credential check that passes on a comment is worse than no
 * check: it removes the banner that would have said the data was not real.
 */
async function loadEnv(): Promise<void> {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of (await readFile(p, 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !m[1] || process.env[m[1]]) continue;
    let v = m[2] ?? '';
    const quoted = /^(["']).*\1$/s.test(v);
    if (quoted) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();   // unquoted: drop trailing comment
    if (v === '') continue;                                          // empty is unset, not a credential
    if (/\s/.test(v)) {
      console.warn(`  ⚠  ${m[1]} in .env contains whitespace and is almost certainly not a key. Ignoring it.`);
      continue;
    }
    process.env[m[1]] = v;
  }
}

const WORKLOADS = (n: number): Record<string, () => Workload<any, any, any>> => ({
  address: () => addressWorkload(ROOT, n, 1),
  invoice: () => invoiceWorkload(n, 2),
  ticket: () => ticketWorkload(n, 3),
});

async function latestRunId(): Promise<string | null> {
  const dir = join(ROOT, 'runs');
  if (!existsSync(dir)) return null;
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return entries.length ? entries[entries.length - 1]! : null;
}

async function loadRun(runId: string): Promise<{ attempts: Attempt[]; manifest: any }> {
  const dir = join(ROOT, 'runs', runId);
  const attempts = (await readFile(join(dir, 'attempts.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Attempt);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  return { attempts, manifest };
}

// ---------------------------------------------------------------- commands

async function cmdRun(flags: Record<string, string | boolean>) {
  const n = Number(flags.n ?? 200);
  const samples = Number(flags.samples ?? 1);
  const pricing = loadPricing(ROOT);
  const only = typeof flags.models === 'string' ? flags.models.split(',') : undefined;
  const local = await discoverOllama(process.env.OLLAMA_HOST);
  const { adapters, evidential } = selectAdapters(process.env, pricing, only, local, ROOT);
  // The ceiling exists to protect real money. Mock "spend" is a simulated figure
  // the economics need in order to compute a cost per resolved unit — capping a
  // demo on imaginary rupees just truncates the run and quietly reports partial
  // results as if they were whole.
  const explicitCap = flags['max-usd'] ?? process.env.BENCH_MAX_USD;
  const maxUsd = explicitCap !== undefined ? Number(explicitCap) : (evidential ? 5 : 1e6);

  if (adapters.length === 0) { console.error('No models available. Add a key to .env, or run without --models.'); process.exit(1); }

  const wanted = typeof flags.workloads === 'string' ? flags.workloads.split(',') : Object.keys(WORKLOADS(n));
  const workloads = wanted.map((k) => WORKLOADS(n)[k]?.()).filter((w): w is Workload<any, any, any> => Boolean(w));
  if (workloads.length === 0) { console.error(`Unknown workload. Available: ${Object.keys(WORKLOADS(n)).join(', ')}`); process.exit(1); }

  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join(ROOT, 'runs', runId);

  console.log(`\n  run ${runId}`);
  console.log(`  models     ${adapters.map((a) => a.spec.key).join(', ')}`);
  console.log(`  workloads  ${workloads.map((w) => `${w.id}(${w.items.length})`).join(', ')}`);
  console.log(`  samples    ${samples} per item${samples > 1 ? '  (enables sampling-agreement confidence)' : '  (self-report confidence only; pass --samples 3 for agreement)'}`);
  console.log(`  ceiling    ${maxUsd >= 1e6 ? 'none (mock spend is simulated)' : '$' + maxUsd.toFixed(2)}`);
  if (!evidential) {
    console.log(`\n  ⚠  NO API KEYS FOUND — running the MOCK provider.`);
    console.log(`     Output is synthetic and is not evidence about any real model.`);
    console.log(`     The report will say so on every page. See BLINDSPOTS.md #20.`);
  }
  console.log('');

  let lastLine = 0;
  const { manifest, attempts } = await run(workloads, adapters, {
    runId, outDir, cacheDir: join(ROOT, '.cache'),
    maxUsd, concurrency: Number(flags.concurrency ?? 4), samples,
    temperature: Number(flags.temperature ?? 0), seed: Number(flags.seed ?? 1), evidential,
    onProgress: (done, total, spent) => {
      if (done - lastLine < Math.max(1, Math.floor(total / 40)) && done !== total) return;
      lastLine = done;
      const pct = Math.round((done / total) * 100);
      process.stdout.write(`\r  ${'█'.repeat(Math.round(pct / 2.5)).padEnd(40, '·')} ${String(pct).padStart(3)}%  $${spent.toFixed(4)}`);
    },
  });
  process.stdout.write('\n\n');

  for (const note of manifest.notes) console.log(`  note: ${note}`);
  console.log(`  ${attempts.length} attempts, $${manifest.totalCostUsd.toFixed(4)} spent, cached ${attempts.filter((a) => a.cached).length}`);
  console.log(`  → runs/${runId}\n`);
  await cmdReport({ }, runId);
}

async function cmdReport(_flags: Record<string, string | boolean>, explicitRunId?: string) {
  const runId = explicitRunId ?? (await latestRunId());
  if (!runId) { console.error('No runs found. Try: node bench.ts run'); process.exit(1); }
  const { attempts, manifest } = await loadRun(runId);
  const n = Math.max(...manifest.workloads.map((w: any) => w.n));
  const pricing = loadPricing(ROOT);

  const analyses = manifest.workloads.map((wm: any) => {
    const w = WORKLOADS(n)[wm.id]!();
    const a = analyseWorkload(w, attempts, manifest.models.map((m: any) => ({
      key: m.key, label: m.label,
      nativeSchema: Boolean(pricing.models.find((p) => p.key === m.key)) && /openai|google/.test(m.key),
    })), DEFAULT_ECONOMICS);
    if (wm.id === 'ticket') {
      const byModel = new Map<string, Map<string, boolean | null>>();
      for (const at of attempts.filter((x) => x.workloadId === 'ticket')) {
        const m = byModel.get(at.modelKey) ?? new Map();
        m.set(at.itemId, at.correct); byModel.set(at.modelKey, m);
      }
      const merged = new Map<string, boolean | null>();
      for (const [, m] of byModel) for (const [k, v] of m) if (!merged.has(k)) merged.set(k, v);
      a.positionBias = positionBias(w.items as any, merged);
    }
    return a;
  });

  const html = buildReport({ manifest, analyses, pricing, econ: DEFAULT_ECONOMICS, attempts });
  const out = join(ROOT, 'runs', runId, 'report.html');
  await writeFile(out, html, 'utf8');
  console.log(`  report → ${out}`);
  console.log(`  open with: open "${out}"\n`);
}

async function cmdBaseline(positional: string[]) {
  const name = positional[0];
  if (!name) { console.error('Usage: node bench.ts baseline <name> [runId]'); process.exit(1); }
  const runId = positional[1] ?? (await latestRunId());
  if (!runId) { console.error('No runs found.'); process.exit(1); }
  const { attempts, manifest } = await loadRun(runId);
  const p = await saveBaseline(ROOT, name, captureBaseline(runId, attempts, manifest.evidential));
  console.log(`  baseline "${name}" captured from ${runId} → ${p}`);
  if (!manifest.evidential) console.log(`  ⚠  captured from a MOCK run. It will detect harness changes, not model drift.`);
}

async function cmdDrift(positional: string[]) {
  const name = positional[0];
  if (!name) { console.error('Usage: node bench.ts drift <name> [runId]'); process.exit(1); }
  const base = await loadBaseline(ROOT, name);
  if (!base) { console.error(`No baseline named "${name}".`); process.exit(1); }
  const runId = positional[1] ?? (await latestRunId());
  const { attempts } = await loadRun(runId!);
  const rows = compareToBaseline(base, attempts);

  console.log(`\n  drift vs baseline "${name}" (captured ${base.capturedAt.slice(0, 10)})\n`);
  for (const r of rows) {
    const mark = r.verdict === 'SILENT_REGRESSION' ? '!!' : r.verdict === 'REGRESSED' ? ' !' : r.verdict === 'STABLE' ? '  ' : ' ~';
    const d = r.delta === null ? '   —  ' : `${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(1)}pt`;
    console.log(`${mark} ${r.workloadId.padEnd(9)} ${r.modelKey.padEnd(26)} ${r.verdict.padEnd(32)} ${d.padStart(7)}`);
    console.log(`     ${r.message}`);
  }
  const cell = rows[0];
  if (cell) {
    const nItems = base.cells[0]?.n ?? 0;
    const mde = minimumDetectableEffect(nItems, cell.currentAccuracy || 0.9) * 100;
    console.log(`\n  Conservative floor at 80% power: ~${mde.toFixed(1)} points.`);
    console.log(`  That is the UNPAIRED figure. The paired test above is more sensitive and will`);
    console.log(`  sometimes catch a smaller drop — but treat anything under ${mde.toFixed(1)}pt that does NOT`);
    console.log(`  reach significance as unmeasured, not as absent.\n`);
  }
}

async function cmdAudit(flags: Record<string, string | boolean>) {
  const id = String(flags.workload ?? 'address');
  const sample = Number(flags.sample ?? 25);
  // Must match the --n the run used, or the sampled items are from a different
  // eval set than the one being audited.
  const w = WORKLOADS(Number(flags.n ?? 400))[id];
  if (!w) { console.error(`Unknown workload "${id}".`); process.exit(1); }
  const wl = w();
  const step = Math.max(1, Math.floor(wl.items.length / sample));
  const picked = wl.items.filter((_, i) => i % step === 0).slice(0, sample);

  console.log(`\n  GROUND TRUTH AUDIT — ${wl.title}`);
  console.log(`  ${picked.length} of ${wl.items.length} items. Read each one and confirm the answer is right.`);
  console.log(`  A wrong label is charged to whichever model was right, and is invisible in every chart.\n`);
  for (const it of picked) {
    console.log(`  ${it.id}  [${it.tags.join(' ')}]`);
    console.log(`    in    ${JSON.stringify(it.input).slice(0, 220)}`);
    console.log(`    truth ${JSON.stringify(it.truth).slice(0, 220)}\n`);
  }
  const out = join(ROOT, 'runs', `audit-${id}.json`);
  await mkdir(join(ROOT, 'runs'), { recursive: true });
  await writeFile(out, JSON.stringify(picked, null, 2), 'utf8');
  console.log(`  written to ${out} — mark up any row you disagree with before the next run.\n`);
}

async function cmdScenarios(flags: Record<string, string | boolean>) {
  const n = Number(flags.n ?? 60);
  const pricing = loadPricing(ROOT);
  const local = await discoverOllama(process.env.OLLAMA_HOST);
  const only = typeof flags.models === 'string' ? flags.models.split(',') : undefined;
  const { adapters, evidential } = selectAdapters(process.env, pricing, only, local, ROOT);
  const wanted = typeof flags.scenarios === 'string' ? flags.scenarios.split(',') : Object.keys(SCENARIOS);
  const maxUsd = Number(flags['max-usd'] ?? (evidential ? 5 : 1e6));

  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log(`\n  scenarios ${wanted.join(', ')}`);
  console.log(`  models    ${adapters.map(a => a.spec.key).join(', ')}`);
  console.log(`  n         ${n} per scenario`);
  if (!evidential) console.log('  ⚠  MOCK provider — output is synthetic, not evidence.\n');

  let last = 0;
  const results = await runScenarios(wanted, adapters, {
    n, seed: Number(flags.seed ?? 1), cacheDir: join(ROOT, '.cache'), maxUsd,
    onProgress: (d, t) => {
      const pct = Math.round((d / t) * 100);
      if (pct - last < 5 && d !== t) return; last = pct;
      process.stdout.write(`\r  ${'█'.repeat(Math.round(pct/2.5)).padEnd(40,'·')} ${String(pct).padStart(3)}%`);
    },
  });
  process.stdout.write('\n\n');

  const dir = join(ROOT, 'runs', runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'scenarios.json'), JSON.stringify({ runId, evidential, results }, null, 2), 'utf8');

  for (const r of results) {
    console.log(`  ${r.archetype.padEnd(12)} ${r.account.padEnd(13)} ${r.modelLabel.replace(' (local)','').padEnd(22)} ${r.headline.value.padStart(10)}  ${r.headline.label}`);
    if (r.headline.sub) console.log(`  ${''.padEnd(48)} ${r.headline.sub}`);
  }
  console.log(`\n  → runs/${runId}/scenarios.json\n`);
}

async function cmdList() {
  const pricing = loadPricing(ROOT);
  const local = await discoverOllama(process.env.OLLAMA_HOST);
  const all = selectAdapters(process.env, pricing, undefined, local, ROOT);
  console.log('\n  workloads');
  for (const [k, f] of Object.entries(WORKLOADS(50))) {
    const w = f();
    console.log(`    ${k.padEnd(10)} ${w.title.padEnd(38)} ${w.vertical}`);
    console.log(`    ${''.padEnd(10)} ${w.humanSecondsPerUnit}s manual per ${w.unit}, ${w.reworkSecondsPerEscapedError}s to undo an escaped error`);
  }
  console.log(`\n  models on this machine (${all.evidential ? 'LIVE' : 'MOCK — no API keys found'})`);
  for (const a of all.adapters) console.log(`    ${a.spec.key.padEnd(34)} ${a.spec.label}`);
  if (process.env.OLLAMA_HOST) {
    console.log(local.length
      ? `\n  ollama is up with ${local.length} model(s) installed: ${local.join(', ')}`
      : `\n  ollama is reachable but has no models. Try: ollama pull qwen2.5:7b-instruct`);
  }
  const stale = pricing.models.filter((m) => !m.verified);
  if (stale.length) console.log(`\n  ⚠  ${stale.length} price entries unverified. Check data/pricing.json before quoting any rupee figure.\n`);
}

// ---------------------------------------------------------------- entry

const { flags, positional } = parseArgs(process.argv.slice(2));
await loadEnv();
const cmd = positional[0] ?? 'list';
const rest = positional.slice(1);

switch (cmd) {
  case 'run': await cmdRun(flags); break;
  case 'scenarios': await cmdScenarios(flags); break;
  case 'report': await cmdReport(flags, rest[0]); break;
  case 'baseline': await cmdBaseline(rest); break;
  case 'drift': await cmdDrift(rest); break;
  case 'audit': await cmdAudit(flags); break;
  case 'list': await cmdList(); break;
  default:
    console.log(`Unknown command "${cmd}".\n  run | scenarios | report | baseline <name> | drift <name> | audit --workload <id> | list`);
    process.exit(1);
}
