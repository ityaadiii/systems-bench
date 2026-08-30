/**
 * ARCHETYPE D — ADVERSARIAL / ACTING.  Hypothesised account: Cred.
 *
 * A borrower is past due. Each week the system chooses how to make contact,
 * and the borrower responds to the whole history rather than to this week's
 * message. Two dynamics do most of the damage and both are well known on any
 * collections floor:
 *
 *   FATIGUE    contact often enough and response rates fall, complaints rise,
 *              and the account hardens against you.
 *   ANCHORING  offer a fifteen percent settlement in week two and you have
 *              taught the borrower to wait. Nothing below that will close.
 *
 * Which is why a static test set cannot evaluate this. The distribution of
 * states in week five is produced by the actions taken in weeks one to four,
 * so a fixed set of states has a policy already baked into it, and scoring a
 * different policy against it measures the wrong world. Evaluating a
 * collections strategy on logged states is not an approximation; it is a
 * category error.
 *
 * So the unit of evaluation is a TRAJECTORY: roll the policy forward against a
 * responding counterparty and score the horizon. The greedy policy wins week
 * one and loses the quarter, which is the entire point and is invisible to
 * every single-step metric.
 *
 * HONEST WEAKNESS, stated on the page: the borrower model is written by me.
 * The dynamics are real and documented; their magnitudes are assumptions. The
 * artefact is the demonstration that a simulator is REQUIRED, not the numbers
 * it emits.
 */

import type { Adapter } from '../../types.ts';
import type { Scenario, ScenarioResult, RunOpts } from '../types.ts';
import { rng } from '../../core/stats.ts';
import { Cache } from '../../core/cache.ts';
import { callModel } from '../call.ts';

type Action = { id: string; label: string; cost: number; strength: number; offer: number; complaintRisk: number };
const ACTIONS: Action[] = [
  { id: 'none',    label: 'no contact this week',        cost: 0,    strength: 0,    offer: 0,    complaintRisk: 0 },
  { id: 'sms',     label: 'SMS reminder',                 cost: 3,    strength: 0.10, offer: 0,    complaintRisk: 0.002 },
  { id: 'call',    label: 'agent call',                   cost: 42,   strength: 0.28, offer: 0,    complaintRisk: 0.008 },
  { id: 'call5',   label: 'agent call, 5% waiver',        cost: 45,   strength: 0.38, offer: 0.05, complaintRisk: 0.008 },
  { id: 'call15',  label: 'agent call, 15% settlement',   cost: 48,   strength: 0.52, offer: 0.15, complaintRisk: 0.010 },
  { id: 'field',   label: 'field visit',                  cost: 380,  strength: 0.44, offer: 0,    complaintRisk: 0.055 },
  { id: 'legal',   label: 'legal notice',                 cost: 900,  strength: 0.50, offer: 0,    complaintRisk: 0.090 },
];

const WEEKS = 8;

type Borrower = {
  id: string; balance: number; dpd: number;
  capacity: number;      // latent ability to pay
  willingness: number;   // latent intent, erodes with pressure
  segment: string;
};

function build(n: number, seed: number): Borrower[] {
  const r = rng(seed), segs = ['salaried, recent job change','self-employed, seasonal','salaried, over-leveraged','small trader','gig worker'];
  return Array.from({ length: n }, (_, i) => ({
    id: `br-${String(i).padStart(4,'0')}`,
    balance: Math.round(8_000 + r() * 92_000),
    dpd: 15 + Math.floor(r() * 75),
    capacity: Math.max(0.05, Math.min(0.95, 0.45 + (r()-0.5)*0.7)),
    willingness: Math.max(0.05, Math.min(0.95, 0.55 + (r()-0.5)*0.6)),
    segment: segs[Math.floor(r()*segs.length)]!,
  }));
}

type State = { contacts: number; anchor: number; fatigue: number; complained: boolean; settled: boolean };

