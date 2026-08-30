/**
 * Report builder. One self-contained HTML file, no network, no libraries.
 *
 * Two rules govern what appears here:
 *
 *  1. Nothing is shown without its uncertainty. Every accuracy carries a Wilson
 *     interval, every p95 a bootstrap interval, every comparison a Holm-adjusted
 *     p-value, and every thin cell is greyed rather than ranked.
 *  2. A non-evidential run cannot be made to look evidential. The mock banner
 *     and watermark are emitted before anything else and there is no flag to
 *     turn them off.
 */

import type { Attempt, RunManifest } from '../types.ts';
import type { WorkloadAnalysis, Cell } from '../core/analyse.ts';
import { MIN_CELL } from '../core/analyse.ts';
import type { EconomicsConfig } from '../core/economics.ts';
import { draftAssistBreakEven, inr, minItemsToCertify } from '../core/economics.ts';
import type { Pricing } from '../adapters/index.ts';
import { barRow, coverageChart, reliabilityChart } from './charts.ts';
import { minimumDetectableEffect } from '../core/regress.ts';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const p1 = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
const p0 = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—');
const n3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '—');
const ms = (v: number) => (Number.isFinite(v) ? (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`) : '—');
const plural = (unit: string) => (/(s|x|ch|sh)$/i.test(unit) ? `${unit}es` : `${unit}s`);

const SOURCE_LABEL: Record<string, string> = {
  self_report: 'self-reported',
  sampling_agreement: 'sampling agreement',
  mean_logprob: 'mean logprob',
};

function verdictClass(cell: Cell): string {
  if (cell.nGradeable < MIN_CELL) return 'thin';
  if (!cell.deployment.feasible) return 'bad';
  if (cell.deployment.coverage >= 0.6) return 'good';
  if (cell.deployment.coverage >= 0.25) return 'warn';
  return 'bad';
}

export function buildReport(input: {
  manifest: RunManifest;
  analyses: WorkloadAnalysis[];
  pricing: Pricing;
  econ: EconomicsConfig;
  attempts: Attempt[];
}): string {
  const { manifest, analyses, pricing, econ } = input;
  const mock = !manifest.evidential;
  const unverified = pricing.models.filter((m) => !m.verified);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Partner Bench — ${esc(manifest.runId)}</title>
<style>${CSS}</style>
</head><body${mock ? ' class="is-mock"' : ''}>
${mock ? MOCK_BANNER : ''}

<header class="top">
  <div class="in">
    <div>
      <div class="eyebrow">Partner bench · run ${esc(manifest.runId)}</div>
      <h1>What each partner is worth <em>per workload</em></h1>
      <p class="lede">A leaderboard ranks models. This prices deployments.</p>
    </div>
    <dl class="meta">
      <div><dt>models</dt><dd>${manifest.models.length}</dd></div>
      <div><dt>workloads</dt><dd>${manifest.workloads.length}</dd></div>
      <div><dt>items each</dt><dd>${manifest.workloads[0]?.n ?? 0}</dd></div>
      <div><dt>spend</dt><dd>$${manifest.totalCostUsd.toFixed(2)}</dd></div>
    </dl>
  </div>
</header>

<main>
${manifest.notes.length ? `<section class="card notes"><h3>Run notes</h3><ul>${manifest.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}

${analyses.map((a) => workloadSection(a, econ)).join('\n')}

${methodSection(manifest, analyses, econ, unverified)}
</main>
</body></html>`;
}

// ------------------------------------------------------------------ sections

function workloadSection(a: WorkloadAnalysis, econ: EconomicsConfig): string {
  const ranked = [...a.cells].sort((x, y) => y.deployment.coverage - x.deployment.coverage);
  const bestSystem = a.systems.find((s) => s.design !== 'manual' && s.feasible) ?? null;
  const maxCost = Math.max(...a.systems.map((s) => s.totalInr));

  // Separate "no model can do this" from "this eval set is too small to prove
  // any model can". They look identical in the grid and mean opposite things.
  const need = minItemsToCertify(econ.maxEscapedErrorRate);
  const evalN = Math.max(0, ...a.cells.map((c) => c.sources.find((s) => s.source === c.bestSource)?.n ?? 0));
  const underpowered = evalN > 0 && evalN < need && a.cells.every((c) => !c.deployment.feasible);

  return `<section class="wl">
  <div class="wlhead">
    <div>
      <div class="eyebrow">${esc(a.vertical)}</div>
      <h2>${esc(a.title)}</h2>
      <p class="lede">${esc(a.n)} items · ${econ.monthlyVolume.toLocaleString('en-IN')} ${esc(plural(a.unit))}/month</p>
    </div>
  </div>

  <div class="verdict">
    <div><span class="vk">manual today</span><b class="vv">${inr(a.manual.totalInr)}</b><span class="vu">${a.manual.humanHoursPerMonth.toFixed(0)} hrs/mo</span></div>
    <div class="arrow">→</div>
    ${bestSystem
      ? `<div><span class="vk">best design</span><b class="vv good">${inr(bestSystem.totalInr)}</b><span class="vu">${esc(bestSystem.name)}</span></div>
         <div><span class="vk">automated</span><b class="vv">${p0(bestSystem.coverage)}</b><span class="vu">${p1(bestSystem.escapedErrorRate)} escapes</span></div>
         <div><span class="vk">saved</span><b class="vv good">${p0(bestSystem.savingsPct)}</b><span class="vu">${inr(bestSystem.savingsInr)}/mo</span></div>`
      : `<div><span class="vk">best design</span><b class="vv bad">none</b><span class="vu">nothing clears the error budget</span></div>`}
  </div>

  ${a.cells.some((c) => c.modelKey.startsWith('baseline:') && c.nGradeable >= MIN_CELL)
      ? `<p class="warnbox big"><b>Read the no-model baseline carefully.</b> The gazetteer holds the same PIN directory these items were generated from — realistic, since India Post publishes it and any deployment would have it, but it means this is a lookup measured against models given <i>no reference data at all</i>. It is not lookup versus retrieval. The claim it supports is <b>"a prompt-only LLM is the wrong tool for a lookup"</b> — an argument about architecture, not about model quality. The missing arm is the same models with the directory in context.</p>`
      : ''}
  ${underpowered ? `<p class="warnbox big"><b>This grid is underpowered, and that is the finding.</b> Certifying a ${p1(econ.maxEscapedErrorRate)} error budget requires roughly <b>${need}</b> evaluated items even from a model that makes no mistakes at all — the rule of three: zero failures in n trials puts the 95% upper bound at about 3/n. This workload evaluated <b>${evalN}</b>. So every "none" below means <i>this eval set cannot demonstrate the budget</i>, not that the model cannot hold it. Re-run with <code>--n ${Math.ceil(need * 2)}</code>. Reporting the first as the second is how a bench talks a partner out of a model that would have worked.</p>` : ''}
  <div class="grid">
    <table>
      <thead><tr>
        <th class="l">model</th><th>accuracy</th><th>valid JSON</th><th>refused</th>
        <th>p95</th><th>$/call</th><th>best signal</th><th>AURC</th><th>automatable</th><th>escaped</th><th>₹/unit</th>
      </tr></thead>
      <tbody>
      ${ranked.map((c) => {
        const src = c.sources.find((s) => s.source === c.bestSource);
        const thin = c.nGradeable < MIN_CELL;
        return `<tr class="${verdictClass(c)}">
          <td class="l"><b>${esc(c.label)}</b>${c.nativeSchema ? '<span class="tag" title="Provider enforces the JSON schema server-side. Its schema-adherence number reflects a platform feature, not a model capability.">native schema</span>' : ''}${thin ? '<span class="tag warn">thin</span>' : ''}<span class="sv">${esc(c.servedModels.join(', '))}</span></td>
          <td class="num">${p1(c.accuracy)}<span class="ci">${p0(c.accuracyCi.lo)}–${p0(c.accuracyCi.hi)}</span></td>
          <td class="num">${p0(c.schemaValidRate)}${c.repairRate > 0 ? `<span class="ci">${p0(c.repairRate)} repaired</span>` : ''}</td>
          <td class="num">${p0(c.refusalRate)}</td>
          <td class="num">${ms(c.latencyP95)}<span class="ci">${ms(c.latencyP95Ci.lo)}–${ms(c.latencyP95Ci.hi)}</span></td>
          <td class="num">$${c.usdPerCall.toFixed(5)}</td>
          <td class="num sm">${esc(SOURCE_LABEL[c.bestSource ?? ''] ?? '—')}</td>
          <td class="num">${src ? n3(src.aurc) : '—'}</td>
          <td class="num big">${c.deployment.feasible ? p0(c.deployment.coverage) : '<span class="no">none</span>'}</td>
          <td class="num">${c.deployment.feasible ? p1(c.deployment.escapedErrorRate) : '—'}</td>
          <td class="num">₹${c.deployment.costPerResolvedUnitInr.toFixed(2)}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
    <details class="fine"><summary>how these are computed</summary>
    <p>Accuracy carries a 95% Wilson interval; p95 a bootstrap interval. <b>Automatable</b> is the share auto-approvable while the <i>upper</i> bound on escaped errors stays within ${p1(econ.maxEscapedErrorRate)} — the conservative reading, so it under-promises. <span class="no">none</span> means no threshold holds at any coverage.</p></details>
  </div>

  <div class="two">
    <div class="card">
      <h3>What it would actually cost to run this</h3>
      <p class="sub">Same items, every design. Over-budget designs shown for contrast.</p>
      ${a.systems.slice(0, 9).map((s) => {
        const colour = s.design === 'manual' ? 'var(--faint)' : !s.feasible ? 'var(--bad)' : s === bestSystem ? 'var(--good)' : 'var(--accent)';
        // Cost-sorted, so an infeasible design can sit above the cheapest design
        // that actually holds. Marked inline rather than reordered: seeing what a
        // budget violation would have saved you is the point of showing it.
        const cap = s.design === 'manual'
          ? inr(s.totalInr)
          : `${inr(s.totalInr)}  ${s.savingsInr >= 0 ? '−' : '+'}${p0(Math.abs(s.savingsPct))}${s.feasible ? '' : '  ✕ over budget'}`;
        return barRow(`${s.name}${s.design === 'cascade' ? '  ⟶' : s.design === 'duet' ? '  ⇉' : ''}`, s.totalInr, maxCost, colour, cap, !s.feasible);
      }).join('')}
      ${bestSystem && bestSystem.models.length === 1 && bestSystem.models[0]?.toLowerCase().includes('no model')
        ? `<p class="insight"><b>The cheapest design that works has no model in it.</b> ${esc(bestSystem.name)} automates ${p0(bestSystem.coverage)} of this workload at ${inr(bestSystem.totalInr)} against ${inr(a.manual.totalInr)} manual, with ${p1(bestSystem.escapedErrorRate)} escaping. Every cascade that adds a model to it ties or costs more — the model contributes nothing this baseline had not already resolved. The useful question for a workload is not which lab, it is <i>whether it needs one</i>.</p>`
        : ''}
      ${bestSystem && bestSystem.design !== 'single'
        ? `<p class="insight"><b>The cheapest design is not a model, it is a composition.</b> ${bestSystem.design === 'cascade' ? `The expensive model sees only the ${p0(1 - bestSystem.thresholds[0]!)} the cheap one is unsure about.` : 'Only where two models independently agree is auto-approved.'} No leaderboard can surface this — it is not a property of any model on one.</p>`
        : ''}
      ${a.systems.filter((s) => !s.feasible && s.note)
          // When the workload banner already explains the underpowering, the
          // per-model notes repeat it verbatim once per row. Strip the shared
          // preamble and keep only what differs.
          .map((s) => ({ ...s, note: underpowered ? (s.note ?? '').replace(/^UNDERPOWERED[^.]*\.\s*/, '').replace(/Re-run with --n \d+\.\s*/, '') : s.note }))
          .filter((s) => (s.note ?? '').trim().length > 0)
          .slice(0, 2)
          .map((s) => `<p class="warnbox"><b>${esc(s.name)}:</b> ${esc(s.note)}</p>`).join('')}
    </div>

    <div class="card">
      <h3>Where the models actually disagree</h3>
      <p class="sub">Paired McNemar, Holm-corrected across all ${a.comparisons.length}.</p>
      ${a.comparisons.length === 0 ? '<p class="sub">Not enough gradeable items to compare.</p>' : `
      <table class="cmp"><thead><tr><th class="l">pair</th><th>gap</th><th>discordant</th><th>p (adj)</th><th></th></tr></thead><tbody>
      ${a.comparisons.slice(0, 8).map((c) => `<tr>
        <td class="l sm">${esc(labelOf(a, c.a))} vs ${esc(labelOf(a, c.b))}</td>
        <td class="num">${c.delta >= 0 ? '+' : ''}${(c.delta * 100).toFixed(1)}pt</td>
        <td class="num">${c.discordant}</td>
        <td class="num">${c.pAdj < 0.001 ? '&lt;0.001' : c.pAdj.toFixed(3)}</td>
        <td>${c.significant ? '<span class="pill good">real</span>' : '<span class="pill">noise</span>'}</td>
      </tr>`).join('')}
      </tbody></table>
      <p class="foot"><b>Discordant</b> = items where the two actually differed. That, not the gap, is what the test works with. Floor here: <b>${(minimumDetectableEffect(a.n, ranked[0]?.accuracy ?? 0.9) * 100).toFixed(1)}pt</b> at 80% power.</p>`}
    </div>
  </div>

  ${ranked.filter((c) => c.nGradeable >= MIN_CELL).slice(0, 4).map((c) => cellDetail(c, econ)).join('')}

  ${a.positionBias && a.positionBias.length > 1 ? positionPanel(a) : ''}
</section>`;
}

function labelOf(a: WorkloadAnalysis, key: string): string {
  return a.cells.find((c) => c.modelKey === key)?.label ?? key;
}

function cellDetail(c: Cell, econ: EconomicsConfig): string {
  const src = c.sources.find((s) => s.source === c.bestSource);
  const worstTags = c.byTag.filter((t) => t.tag !== 'clean').slice(0, 6);
  const cleanAcc = c.byTag.find((t) => t.tag === 'clean')?.accuracy;
  const maxTagN = Math.max(...c.byTag.map((t) => t.n), 1);

  return `<details class="detail">
  <summary><b>${esc(c.label)}</b> <span class="sm">${p1(c.accuracy)} accurate · ${c.deployment.feasible ? `${p0(c.deployment.coverage)} automatable` : 'automates nothing inside the budget'} · ${esc(c.servedModels.join(', '))}</span></summary>
  <div class="dbody">
    <div class="charts">
      <figure>
        ${src ? reliabilityChart(src.calibrationRaw.binsEqualMass, src.calibrationFitted.binsEqualMass) : ''}
        <figcaption><b>Is its confidence honest?</b> <span class="k bad"></span>stated <span class="k good"></span>recalibrated${src ? ` · ECE ${n3(src.calibrationRaw.eceEqualMass)} → ${n3(src.calibrationFitted.eceEqualMass)}` : ''}</figcaption>
      </figure>
      <figure>
        ${src ? coverageChart(src.curve, econ.maxEscapedErrorRate) : ''}
        <figcaption><b>How much can be let through?</b> Escaped-error rate as coverage rises. Band is the 95% interval.</figcaption>
      </figure>
    </div>

    ${src && src.calibrationRaw.resolutionRatio < 0.08 ? `<p class="insight bad"><b>Calibrated but unusable.</b> Resolution ${n3(src.calibrationRaw.resolutionRatio)} — confidence barely varies with being right. ECE alone would call this excellent; no threshold separates anything.</p>` : ''}

    ${c.byField.length > 1 ? `<div class="byfield">
      <h4>Accuracy by field</h4>
      ${c.byField.map((f) => barRow(
        f.field.replace(/_/g, ' ') + (f.scored ? '' : '  · not scored'),
        f.accuracy, 1,
        !f.scored ? 'var(--line-2)' : f.accuracy < 0.6 ? 'var(--bad)' : f.accuracy < 0.85 ? 'var(--warn-fill)' : 'var(--good)',
        `${p0(f.accuracy)}`, !f.scored)).join('')}
      ${c.byField.some((f) => !f.scored) ? `<p class="foot">A field marked <b>not scored</b> is graded and shown but kept out of the headline: its labels are one annotator's judgement, so scoring them would measure label consistency and charge it to the model.</p>` : ''}
    </div>` : ''}

    <div class="cols">
      <div>
        <h4>Where it fails</h4>
        ${c.failureModes.filter((f) => f.mode).slice(0, 6).map((f) =>
          barRow(f.mode.replace(/_/g, ' '), f.n, c.n, f.mode === 'refused' ? 'var(--info)' : f.mode === 'invalid_output' || f.mode === 'call_failed' ? 'var(--warn-fill)' : 'var(--bad)', String(f.n))).join('') || '<p class="sub">No failures recorded.</p>'}
      </div>
      <div>
        <h4>What breaks it</h4>
        ${cleanAcc !== undefined ? `<p class="sub">Clean input: <b>${p1(cleanAcc)}</b>. Each bar is accuracy when that corruption is present.</p>` : ''}
        ${worstTags.map((t) => barRow(t.tag.replace(/_/g, ' '), t.accuracy, 1,
          t.thin ? 'var(--line-2)' : t.accuracy < 0.6 ? 'var(--bad)' : t.accuracy < 0.85 ? 'var(--warn-fill)' : 'var(--good)',
          `${p0(t.accuracy)}  n=${t.n}`, t.thin)).join('')}
        <p class="foot">Greyed = under ${MIN_CELL} items.</p>
      </div>
    </div>

    ${c.sources.length > 1 ? `<div class="srccmp">
      <h4>Which confidence signal to route on</h4>
      <table><thead><tr><th class="l">signal</th><th>ECE raw</th><th>ECE recal.</th><th>resolution</th><th>AURC ↓</th><th>after recal.</th><th>cost</th></tr></thead><tbody>
      ${c.sources.map((s) => `<tr class="${s.source === c.bestSource ? 'win' : ''}">
        <td class="l">${esc(SOURCE_LABEL[s.source])}</td>
        <td class="num">${n3(s.calibrationRaw.eceEqualMass)}</td>
        <td class="num">${n3(s.calibrationFitted.eceEqualMass)}</td>
        <td class="num">${n3(s.calibrationRaw.resolutionRatio)}</td>
        <td class="num"><b>${n3(s.aurc)}</b></td>
        <td class="num ${s.aurcAfterRecalibration > s.aurc + 1e-9 ? 'worse' : ''}">${n3(s.aurcAfterRecalibration)}</td>
        <td class="num sm">${s.source === 'sampling_agreement' ? 'k× calls' : 'free'}</td>
      </tr>`).join('')}
      </tbody></table>
      <details class="fine"><summary>why AURC and not ECE</summary><p>A flat, useless signal wins ECE outright. Recalibration is monotone — it can never <i>improve</i> ranking, and where the last column is worse it has pooled distinct values into one, unseparable by any threshold. Hence: curve on raw ordering, probability labels recalibrated.</p></details>
    </div>` : ''}

    ${c.deployment.note ? `<p class="warnbox">${esc(c.deployment.note.replace(/^UNDERPOWERED[^.]*\.\s*/, '').replace(/Re-run with --n \d+\.\s*/, ''))}</p>` : ''}
  </div>
</details>`;
}

function positionPanel(a: WorkloadAnalysis): string {
  const rows = a.positionBias!;
  const spread = Math.max(...rows.map((r) => r.accuracy)) - Math.min(...rows.map((r) => r.accuracy));
  return `<div class="card">
    <h3>Control: does the order of the options change the answer?</h3>
    <p class="sub">Options shuffled per item. Slope here means the model is reading the list, not the message.</p>
    ${rows.map((r) => barRow(`position ${r.position + 1}`, r.accuracy, 1, spread > 0.1 ? 'var(--warn-fill)' : 'var(--good)', `${p0(r.accuracy)}  n=${r.n}`, r.n < MIN_CELL)).join('')}
    <p class="insight ${spread > 0.1 ? 'bad' : ''}">${spread > 0.1
      ? `<b>Position bias detected.</b> ${(spread * 100).toFixed(0)} points separate the best and worst option positions. Any evaluation on a fixed option order is measuring the order.`
      : `<b>No material position bias</b> — ${(spread * 100).toFixed(0)} points across positions, within noise at this sample size. Worth re-running whenever a model version changes.`}</p>
  </div>`;
}

function methodSection(manifest: RunManifest, analyses: WorkloadAnalysis[], econ: EconomicsConfig, unverified: { key: string }[]): string {
  return `<section class="card method">
  <h3>How to read this, and what it cannot tell you</h3>
  <div class="cols">
    <div>
      <h4>Assumptions every rupee depends on</h4>
      <ul>
        <li>Loaded labour <b>₹${econ.wageInrPerHour}/hour</b>. Every INR figure scales linearly with this one number.</li>
        <li>Volume <b>${econ.monthlyVolume.toLocaleString('en-IN')}</b> units/month per workload.</li>
        <li>Reviewing a correct draft takes <b>${econ.reviewFactorCorrect}×</b> from-scratch time; reviewing a wrong one takes <b>${econ.reviewFactorWrong}×</b>. Below <b>${p0(draftAssistBreakEven(econ))}</b> accuracy a model makes review more expensive than a blank page.</li>
        <li>Error budget <b>${p1(econ.maxEscapedErrorRate)}</b>, applied to the upper bound rather than the point estimate.</li>
        <li>USD→INR at <b>${econ.usdInr}</b>.</li>
      </ul>
    </div>
    <div>
      <h4>Known limits</h4>
      <ul>
        <li><b>The eval sets are synthetic and generated here.</b> That buys freedom from benchmark contamination and a labelled failure taxonomy, and costs realism. The numbers are a demonstration of the method. Point this at three real deployments and the grid becomes a negotiating position.</li>
        <li><b>n=${analyses[0]?.n ?? 0} per workload.</b> Nothing smaller than roughly ${(minimumDetectableEffect(analyses[0]?.n ?? 200, 0.9) * 100).toFixed(0)} points is visible here, whatever the table appears to say.</li>
        <li><b>Ground truth is asserted, not audited.</b> Run <code>node bench.ts audit</code> and read a sample before trusting any cell.</li>
        <li><b>One prompt per workload, held constant across providers.</b> Fair, and it under-serves models that respond to a different prompt style. Per-model prompt tuning would measure the tuning.</li>
        <li><b>Temperature 0 is not determinism.</b> Re-running produces small differences; the drift command reports item churn separately from accuracy for that reason.</li>
        ${unverified.length ? `<li><b>${unverified.length} price entries unverified</b> in data/pricing.json. Every ₹/unit figure inherits that.</li>` : ''}
      </ul>
    </div>
  </div>
  <p class="foot">Run ${esc(manifest.runId)} · seed ${manifest.seed} · ${manifest.evidential ? 'live providers' : 'MOCK PROVIDER — not evidence'} · re-analysis of the same attempts costs nothing, the responses are cached content-addressed.</p>
</section>`;
}

// ------------------------------------------------------------------ chrome

const MOCK_BANNER = `<div class="mockbar" role="alert">
  <b>SYNTHETIC RUN — NOT EVIDENCE.</b> No API keys were present, so every number on this page came from a simulated provider with an invented failure profile. It demonstrates that the harness works. It says nothing whatsoever about any real model. Add a key to <code>.env</code> and re-run for measurements.
</div>`;

const CSS = `
:root{--paper:#F3F0F7;--surface:#FBF9FE;--sunk:#EBE7F3;--ink:#332C46;--ink-2:#4C4463;--muted:#665E7C;--faint:#847C93;
--line:#E2DDEC;--line-2:#D0C9E0;--accent:#6337C9;--accent-soft:#EDE8F9;--good:#217054;--good-soft:#E7F2EE;
--warn:#8B591A;--warn-soft:#F7EDDC;--bad:#A33449;--bad-soft:#F9E8EC;--info:#1F6576;--fill:#6A55C0;--on-fill:#fff;--warn-fill:#8B591A;
--disp:system-ui,-apple-system,"SF Pro Display","Segoe UI",Roboto,sans-serif;
--sans:system-ui,-apple-system,"SF Pro Text","Segoe UI",Roboto,sans-serif;
--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;--r:4px}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--paper:#171422;--surface:#201C2E;--sunk:#282338;--ink:#DAD5E8;--ink-2:#BCB4CF;--muted:#918AA4;--faint:#756E8A;
--line:#302A42;--line-2:#403955;--accent:#A98FF5;--accent-soft:#2A2340;--good:#5CCCA6;--good-soft:#16302A;
--warn:#DBA959;--warn-soft:#2E2618;--bad:#F0808F;--bad-soft:#33191F;--info:#63C3D6;--fill:#7355C4;--on-fill:#F5F1FF;--warn-fill:#8A6224}}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
main{max-width:1180px;margin:0 auto;padding:0 18px 60px}
h1{font-family:var(--disp);font-size:30px;font-weight:820;letter-spacing:-.04em;margin:2px 0 6px;line-height:1.06}
h1 em{font-style:normal;color:var(--accent)}
h2{font-family:var(--disp);font-size:24px;font-weight:820;letter-spacing:-.035em;margin:0 0 4px}
h3{font-family:var(--disp);font-size:16px;font-weight:800;letter-spacing:-.02em;margin:0 0 3px}
h4{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:780;margin:16px 0 7px}
.eyebrow{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:750}
.lede{margin:6px 0 0;color:var(--muted);font-size:14px;max-width:74ch}
.sub{color:var(--muted);font-size:13px;margin:2px 0 10px;max-width:74ch}
.foot{color:var(--faint);font-size:12px;margin:10px 0 0;max-width:88ch;line-height:1.5}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
code{font-family:var(--mono);font-size:.9em;background:var(--sunk);padding:1px 5px;border-radius:3px}

.mockbar{background:var(--bad);color:#fff;padding:13px 20px;font-size:13.5px;line-height:1.5;position:sticky;top:0;z-index:50}
.mockbar code{background:rgba(255,255,255,.2);color:#fff}
body.is-mock main::before{content:"SYNTHETIC — NOT EVIDENCE";position:fixed;top:44%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);
font-family:var(--disp);font-size:min(9vw,86px);font-weight:820;color:var(--bad);opacity:.09;pointer-events:none;z-index:0;white-space:nowrap}

.top{border-bottom:2px solid var(--ink);background:var(--surface)}
.top .in{max-width:1180px;margin:0 auto;padding:24px 18px 22px;display:flex;gap:28px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
dl.meta{display:flex;gap:20px;margin:0;flex-wrap:wrap}
dl.meta dt{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);font-weight:750}
dl.meta dd{margin:1px 0 0;font-family:var(--mono);font-size:19px;font-weight:600}

/* the finding, in type large enough to read from across a room */
.verdict{display:flex;align-items:flex-end;gap:26px;flex-wrap:wrap;padding:18px 20px;margin:0 0 16px;
  background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:var(--r)}
.verdict>div{display:flex;flex-direction:column;gap:1px}
.verdict .arrow{color:var(--line-2);font-size:22px;padding-bottom:6px}
.vk{font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint);font-weight:750}
.vv{font-family:var(--mono);font-size:29px;font-weight:600;letter-spacing:-.035em;line-height:1.1}
.vv.good{color:var(--good)}.vv.bad{color:var(--bad)}
.vu{font-size:11.5px;color:var(--muted)}
@media(max-width:640px){.verdict{gap:16px}.vv{font-size:23px}.verdict .arrow{display:none}}

/* rigour kept, demoted out of the reading path */
details.fine{margin:8px 0 0}
details.fine summary{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);
  font-weight:750;cursor:pointer;list-style:none;padding:2px 0}
details.fine summary::-webkit-details-marker{display:none}
details.fine summary::before{content:"+ ";color:var(--accent)}
details.fine[open] summary::before{content:"− "}
details.fine summary:hover{color:var(--accent)}
details.fine p{color:var(--faint);font-size:12px;margin:5px 0 0;max-width:88ch;line-height:1.5}

.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;margin:14px 0;position:relative;z-index:1}
.notes ul{margin:6px 0 0;padding-left:18px;color:var(--warn);font-size:13px}
.wl{margin:34px 0 0;padding-top:20px;border-top:2px solid var(--ink)}
.wlhead{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:12px}
.two{display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:900px){.two{grid-template-columns:1.15fr .85fr}}
.cols{display:grid;grid-template-columns:1fr;gap:20px}
@media(min-width:760px){.cols{grid-template-columns:1fr 1fr}}

.grid{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:4px 0 14px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:750;text-align:right;padding:11px 10px 8px;white-space:nowrap;border-bottom:1px solid var(--line-2)}
th.l,td.l{text-align:left}
td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
td.big{font-size:16px;font-weight:700}
.ci{display:block;font-size:10.5px;color:var(--faint);font-family:var(--mono);letter-spacing:-.02em}
.sv{display:block;font-size:10px;color:var(--faint);font-family:var(--mono);margin-top:2px}
.sm{font-size:12px}
tr.good td.big{color:var(--good)}tr.warn td.big{color:var(--warn)}tr.bad td.big{color:var(--bad)}
tr.thin{opacity:.55}
.no{color:var(--bad);font-weight:700}
.tag{display:inline-block;font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:780;background:var(--accent-soft);color:var(--accent);padding:2px 5px;border-radius:2px;margin-left:6px;vertical-align:1px}
.tag.warn{background:var(--warn-soft);color:var(--warn)}
.pill{font-size:10px;font-weight:780;text-transform:uppercase;letter-spacing:.06em;background:var(--sunk);color:var(--muted);padding:2px 7px;border-radius:2px}
.pill.good{background:var(--good-soft);color:var(--good)}
table.cmp td,table.cmp th{padding:7px 8px}

.bar{display:grid;grid-template-columns:1fr auto;gap:1px 12px;margin:9px 0;font-size:12.5px;align-items:baseline}
.bar.thin{opacity:.62}
.bl{color:var(--ink-2);line-height:1.35}
.bv{text-align:right;color:var(--muted);font-size:12px;white-space:nowrap}
.bt{grid-column:1/-1;background:var(--sunk);height:13px;border-radius:2px;overflow:hidden;margin-top:3px}
.bt i{display:block;height:100%}

.insight{background:var(--accent-soft);border-left:3px solid var(--accent);padding:11px 13px;margin:14px 0 0;font-size:13px;line-height:1.55;border-radius:0 var(--r) var(--r) 0}
.insight.bad{background:var(--bad-soft);border-left-color:var(--bad)}
.warnbox{background:var(--warn-soft);border-left:3px solid var(--warn-fill);padding:10px 13px;margin:10px 0 0;font-size:12.5px;line-height:1.5;border-radius:0 var(--r) var(--r) 0}
.warnbox.big{font-size:13.5px;padding:14px 16px;margin:0 0 12px}

details.detail{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);margin:10px 0;overflow:hidden}
details.detail summary{padding:12px 16px;cursor:pointer;font-size:14px;list-style:none;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
details.detail summary::-webkit-details-marker{display:none}
details.detail summary::before{content:"▸";color:var(--accent);font-size:12px}
details.detail[open] summary::before{content:"▾"}
details.detail summary:hover{background:var(--sunk)}
.dbody{padding:4px 16px 18px;border-top:1px solid var(--line)}
.charts{display:grid;grid-template-columns:1fr;gap:18px;margin-top:12px}
@media(min-width:760px){.charts{grid-template-columns:1fr 1fr}}
figure{margin:0}
.chart{width:100%;height:auto;display:block}
.chart .axis{font-family:var(--mono);font-size:9px;fill:var(--faint)}
figcaption{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.5}
.k{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px;vertical-align:0}
.k.bad{background:var(--bad)}.k.good{background:var(--good)}
.byfield{margin-top:16px}
.byfield{margin-top:16px}
.srccmp{margin-top:18px;border-top:1px solid var(--line);padding-top:4px}
.srccmp tr.win td{background:var(--good-soft)}
.srccmp td.worse{color:var(--bad)}
.method ul{margin:4px 0 0;padding-left:17px;font-size:13px;color:var(--ink-2);line-height:1.6}
.method li{margin-bottom:6px}
`;
