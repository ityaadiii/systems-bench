/**
 * Inline SVG charts. No chart library: the whole report has to survive being
 * emailed as one file, opened on a phone, and read by someone who wants to know
 * whether the numbers were drawn or computed.
 */

import type { Bin, CoveragePoint } from '../core/calibrate.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Reliability diagram. The diagonal is perfect calibration. Points below it are
 * overconfidence, which is the direction that costs money: it means the
 * auto-approve lane is leaking more errors than the threshold promised.
 * Point area is proportional to how many items sit in that bin, so a wild bin
 * holding four items cannot shout as loudly as one holding two hundred.
 */
export function reliabilityChart(raw: Bin[], fitted: Bin[], w = 300, h = 300): string {
  const pad = 34, iw = w - pad - 12, ih = h - pad - 12;
  const X = (v: number) => pad + v * iw;
  const Y = (v: number) => h - pad - v * ih;
  const total = raw.reduce((a, b) => a + b.n, 0) || 1;

  const pts = (bins: Bin[], colour: string, dash: string) => {
    const use = bins.filter((b) => b.n > 0 && Number.isFinite(b.accuracy));
    if (use.length === 0) return '';
    const path = use.map((b, i) => `${i ? 'L' : 'M'}${X(b.meanConf).toFixed(1)},${Y(b.accuracy).toFixed(1)}`).join(' ');
    const dots = use.map((b) =>
      `<circle cx="${X(b.meanConf).toFixed(1)}" cy="${Y(b.accuracy).toFixed(1)}" r="${(2.2 + 5 * Math.sqrt(b.n / total)).toFixed(1)}" fill="${colour}" opacity=".85"><title>conf ${b.meanConf.toFixed(2)} → actual ${(b.accuracy * 100).toFixed(0)}%  (n=${b.n})</title></circle>`).join('');
    return `<path d="${path}" fill="none" stroke="${colour}" stroke-width="2" stroke-dasharray="${dash}" opacity=".9"/>${dots}`;
  };

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Reliability diagram">
  <rect x="${pad}" y="12" width="${iw}" height="${ih}" fill="var(--sunk)" opacity=".45"/>
  <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke="var(--line-2)" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="${X(0.68)}" y="${Y(0.60)}" class="axis" fill="var(--faint)">perfect</text>
  ${pts(raw, 'var(--bad)', '0')}
  ${pts(fitted, 'var(--good)', '5 3')}
  <line x1="${pad}" y1="${h - pad}" x2="${w - 12}" y2="${h - pad}" stroke="var(--line-2)"/>
  <line x1="${pad}" y1="12" x2="${pad}" y2="${h - pad}" stroke="var(--line-2)"/>
  <text x="${pad}" y="${h - 12}" class="axis">0</text>
  <text x="${w - 20}" y="${h - 12}" class="axis">1.0</text>
  <text x="${(pad + w) / 2 - 34}" y="${h - 12}" class="axis">stated confidence</text>
  <text x="6" y="${18}" class="axis">1.0</text>
  <text x="6" y="${h - pad}" class="axis">0</text>
</svg>`;
}

/**
 * Risk-coverage curve: how much can be auto-approved (x) against the error rate
 * among what was auto-approved (y). The horizontal rule is the error budget;
 * where the curve crosses it is the most that can be automated.
 */
export function coverageChart(curve: CoveragePoint[], maxRisk: number, w = 300, h = 300): string {
  const pad = 34, iw = w - pad - 12, ih = h - pad - 12;
  const pts = curve.filter((p) => p.nAuto > 0).sort((a, b) => a.coverage - b.coverage);
  if (pts.length === 0) return `<svg viewBox="0 0 ${w} ${h}" class="chart"><text x="${w / 2 - 40}" y="${h / 2}" class="axis">no coverage</text></svg>`;
  const maxY = Math.max(maxRisk * 1.6, ...pts.map((p) => p.risk)) || 0.1;
  const X = (v: number) => pad + v * iw;
  const Y = (v: number) => h - pad - (v / maxY) * ih;

  const band = pts.map((p) => `${X(p.coverage).toFixed(1)},${Y(Math.min(maxY, p.riskCi.hi)).toFixed(1)}`).join(' ') + ' ' +
    [...pts].reverse().map((p) => `${X(p.coverage).toFixed(1)},${Y(p.riskCi.lo).toFixed(1)}`).join(' ');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.coverage).toFixed(1)},${Y(p.risk).toFixed(1)}`).join(' ');
  const feasible = pts.filter((p) => p.riskCi.hi <= maxRisk);
  const best = feasible.length ? feasible.reduce((a, b) => (b.coverage > a.coverage ? b : a)) : null;

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Risk-coverage curve">
  <rect x="${pad}" y="12" width="${iw}" height="${ih}" fill="var(--sunk)" opacity=".45"/>
  <polygon points="${band}" fill="var(--accent)" opacity=".14"/>
  <line x1="${pad}" y1="${Y(maxRisk).toFixed(1)}" x2="${w - 12}" y2="${Y(maxRisk).toFixed(1)}" stroke="var(--bad)" stroke-width="1.4" stroke-dasharray="4 3"/>
  <text x="${w - 92}" y="${(Y(maxRisk) - 5).toFixed(1)}" class="axis" fill="var(--bad)">error budget ${(maxRisk * 100).toFixed(1)}%</text>
  <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
  ${best ? `<circle cx="${X(best.coverage).toFixed(1)}" cy="${Y(best.risk).toFixed(1)}" r="5" fill="var(--good)" stroke="var(--surface)" stroke-width="2"><title>auto-approve ${(best.coverage * 100).toFixed(0)}% at threshold ${best.threshold.toFixed(2)}</title></circle>
  <text x="${Math.min(w - 96, X(best.coverage) + 8).toFixed(1)}" y="${Math.max(24, Y(best.risk) - 9).toFixed(1)}" class="axis" fill="var(--good)">${(best.coverage * 100).toFixed(0)}% automatable</text>` : ''}
  <line x1="${pad}" y1="${h - pad}" x2="${w - 12}" y2="${h - pad}" stroke="var(--line-2)"/>
  <line x1="${pad}" y1="12" x2="${pad}" y2="${h - pad}" stroke="var(--line-2)"/>
  <text x="${(pad + w) / 2 - 26}" y="${h - 12}" class="axis">coverage</text>
  <text x="4" y="18" class="axis">${(maxY * 100).toFixed(1)}%</text>
  <text x="4" y="${h - pad}" class="axis">0</text>
</svg>`;
}

/** Horizontal bars, used for cost comparisons and per-corruption accuracy. */
export function barRow(label: string, value: number, max: number, colour: string, caption: string, thin = false): string {
  const pctW = max > 0 ? Math.max(0.6, (value / max) * 100) : 0;
  return `<div class="bar${thin ? ' thin' : ''}">
    <span class="bl">${esc(label)}</span>
    <span class="bv num">${esc(caption)}</span>
    <span class="bt"><i style="width:${pctW.toFixed(1)}%;background:${colour}"></i></span>
  </div>`;
}
