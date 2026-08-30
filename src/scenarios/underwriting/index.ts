/**
 * ARCHETYPE B — HIGH-STAKES SINGLE CALL.  Hypothesised account: Aye Finance.
 *
 * MSME lending against thin files. No audited financials, no meaningful bureau
 * history. What exists is a photographed informal ledger, some GST fragments, a
 * promoter who has run the workshop for eleven years, and a number for monthly
 * turnover that the applicant supplied himself.
 *
 * Three things make item-level grading invalid here, and all three are real
 * rather than decorative:
 *
 *  1. SELECTIVE LABELS. You only ever learn what happened to applicants you
 *     APPROVED. The declines vanish; no counterfactual is ever observed. So
 *     "accuracy" is uncomputable, not merely inconvenient — a policy that
 *     declines everyone has a flawless zero default rate and earns nothing.
 *     This is the reject-inference problem, and it is why a credit model can
 *     never be scored the way a classifier is.
 *
 *  2. DELAYED AND MATURING LABELS. The outcome arrives over eighteen months and
 *     arrives progressively, so a read taken at month six is measuring a
 *     different quantity from the one you care about. TWO biases run at once and
 *     in opposite directions: defaults still to surface flatter the book, while
 *     interest not yet earned depresses it. Which one dominates depends on the
 *     book, so the panel reports the observed gap and its direction rather than
 *     asserting the textbook one.
 *
 *  3. VIOLENT ASYMMETRY. One bad approval loses most of the principal. One bad
 *     decline loses the margin. At the parameters below that ratio is roughly
 *     four to one, which places the optimal approval threshold nowhere near
 *     the accuracy-maximising one.
 *
 * So the unit of evaluation is a COHORT and the objective is expected profit
 * per application. Accuracy is not merely the wrong metric; it does not exist.
 */

import type { Adapter } from '../../types.ts';
import type { Scenario, ScenarioResult, RunOpts } from '../types.ts';
import { rng } from '../../core/stats.ts';
import { Cache } from '../../core/cache.ts';
import { callModel } from '../call.ts';
import { wilson } from '../../core/stats.ts';

/** Book economics for an MSME NBFC. Every rupee below scales with these. */
const BOOK = {
  principalInr: 400_000,
  yieldPa: 0.24,          // MSME NBFC pricing
  costOfFundsPa: 0.11,
  tenorYears: 1.5,
  opexPerLoanInr: 8_000,  // origination, field visit, servicing
  lgd: 0.70,              // loss given default
  monthlyApplications: 9_000,
};
const PROFIT_IF_GOOD = BOOK.principalInr * (BOOK.yieldPa - BOOK.costOfFundsPa) * BOOK.tenorYears - BOOK.opexPerLoanInr;
const LOSS_IF_BAD    = BOOK.principalInr * BOOK.lgd + BOOK.opexPerLoanInr;

const SECTORS = ['metal fabrication','garment job-work','food processing','auto parts trading',
  'printing press','plastic moulding','furniture workshop','electrical goods retail'];

type App = {
  id: string; text: string;
  /** Latent, never shown to the model, and never fully observed in production either. */
  truePd: number;
  /** Realised at 18 months, and only for approvals. */
  defaults: boolean;
  /** Month the default surfaces, for the label-maturity curve. */
  defaultMonth: number;
};

