/**
 * WORKLOAD 1 — address to serviceability. Logistics / consumer.
 *
 * Free-text Indian address in; resolved location and a serviceable / not
 * serviceable call out. Chosen because it is the workload a Western playbook
 * cannot transfer into: Indian addresses navigate by landmark rather than by
 * street number, colonial and current city names are both in live circulation,
 * transliteration has no agreed spelling, and the PIN is the only structured
 * field — when it is present, and correct, which is often neither.
 *
 * It is also a two-step task, not an extraction task: resolve the address, THEN
 * apply a business rule to what you resolved. That matters, because the failure
 * modes separate. A model can read the address perfectly and still get the
 * serviceability call wrong, and those two defects have different fixes and
 * different costs.
 *
 * The asymmetry that drives the economics: a wrong "serviceable" is a rider
 * dispatched to an address that cannot be served — a failed delivery, an angry
 * customer and a re-attempt. A wrong "not serviceable" is a silently refused
 * order. Neither is a typo, which is why reworkSecondsPerEscapedError is eight
 * minutes rather than the forty-five seconds review costs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CorruptionTag, EvalItem, GradeResult, Workload } from '../../types.ts';
import { rng } from '../../core/stats.ts';
import { applyCorruptions, planCorruptions } from '../corrupt.ts';

type Pin = { pincode: string; city: string; state: string };
type AddressInput = { raw: string };
type AddressTruth = { pincode: string; city: string; state: string; serviceable: boolean };
type AddressOutput = { pincode: string | null; city: string; state: string; serviceable: boolean; confidence: number };

export const SERVICEABLE_STATES = [
  'Delhi', 'Maharashtra', 'Karnataka', 'Telangana', 'Tamil Nadu',
  'Haryana', 'Gujarat', 'West Bengal', 'Uttar Pradesh', 'Rajasthan',
];

/**
 * Localities that exist in most Indian cities and imply none of them.
 * Locality and city must not contradict each other: "Bandra West,
 * Tiruchirappalli" invites a model to infer Mumbai from the locality, then
 * marks it wrong for a sound inference. That is a ground truth defect scored as
 * a model failure — the worst kind, because it is invisible in the output.
 */
const GENERIC_LOCALITIES = ['Sector 14', 'Model Town', 'Civil Lines', 'Gandhi Nagar', 'Station Road',
  'Main Bazaar', 'New Colony', 'Shastri Nagar', 'Nehru Nagar', 'Ring Road', 'Industrial Area', 'MG Road'];

/** Real localities, used only with the city they belong to. */
const CITY_LOCALITIES: Record<string, string[]> = {
  'New Delhi': ['Green Park', 'Vasant Kunj', 'Rajouri Garden', 'Lajpat Nagar'],
  'Mumbai': ['Bandra West', 'Andheri East', 'Powai', 'Dadar'],
  'Bengaluru': ['Koramangala', 'Indiranagar', 'Whitefield', 'Jayanagar'],
  'Chennai': ['Anna Nagar', 'T Nagar', 'Adyar', 'Velachery'],
  'Kolkata': ['Salt Lake', 'Ballygunge', 'Howrah', 'New Town'],
  'Hyderabad': ['Jubilee Hills', 'Gachibowli', 'Banjara Hills', 'Madhapur'],
  'Pune': ['Kothrud', 'Hinjewadi', 'Viman Nagar', 'Baner'],
  'Lucknow': ['Gomti Nagar', 'Hazratganj', 'Aliganj'],
  'Patna': ['Boring Road', 'Kankarbagh', 'Rajendra Nagar'],
  'Gurugram': ['DLF Phase 3', 'Sohna Road', 'Sushant Lok'],
  'Ahmedabad': ['Satellite', 'Navrangpura', 'Bopal'],
  'Jaipur': ['Malviya Nagar', 'Vaishali Nagar', 'C Scheme'],
};
const BUILDINGS = ['Flat 302, Shanti Apartments', 'House No 47', 'B-12, Sunrise Building',
  'Plot 9, Phase 2', '2nd Floor, Krishna Complex', 'Shop 4, Ganesh Market', 'D-114', 'Villa 22, Palm Grove'];

const POOL: CorruptionTag[] = ['abbreviated', 'transliterated', 'landmark_noise', 'pin_missing',
  'pin_wrong', 'digit_confusion', 'misspelled', 'reordered', 'ocr_noise', 'truncated', 'unicode_mixed', 'duplicate_lines'];

function loadPins(root: string): { records: Pin[]; aliases: Record<string, string[]> } {
  const j = JSON.parse(readFileSync(join(root, 'data', 'pincodes.json'), 'utf8'));
  return { records: j.records as Pin[], aliases: j.aliases as Record<string, string[]> };
}

/** Fold aliases, case and punctuation so the grader measures the model, not spelling. */
function canonicaliser(aliases: Record<string, string[]>): (s: string) => string {
  const map = new Map<string, string>();
  for (const [canon, alts] of Object.entries(aliases)) {
    const c = canon.replace(/_state$/, '');
    map.set(c, c);
    for (const a of alts) map.set(a, c);
  }
  return (s: string) => {
    const k = (s ?? '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    return map.get(k) ?? k;
  };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pincode', 'city', 'state', 'serviceable', 'confidence'],
  properties: {
    pincode: { type: 'string', description: '6 digits, or empty string if it cannot be determined' },
    city: { type: 'string' },
    state: { type: 'string' },
    serviceable: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'probability this whole answer is correct' },
  },
} as const;

