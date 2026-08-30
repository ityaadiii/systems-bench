/**
 * The corruption model.
 *
 * Every item starts clean and has a documented set of corruptions applied. That
 * is a choice with a real cost and a real benefit, and both belong on screen:
 *
 *   COST — the mess is synthetic. Real Indian addresses are messy in ways no
 *   generator invents, and a model could in principle be tuned to these
 *   particular perturbations.
 *
 *   BENEFIT — every item carries the exact list of what was done to it, so the
 *   output is not one accuracy number but accuracy per failure mode. "92%"
 *   tells a partner manager nothing. "Holds up under abbreviation and landmark
 *   noise, loses 31 points when the PIN is missing" tells them what to fix, and
 *   tells you which lane to route.
 *
 * It also sidesteps benchmark contamination: these strings did not exist before
 * this file ran, so no model has memorised them.
 *
 * The perturbations are drawn from how Indian addresses actually fail — landmark
 * navigation instead of street numbers, colonial and current city names in live
 * circulation together, transliteration with no agreed spelling, and OCR over
 * handwriting.
 */

import type { CorruptionTag } from '../types.ts';

export type Rand = () => number;
const pick = <T,>(arr: T[], r: Rand): T => arr[Math.floor(r() * arr.length)]!;

export const LANDMARKS = [
  'near Sharma Medical Store', 'opposite HP petrol pump', 'behind Axis Bank ATM',
  'beside the water tank', 'near the old temple', 'opp. Sai Baba mandir',
  'next to Reliance Fresh', 'above Sharma Ji sweet shop', 'near bus depot',
  'behind the new gate', 'near Anganwadi centre', 'opp. govt school',
  'diagonally opposite the SBI branch', 'after the second speed breaker',
];

export const ABBREVIATIONS: [RegExp, string][] = [
  [/\bRoad\b/gi, 'Rd'], [/\bStreet\b/gi, 'St'], [/\bNagar\b/gi, 'Ngr'],
  [/\bColony\b/gi, 'Cly'], [/\bSector\b/gi, 'Sec'], [/\bNear\b/gi, 'Nr'],
  [/\bOpposite\b/gi, 'Opp'], [/\bBuilding\b/gi, 'Bldg'], [/\bApartment\b/gi, 'Apt'],
  [/\bBlock\b/gi, 'Blk'], [/\bPhase\b/gi, 'Ph'], [/\bExtension\b/gi, 'Extn'],
  [/\bWest\b/gi, 'W'], [/\bEast\b/gi, 'E'], [/\bPost Office\b/gi, 'PO'],
];

/** Old and current names are both in daily use. Neither is an error. */
export const TRANSLITERATIONS: Record<string, string[]> = {
  'Bengaluru': ['Bangalore', 'Bengalooru'],
  'Mumbai': ['Bombay'],
  'Kolkata': ['Calcutta'],
  'Chennai': ['Madras'],
  'Pune': ['Poona'],
  'Gurugram': ['Gurgaon'],
  'Kochi': ['Cochin', 'Ernakulam'],
  'Thiruvananthapuram': ['Trivandrum'],
  'Mysuru': ['Mysore'],
  'Mangaluru': ['Mangalore'],
  'Puducherry': ['Pondicherry'],
  'Tiruchirappalli': ['Trichy'],
  'Visakhapatnam': ['Vizag'],
};

/** Handwriting and cheap OCR confuse these constantly. */
const OCR_MAP: [RegExp, string][] = [
  [/l/g, '1'], [/O/g, '0'], [/S/g, '5'], [/rn/g, 'm'], [/I/g, 'l'], [/B/g, '8'],
];

/** Keypad and reading confusions specific to digits. */
const DIGIT_MAP: Record<string, string> = { '0': '8', '8': '0', '1': '7', '7': '1', '5': '6', '6': '5', '3': '9', '9': '3' };

export function corruptDigits(s: string, r: Rand): string {
  const chars = s.split('');
  const positions = chars.map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  if (positions.length === 0) return s;
  const i = pick(positions, r);
  chars[i] = DIGIT_MAP[chars[i]!] ?? chars[i]!;
  return chars.join('');
}

/**
 * Applies each corruption and reports which ones ACTUALLY changed the string.
 *
 * A corruption can silently no-op — `unicode_mixed` finds no "Nagar" to
 * replace, `transliterated` hits a city with no older name in circulation. If
 * the item keeps the tag anyway, the per-corruption breakdown attributes
 * accuracy to a perturbation that was never applied, and the resulting chart is
 * confidently wrong in a way no reader could detect. So the tag list is
 * rebuilt from what actually happened, not from what was intended.
 */