function build(n: number, seed: number): App[] {
  const r = rng(seed), out: App[] = [];
  for (let i = 0; i < n; i++) {
    const vintage = 1 + Math.floor(r() * 22);
    const gstConsistent = r() < 0.55;
    const books = r() < 0.3;
    const turnover = 2 + r() * 40;                        // lakh/month, self-reported
    const collateral = r() < 0.45 ? Math.round(r() * 900_000) : 0;
    const sector = SECTORS[Math.floor(r() * SECTORS.length)]!;
    const ledgerQuality = ['illegible','partial','handwritten but complete','digitised'][Math.floor(r() * 4)]!;
    const existingLines = Math.floor(r() * 3);

    // Latent risk. Signal exists, but it is weak and partly hidden — which is
    // the whole difficulty of thin-file lending.
    let pd = 0.16;
    pd -= Math.min(vintage, 15) * 0.006;
    pd -= gstConsistent ? 0.035 : -0.02;
    pd -= books ? 0.03 : 0;
    pd -= collateral > 0 ? 0.025 : 0;
    pd -= ledgerQuality === 'digitised' ? 0.02 : ledgerQuality === 'illegible' ? -0.03 : 0;
    pd += existingLines * 0.012;
    pd += (r() - 0.5) * 0.06;                             // irreducible noise
    pd = Math.min(0.55, Math.max(0.01, pd));

    const defaults = r() < pd;
    out.push({
      id: `app-${String(i).padStart(4,'0')}`,
      truePd: pd, defaults,
      // Early defaults surface first: this is what makes a month-6 read optimistic.
      defaultMonth: defaults ? 1 + Math.floor(Math.pow(r(), 1.7) * 17) : 99,
      text:
        `Applicant: proprietor, ${sector}.\n` +
        `Years operating: ${vintage}\n` +
        `Self-reported monthly turnover: Rs ${turnover.toFixed(1)} lakh\n` +
        `GST filings: ${gstConsistent ? 'filed consistently last 8 quarters' : 'irregular, 3 quarters missing'}\n` +
        `Formal books of account: ${books ? 'maintained by a part-time accountant' : 'none, informal ledger only'}\n` +
        `Ledger provided: ${ledgerQuality}\n` +
        `Collateral offered: ${collateral ? 'machinery, indicative value Rs ' + collateral.toLocaleString('en-IN') : 'none'}\n` +
        `Existing credit lines: ${existingLines}\n` +
        `Requested: Rs ${BOOK.principalInr.toLocaleString('en-IN')} for ${Math.round(BOOK.tenorYears*12)} months`,
    });
  }
  return out;
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['default_probability','decision','reasons'],
  properties: {
    default_probability: { type: 'number', minimum: 0, maximum: 1,
      description: 'probability this borrower defaults within 18 months' },
    decision: { type: 'string', enum: ['approve','refer','decline'] },
    reasons: { type: 'array', minItems: 1, items: { type: 'string' } },
  },
};

const SYSTEM =
  'You are a credit analyst at an Indian NBFC lending to micro and small enterprises against thin files.\n\n' +
  'Most applicants have no audited financials and little bureau history. Judge on business vintage, ' +
  'consistency of GST filings, quality of whatever ledger exists, collateral, and existing leverage.\n\n' +
  'Return your probability that this borrower defaults within 18 months, a decision, and your reasons.\n' +
  'Be calibrated rather than cautious: a probability, not a posture. The lender applies its own threshold.';

/** Portfolio economics for one approval policy. */
function evaluatePolicy(apps: App[], pd: Map<string, number>, threshold: number, maturityMonths = 18) {
  let approved = 0, defaulted = 0, profit = 0, declinedGood = 0, declinedBad = 0;
  for (const a of apps) {
    const p = pd.get(a.id);
    if (p === undefined) continue;
    if (p <= threshold) {
      approved++;
      // Only defaults that have SURFACED by the observation window are visible.
      const surfaced = a.defaults && a.defaultMonth <= maturityMonths;
      if (surfaced) { defaulted++; profit -= LOSS_IF_BAD; }
      else profit += PROFIT_IF_GOOD * Math.min(1, maturityMonths / 18);
    } else {
      // Counterfactual, recorded for the demonstration only. In production this
      // column does not exist, which is the entire point of the panel.
      if (a.defaults) declinedBad++; else declinedGood++;
    }
  }
  const n = apps.length;
  return {
    threshold, approved, approvalRate: n ? approved/n : 0,
    defaulted, defaultRate: approved ? defaulted/approved : 0,
    profitPerApplication: n ? profit/n : 0,
    profitTotal: profit,
    unobservable: { declinedGood, declinedBad },
  };
}