export function addressWorkload(root: string, n = 200, seed = 1): Workload<AddressInput, AddressTruth, AddressOutput> {
  const { records, aliases } = loadPins(root);
  const canon = canonicaliser(aliases);
  const r = rng(seed);
  const items: EvalItem<AddressInput, AddressTruth>[] = [];

  for (let i = 0; i < n; i++) {
    const rec = records[Math.floor(r() * records.length)]!;
    const other = records[Math.floor(r() * records.length)]!;
    const specific = CITY_LOCALITIES[rec.city];
    const locality = specific && r() < 0.6
      ? specific[Math.floor(r() * specific.length)]!
      : GENERIC_LOCALITIES[Math.floor(r() * GENERIC_LOCALITIES.length)]!;
    const clean = `${BUILDINGS[Math.floor(r() * BUILDINGS.length)]}, ${locality}, ${rec.city}, ${rec.state} ${rec.pincode}`;
    const planned = planCorruptions(r, POOL);
    // `applied` is what actually landed, which is what the taxonomy is built from.
    const { text: raw, applied: tags } = applyCorruptions(clean, planned, r, { canonicalCity: rec.city, otherPincode: other.pincode });

    // pin_wrong replaces the PIN but not the locality. Truth stays the locality:
    // a human dispatcher reads "Koramangala, Bengaluru" and ignores a PIN from
    // Patna, and the model is being asked to do the same.
    items.push({
      id: `addr-${String(i).padStart(4, '0')}`,
      input: { raw },
      truth: { pincode: rec.pincode, city: rec.city, state: rec.state, serviceable: SERVICEABLE_STATES.includes(rec.state) },
      tags,
      // Calibration is FIT on this third and REPORTED on the rest. Fitting and
      // reporting on the same items makes any model look perfectly calibrated.
      split: i % 3 === 0 ? 'calib' : 'test',
    });
  }

  return {
    id: 'address',
    title: 'Address → serviceability',
    vertical: 'Logistics / consumer',
    unit: 'address',
    humanSecondsPerUnit: 45,
    reworkSecondsPerEscapedError: 480,
    schema: SCHEMA as unknown as Record<string, unknown>,
    systemPrompt:
      `You resolve Indian delivery addresses for a logistics operation.\n\n` +
      `Given a free-text address, return the 6-digit PIN code, the city and the state, and whether we can deliver there.\n\n` +
      `We deliver only in these states: ${SERVICEABLE_STATES.join(', ')}.\n\n` +
      `Addresses may be abbreviated, misspelled, missing the PIN, or navigate by landmark. ` +
      `A PIN code may be present but wrong for the locality named — where they disagree, trust the locality. ` +
      `City names may appear in older forms (Bombay, Bangalore, Calcutta, Gurgaon); resolve them to the same place.\n\n` +
      `If the PIN is absent from the address, either infer it from the locality or return an empty string. ` +
      `Do not invent one — a wrong PIN is worse than no PIN.\n` +
      `Set confidence to your probability that the ENTIRE answer is correct — not how sure you are that you produced an answer.`,
    renderUser: (input) => `Address:\n${input.raw}`,

    grade: (item, out): GradeResult => {
      const t = item.truth;
      const got = (out?.pincode ?? '').replace(/\D/g, '');

      // The prompt says: if the PIN cannot be determined, return an empty string
      // rather than guessing. On pin_missing items the truth then demanded the
      // original PIN anyway — so a model that FOLLOWED the instruction was
      // marked wrong, and one that happened to recall the right six digits was
      // rewarded for memorising the India Post directory. That measured
      // memorisation, and it punished the exact behaviour a deployment wants.
      //
      // With the PIN absent from the input, both abstaining and correctly
      // inferring are right; inventing a wrong one is not, and gets its own
      // failure mode because hallucinating an address is a different defect
      // from misreading one.
      const pinAbsent = item.tags.includes('pin_missing');
      const pinOk = pinAbsent ? (got === '' || got === t.pincode) : got === t.pincode;

      const fields = [
        { field: 'pincode', correct: pinOk, got: out?.pincode, want: pinAbsent ? `${t.pincode} or ""` : t.pincode },
        { field: 'city', correct: canon(out?.city ?? '') === canon(t.city), got: out?.city, want: t.city },
        { field: 'state', correct: canon(out?.state ?? '') === canon(t.state), got: out?.state, want: t.state },
        { field: 'serviceable', correct: out?.serviceable === t.serviceable, got: out?.serviceable, want: t.serviceable },
      ];
      const correct = fields.every((f) => f.correct);
      // Ordered by how much the failure costs, not by field order. Calling a
      // deliverable address undeliverable is a lost order; the reverse is a
      // failed delivery. Both outrank a wrong PIN on a correctly located address.
      const failureMode = correct ? null
        : !fields[3]!.correct && out?.serviceable === true ? 'false_serviceable'
        : !fields[3]!.correct ? 'false_unserviceable'
        : !fields[2]!.correct ? 'wrong_state'
        : !fields[1]!.correct ? 'wrong_city'
        : pinAbsent ? 'hallucinated_pincode'
        : 'wrong_pincode';
      return { correct, fieldScore: fields.filter((f) => f.correct).length / fields.length, fields, failureMode };
    },
    items,
  };
}