/** The counterparty. Responds to the history, not to this week's message. */
function step(b: Borrower, s: State, a: Action, r: () => number) {
  if (s.settled || s.complained) return { paid: 0, cost: 0 };
  const anchored = a.offer > 0 && a.offer < s.anchor ? 0.25 : 1;   // below the anchor, nothing closes
  const p = Math.min(0.9,
    a.strength * b.capacity * b.willingness * (1 - s.fatigue) * anchored);
  const cost = a.cost;
  s.contacts += a.id === 'none' ? 0 : 1;
  s.fatigue = Math.min(0.85, s.fatigue + (a.id === 'none' ? -0.06 : 0.09 + a.complaintRisk));
  if (s.fatigue < 0) s.fatigue = 0;
  if (a.offer > s.anchor) s.anchor = a.offer;
  if (r() < a.complaintRisk * (1 + s.contacts * 0.25)) { s.complained = true; return { paid: 0, cost: cost + 2500 }; }
  if (r() < p) { s.settled = true; return { paid: b.balance * (1 - s.anchor), cost }; }
  b.willingness = Math.max(0.03, b.willingness - 0.02 * (a.id === 'none' ? 0 : 1));
  return { paid: 0, cost };
}

function rollout(borrowers: Borrower[], pick: (b: Borrower, s: State, week: number) => Action, seed: number) {
  const r = rng(seed);
  let recovered = 0, cost = 0, complaints = 0, settled = 0;
  const weekly: number[] = Array(WEEKS).fill(0);
  for (const b0 of borrowers) {
    const b = { ...b0 };
    const s: State = { contacts: 0, anchor: 0, fatigue: 0, complained: false, settled: false };
    for (let w = 0; w < WEEKS; w++) {
      const out = step(b, s, pick(b, s, w), r);
      recovered += out.paid; cost += out.cost; weekly[w]! += out.paid;
    }
    if (s.complained) complaints++;
    if (s.settled) settled++;
  }
  const owed = borrowers.reduce((a,b) => a + b.balance, 0);
  return {
    recovered, cost, complaints, settled, owed, weekly,
    recoveryRate: owed ? recovered/owed : 0,
    net: recovered - cost,
    costPerRupee: recovered ? cost/recovered : Infinity,
  };
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['action','reason'],
  properties: { action: { type: 'string', enum: ACTIONS.map(a => a.id) }, reason: { type: 'string' } },
};
const SYSTEM =
  'You run weekly collections strategy for an Indian lender, working one account at a time over an eight week horizon.\n\n' +
  'Contacting too often causes fatigue and complaints, and a complaint ends the account and costs money. ' +
  'Offering a settlement anchors the borrower: nothing below a previously offered figure will close afterwards.\n' +
  'Choose this week\'s action to maximise recovery across the whole horizon, not this week.';