export function applyCorruptions(
  text: string,
  tags: CorruptionTag[],
  r: Rand,
  ctx: { canonicalCity?: string; otherPincode?: string; preserveLayout?: boolean } = {},
): { text: string; applied: CorruptionTag[] } {
  let out = text;
  const applied: CorruptionTag[] = [];
  for (const tag of tags) {
    const before = out;
    switch (tag) {
      case 'clean': break;

      case 'abbreviated':
        for (const [re, rep] of ABBREVIATIONS) if (r() < 0.7) out = out.replace(re, rep);
        break;

      case 'transliterated': {
        const city = ctx.canonicalCity;
        const alts = city ? TRANSLITERATIONS[city] : undefined;
        if (alts && city) out = out.replace(new RegExp(city, 'gi'), pick(alts, r));
        break;
      }

      case 'landmark_noise': {
        const parts = out.split(',');
        parts.splice(Math.max(1, Math.floor(r() * parts.length)), 0, ` ${pick(LANDMARKS, r)}`);
        out = parts.join(',');
        break;
      }

      case 'pin_missing':
        out = out.replace(/\b\d{6}\b/g, '').replace(/,\s*,/g, ',').replace(/,\s*$/, '');
        break;

      // The nastiest case in the set: a valid PIN for the wrong place. Nothing
      // is malformed, so no validator fires. The model has to notice that the
      // PIN and the locality disagree and decide which to believe.
      case 'pin_wrong':
        if (ctx.otherPincode) out = out.replace(/\b\d{6}\b/, ctx.otherPincode);
        break;

      case 'digit_confusion':
        out = corruptDigits(out, r);
        break;

      case 'misspelled': {
        const words = out.split(' ').filter((w) => w.length > 4);
        if (words.length) {
          const w = pick(words, r);
          const i = 1 + Math.floor(r() * (w.length - 2));
          out = out.replace(w, w.slice(0, i) + w.slice(i + 1));
        }
        break;
      }

      case 'reordered': {
        const parts = out.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length > 2) {
          const i = Math.floor(r() * parts.length), j = Math.floor(r() * parts.length);
          [parts[i], parts[j]] = [parts[j]!, parts[i]!];
          out = parts.join(', ');
        }
        break;
      }

      case 'ocr_noise': {
        const [re, rep] = pick(OCR_MAP, r);
        out = out.replace(re, rep);
        break;
      }

      case 'truncated':
        out = out.slice(0, Math.max(12, Math.floor(out.length * (0.55 + r() * 0.25))));
        break;

      case 'duplicate_lines': {
        // Duplicate a ROW in a laid-out document, a comma-field in a flat string.
        const sep = ctx.preserveLayout ? '\n' : ',';
        const parts = out.split(sep);
        if (parts.length > 1) {
          const i = ctx.preserveLayout ? 1 + Math.floor(r() * (parts.length - 1)) : Math.floor(r() * parts.length);
          parts.splice(i, 0, parts[i]!);
          out = parts.join(sep);
        }
        break;
      }

      case 'unicode_mixed':
        out = out.replace(/\bNagar\b/i, 'नगर').replace(/\bMarg\b/i, 'मार्ग');
        break;

      case 'code_mixed': break;   // handled per-workload; only the ticket set is bilingual
    }
    if (tag === 'clean' || out !== before) applied.push(tag);
  }
  // Collapsing whitespace is right for a one-line address and destructive for a
  // document, where column alignment and row breaks are part of what makes the
  // extraction hard. Flattening it would have quietly made the invoice workload
  // easier than the job it stands in for.
  const cleaned = ctx.preserveLayout
    ? out.replace(/[ \t]+$/gm, '').trim()
    : out.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  return { text: cleaned, applied: applied.length ? applied : ['clean'] };
}

/**
 * Corruption plan for one item. Roughly a third stay clean so the difficulty
 * curve has a floor — a bench made entirely of hard cases cannot tell a model
 * that is broadly weak from one that only fails on the tail.
 */
export function planCorruptions(r: Rand, pool: CorruptionTag[], maxTags = 3): CorruptionTag[] {
  if (r() < 0.33) return ['clean'];
  const n = 1 + Math.floor(r() * maxTags);
  const chosen = new Set<CorruptionTag>();
  for (let i = 0; i < n; i++) chosen.add(pick(pool, r));
  return [...chosen];
}