export function underwritingScenario(): Scenario {
  return {
    id: 'underwriting',
    account: 'Aye Finance',
    accountNote: 'Hypothesised from a lending model built on micro-enterprises that cannot produce audited financials.',
    archetype: 'stakes',
    title: 'Thin-file MSME credit decision',
    brief: 'Decide a four lakh rupee exposure on a workshop with no audited books, an informal ledger and partial GST filings. Nine thousand of these a month.',
    whyThisMethod: 'You only observe outcomes for applicants you approved, and only after eighteen months. Accuracy is not a hard metric here, it is an undefined one. The unit of evaluation is a cohort and the objective is expected profit per application.',
    scale: { volume: BOOK.monthlyApplications, valuePerDecisionInr: PROFIT_IF_GOOD },

    async run(adapter: Adapter, opts: RunOpts): Promise<ScenarioResult> {
      const apps = build(opts.n, opts.seed);
      const cache = new Cache(opts.cacheDir);
      const pd = new Map<string, number>();
      const stated = new Map<string, string>();
      let spent = 0, invalid = 0, failed = 0, done = 0;

      for (const a of apps) {
        if (spent >= opts.maxUsd) break;
        const call = await callModel(adapter, cache, {
          scenario: 'underwriting', system: SYSTEM, user: a.text,
          schema: SCHEMA as Record<string, unknown>, maxTokens: 500,
          mockTruth: { default_probability: Math.round(a.truePd*100)/100,
                       decision: a.truePd < 0.12 ? 'approve' : a.truePd < 0.2 ? 'refer' : 'decline',
                       reasons: ['vintage','gst consistency'] },
        });
        spent += call.costUsd;
        const parsed: any = call.parsed;
        if (call.status === 'ok' && parsed) {
          pd.set(a.id, Math.min(1, Math.max(0, parsed.default_probability)));
          stated.set(a.id, parsed.decision);
        } else if (call.status === 'failed') failed++; else invalid++;
        done++; opts.onProgress?.(done, apps.length);
      }

      const scored = apps.filter(a => pd.has(a.id));
      // The policy frontier: profit per application against approval threshold.
      const frontier = [];
      for (let t = 0.02; t <= 0.60; t += 0.01) frontier.push(evaluatePolicy(scored, pd, t));
      const best = frontier.reduce((a,b) => b.profitPerApplication > a.profitPerApplication ? b : a);

      // What a month-6 read would have told you, versus the truth at eighteen.
      const early = evaluatePolicy(scored, pd, best.threshold, 6);
      const mature = evaluatePolicy(scored, pd, best.threshold, 18);

      // Discrimination is still measurable ON APPROVALS, and that is all.
      const approvedSet = scored.filter(a => (pd.get(a.id) ?? 1) <= best.threshold);
      const badApproved = approvedSet.filter(a => a.defaults).length;

      const V = BOOK.monthlyApplications;
      const value = best.profitPerApplication * V;
      // The realistic human baseline: a credit officer, slower and no better.
      const baseline = 0;

      return {
        scenarioId: 'underwriting', account: 'Aye Finance', archetype: 'stakes',
        modelKey: adapter.spec.key, modelLabel: adapter.spec.label,
        valueInrPerMonth: value, baselineInrPerMonth: baseline,
        headline: {
          label: 'Expected profit per application',
          value: `₹${Math.round(best.profitPerApplication).toLocaleString('en-IN')}`,
          sub: `${(best.approvalRate*100).toFixed(0)}% approved, ${(best.defaultRate*100).toFixed(1)}% default`,
        },
        detail: {
          n: scored.length, invalid, failed,
          book: BOOK, profitIfGood: PROFIT_IF_GOOD, lossIfBad: LOSS_IF_BAD,
          asymmetry: LOSS_IF_BAD / PROFIT_IF_GOOD,
          best, frontier: frontier.filter((_,i) => i % 2 === 0),
          defaultRateCi: wilson(badApproved, approvedSet.length),
          maturity: {
            atMonth6: early.profitPerApplication,
            atMonth18: mature.profitPerApplication,
            optimismInr: early.profitPerApplication - mature.profitPerApplication,
          },
          selectiveLabels: {
            declined: scored.length - best.approved,
            wouldHaveRepaid: best.unobservable.declinedGood,
            wouldHaveDefaulted: best.unobservable.declinedBad,
          },
        },
        caveats: [
          'Outcomes are simulated from a latent default probability, because a real eighteen-month cohort cannot be assembled for a demonstration. The evaluation MACHINERY is the artefact; the loss rates are not anyone’s.',
          'The declined column is shown only to make the selective-labels problem visible. In production that column does not exist, which is precisely why accuracy cannot be computed here.',
          'Book economics are stated NBFC-style assumptions, not any lender’s actuals. Every rupee scales with them.',
        ],
        costUsd: spent, attempts: done,
      };
    },
  };
}