export function collectionsScenario(): Scenario {
  return {
    id: 'collections',
    account: 'Cred',
    accountNote: 'Hypothesised from a business whose core asset is member credit behaviour and whose economics depend on recovery without damaging the relationship.',
    archetype: 'adversarial',
    title: 'Weekly collections action',
    brief: 'Decide how to approach a past-due account each week for eight weeks, against a borrower who responds to the whole history and a regulator who cares how often you call.',
    whyThisMethod: 'The states in week five are produced by your own actions in weeks one to four, so a logged test set has a policy baked into it. Scoring a different policy against those states measures a world that would never have existed.',
    scale: { volume: 40_000, valuePerDecisionInr: 0 },

    async run(adapter: Adapter, opts: RunOpts): Promise<ScenarioResult> {
      const borrowers = build(opts.n, opts.seed);
      const cache = new Cache(opts.cacheDir);
      let spent = 0, invalid = 0, failed = 0, done = 0;

      // The model is asked once per (borrower, week) state signature. Rollout
      // needs a decision at states that only exist because of earlier choices,
      // so the policy is memoised on the state rather than precomputed.
      const memo = new Map<string, Action>();
      async function ask(b: Borrower, s: State, week: number): Promise<Action> {
        const sig = `${b.segment}|${Math.round(b.balance/10000)}|${b.dpd>45?'hi':'lo'}|w${week}|c${s.contacts}|a${s.anchor}|f${s.fatigue>0.4?'hi':'lo'}`;
        const hit = memo.get(sig); if (hit) return hit;
        if (spent >= opts.maxUsd) return ACTIONS[2]!;
        const user =
          `Borrower: ${b.segment}\nOutstanding: Rs ${b.balance.toLocaleString('en-IN')}\nDays past due: ${b.dpd}\n` +
          `Week ${week+1} of ${WEEKS}\nContacts made so far: ${s.contacts}\n` +
          `Best settlement already offered: ${s.anchor ? (s.anchor*100)+'%' : 'none'}\n` +
          `Engagement: ${s.fatigue > 0.4 ? 'account has gone quiet' : 'still responsive'}\n\n` +
          `Available actions:\n${ACTIONS.map(a => `- ${a.id}: ${a.label} (cost Rs ${a.cost})`).join('\n')}`;
        const call = await callModel(adapter, cache, {
          scenario: 'collections', system: SYSTEM, user,
          schema: SCHEMA as Record<string, unknown>, maxTokens: 200,
          mockTruth: { action: s.contacts < 2 ? 'call' : s.contacts < 4 ? 'call5' : 'none', reason: 'pace' },
        });
        spent += call.costUsd;
        const parsed: any = call.parsed;
        let act = ACTIONS[2]!;
        if (call.status === 'ok' && parsed) act = ACTIONS.find(a => a.id === parsed.action) ?? ACTIONS[2]!;
        else if (call.status === 'failed') failed++; else invalid++;
        memo.set(sig, act); done++; opts.onProgress?.(done, opts.n * 2);
        return act;
      }

      // Warm the policy by rolling once with live calls, then replay from memo.
      const warm = { ...borrowers[0]! };
      const ws: State = { contacts:0, anchor:0, fatigue:0, complained:false, settled:false };
      for (const b of borrowers.slice(0, Math.min(borrowers.length, 40))) {
        const s: State = { contacts:0, anchor:0, fatigue:0, complained:false, settled:false };
        for (let w = 0; w < WEEKS; w++) { const a = await ask({ ...b }, s, w); s.contacts += a.id==='none'?0:1; if (a.offer>s.anchor) s.anchor=a.offer; s.fatigue=Math.min(0.85,s.fatigue+(a.id==='none'?-0.06:0.1)); }
      }
      void warm; void ws;

      const modelPick = (b: Borrower, s: State, w: number): Action => {
        const sig = `${b.segment}|${Math.round(b.balance/10000)}|${b.dpd>45?'hi':'lo'}|w${w}|c${s.contacts}|a${s.anchor}|f${s.fatigue>0.4?'hi':'lo'}`;
        return memo.get(sig) ?? ACTIONS[2]!;
      };
      // Greedy: always take the strongest affordable action. Wins week one.
      const greedy = (): Action => ACTIONS[4]!;
      // Standard desk: escalate on a fixed ladder.
      const ladder = (_b: Borrower, _s: State, w: number): Action =>
        ACTIONS[Math.min(ACTIONS.length-1, 1 + Math.floor(w/2))]!;

      const model  = rollout(borrowers, modelPick, opts.seed+5);
      const gre    = rollout(borrowers, greedy,    opts.seed+5);
      const lad    = rollout(borrowers, ladder,    opts.seed+5);

      const V = 40_000, scale = V / Math.max(1, borrowers.length);
      return {
        scenarioId: 'collections', account: 'Cred', archetype: 'adversarial',
        modelKey: adapter.spec.key, modelLabel: adapter.spec.label,
        valueInrPerMonth: model.net * scale, baselineInrPerMonth: lad.net * scale,
        headline: {
          label: 'Net recovery over eight weeks',
          value: `${(model.recoveryRate*100).toFixed(1)}%`,
          sub: `${model.complaints} complaints · ₹${model.costPerRupee.toFixed(2)} spent per ₹1 recovered`,
        },
        detail: {
          n: borrowers.length, invalid, failed, weeks: WEEKS, actions: ACTIONS,
          policies: [
            { name: 'This model', ...model },
            { name: 'Greedy (strongest action every week)', ...gre },
            { name: 'Fixed escalation ladder', ...lad },
          ],
          myopia: {
            greedyWeek1: gre.weekly[0]!, modelWeek1: model.weekly[0]!,
            greedyTotal: gre.recovered, modelTotal: model.recovered,
            greedyComplaints: gre.complaints, modelComplaints: model.complaints,
          },
        },
        caveats: [
          'The borrower is a model I wrote. Fatigue and settlement anchoring are documented collections dynamics, but their magnitudes here are my assumptions, so the numbers are illustrative and the machinery is the point.',
          'The claim being demonstrated is that a simulator is REQUIRED, not that this simulator is right. A logged test set cannot evaluate a policy whose own actions generate the states it will face.',
          'Complaint costs stand in for regulatory and reputational exposure and are deliberately crude.',
        ],
        costUsd: spent, attempts: done,
      };
    },
  };
}
