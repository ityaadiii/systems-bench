/**
 * WORKLOAD 2 — invoice line-item extraction. Financial services / back office.
 *
 * The highest-volume AI workload in India by a distance, and the one where
 * "92% accurate" means least, because the errors are not distributed the way
 * that number implies: a model that drops one line from a fourteen-line invoice
 * produces a document that looks entirely correct and is short by ₹40,000.
 *
 * The interesting part of this workload is the second grader.
 *
 * `gradeArithmetic` checks the extraction against ITSELF — do the line amounts
 * equal qty x rate, do the lines sum to the subtotal, does subtotal plus tax
 * equal the total. It needs no ground truth at all. Which means, unlike every
 * other grader here, it does not stop working when the eval set runs out: it
 * ships with the deployment and keeps scoring live production traffic on day
 * ninety, when nobody is labelling anything any more.
 *
 * That is the difference between a benchmark and a monitor, and it is most of
 * why a deployment stays honest after the launch call.
 */

import type { CorruptionTag, EvalItem, GradeResult, Workload } from '../../types.ts';
import { rng } from '../../core/stats.ts';
import { applyCorruptions, planCorruptions } from '../corrupt.ts';

type Line = { description: string; qty: number; rate: number; amount: number };
type InvoiceTruth = { invoice_no: string; invoice_date: string; vendor_gstin: string; line_items: Line[]; subtotal: number; tax_total: number; grand_total: number };
type InvoiceOutput = InvoiceTruth & { confidence: number };

/** Plausible unit price bands, so figures on screen survive a glance from anyone who has seen a real invoice. */
const GOODS: [string, number, number][] = [
  ['MS Steel Pipe 2 inch', 420, 900], ['Copper Wire 1.5sqmm', 1800, 3400],
  ['PVC Conduit 25mm', 60, 180], ['Cement OPC 53 Grade', 340, 430],
  ['Safety Helmet Yellow', 180, 420], ['Industrial Gloves Pair', 45, 160],
  ['LED Panel Light 18W', 340, 780], ['Ball Bearing 6204', 90, 260],
  ['Hydraulic Oil 20L', 2400, 4200], ['Welding Rod 3.15mm', 120, 340],
  ['Aluminium Sheet 4x8', 3200, 6800], ['Cable Tie 200mm Pack', 55, 190],
];
const VENDORS = ['Shree Balaji Traders', 'Kumar Industrial Supplies', 'National Hardware Co',
  'Precision Engineering Works', 'Bharat Electricals', 'Ganesh Steel Corporation'];
const POOL: CorruptionTag[] = ['ocr_noise', 'misspelled', 'truncated', 'digit_confusion', 'duplicate_lines', 'reordered'];

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Synthetic GSTIN-shaped identifier. Structurally plausible, deliberately not a real registration. */
function fakeGstin(r: () => number): string {
  const st = String(1 + Math.floor(r() * 36)).padStart(2, '0');
  const L = () => String.fromCharCode(65 + Math.floor(r() * 26));
  const D = () => String(Math.floor(r() * 10));
  return `${st}${L()}${L()}${L()}${L()}${L()}${D()}${D()}${D()}${D()}${L()}${D()}Z${D()}`;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['invoice_no', 'invoice_date', 'vendor_gstin', 'line_items', 'subtotal', 'tax_total', 'grand_total', 'confidence'],
  properties: {
    invoice_no: { type: 'string' },
    invoice_date: { type: 'string', description: 'YYYY-MM-DD' },
    vendor_gstin: { type: 'string' },
    line_items: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['description', 'qty', 'rate', 'amount'],
        properties: { description: { type: 'string' }, qty: { type: 'number' }, rate: { type: 'number' }, amount: { type: 'number' } },
      },
    },
    subtotal: { type: 'number' }, tax_total: { type: 'number' }, grand_total: { type: 'number' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

function render(t: InvoiceTruth, vendor: string, r: () => number): string {
  const rows = t.line_items.map((l, i) =>
    `${i + 1}  ${l.description.padEnd(28)} ${String(l.qty).padStart(5)} ${l.rate.toFixed(2).padStart(10)} ${l.amount.toFixed(2).padStart(12)}`);
  const layout = r() < 0.5
    ? `TAX INVOICE\n${vendor}\nGSTIN: ${t.vendor_gstin}\n\nInvoice No: ${t.invoice_no}      Date: ${t.invoice_date}\n\nSl Description                        Qty       Rate       Amount\n${rows.join('\n')}\n\n${'Subtotal'.padStart(52)} ${t.subtotal.toFixed(2).padStart(12)}\n${'GST 18%'.padStart(52)} ${t.tax_total.toFixed(2).padStart(12)}\n${'GRAND TOTAL'.padStart(52)} ${t.grand_total.toFixed(2).padStart(12)}`
    : `${vendor}  |  GSTIN ${t.vendor_gstin}\nBill ${t.invoice_no} dt ${t.invoice_date}\n---\n${t.line_items.map((l) => `${l.description} | qty ${l.qty} | @ ${l.rate.toFixed(2)} | ${l.amount.toFixed(2)}`).join('\n')}\n---\nTaxable ${t.subtotal.toFixed(2)} / IGST ${t.tax_total.toFixed(2)} / Net Payable Rs. ${t.grand_total.toFixed(2)}`;
  return layout;
}

export function invoiceWorkload(n = 200, seed = 2): Workload<{ raw: string }, InvoiceTruth, InvoiceOutput> {
  const r = rng(seed);
  const items: EvalItem<{ raw: string }, InvoiceTruth>[] = [];

  for (let i = 0; i < n; i++) {
    const nLines = 1 + Math.floor(r() * 8);
    const lines: Line[] = Array.from({ length: nLines }, () => {
      const [description, lo, hi] = GOODS[Math.floor(r() * GOODS.length)]!;
      const qty = 1 + Math.floor(r() * 200);
      const rate = r2(lo + r() * (hi - lo));
      return { description, qty, rate, amount: r2(qty * rate) };
    });
    const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
    const tax_total = r2(subtotal * 0.18);
    const truth: InvoiceTruth = {
      invoice_no: `INV/${2025 + Math.floor(r() * 2)}/${String(1000 + Math.floor(r() * 8999))}`,
      invoice_date: `2026-0${1 + Math.floor(r() * 8)}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`,
      vendor_gstin: fakeGstin(r),
      line_items: lines, subtotal, tax_total, grand_total: r2(subtotal + tax_total),
    };
    const planned = planCorruptions(r, POOL, 2);
    const { text: raw, applied: tags } = applyCorruptions(
      render(truth, VENDORS[Math.floor(r() * VENDORS.length)]!, r), planned, r, { preserveLayout: true });
    items.push({ id: `inv-${String(i).padStart(4, '0')}`, input: { raw }, truth, tags, split: i % 3 === 0 ? 'calib' : 'test' });
  }

  return {
    id: 'invoice',
    title: 'Invoice → structured line items',
    vertical: 'Financial services / back office',
    unit: 'invoice',
    humanSecondsPerUnit: 180,
    reworkSecondsPerEscapedError: 1800,   // a payment posted against wrong figures is a reconciliation, not an edit
    schema: SCHEMA as unknown as Record<string, unknown>,
    systemPrompt:
      `You extract structured data from Indian tax invoices for an accounts payable team.\n\n` +
      `Return the invoice number, date (YYYY-MM-DD), the vendor GSTIN, every line item with quantity, rate and amount, ` +
      `and the subtotal, total tax and grand total.\n\n` +
      `Documents come from OCR and may contain character errors, duplicated rows, or truncation. ` +
      `Extract every line item — a missing line is worse than a misread one, because the totals will still look plausible.\n` +
      `Do not silently correct arithmetic: report the figures as they appear on the document.\n` +
      `Set confidence to your probability that the ENTIRE extraction is correct.`,
    renderUser: (input) => input.raw,

    grade: (item, out): GradeResult => {
      const t = item.truth;
      const money = (a: number | undefined, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.02;
      const lines = Array.isArray(out?.line_items) ? out.line_items : [];
      const lineCountOk = lines.length === t.line_items.length;
      const linesOk = lineCountOk && t.line_items.every((want, i) => {
        const got = lines[i];
        return got && money(got.qty, want.qty) && money(got.rate, want.rate) && money(got.amount, want.amount);
      });
      const fields = [
        { field: 'invoice_no', correct: (out?.invoice_no ?? '').replace(/\s/g, '') === t.invoice_no.replace(/\s/g, ''), got: out?.invoice_no, want: t.invoice_no },
        { field: 'invoice_date', correct: out?.invoice_date === t.invoice_date, got: out?.invoice_date, want: t.invoice_date },
        { field: 'vendor_gstin', correct: (out?.vendor_gstin ?? '').toUpperCase() === t.vendor_gstin, got: out?.vendor_gstin, want: t.vendor_gstin },
        { field: 'line_items', correct: linesOk, got: `${lines.length} lines`, want: `${t.line_items.length} lines` },
        { field: 'subtotal', correct: money(out?.subtotal, t.subtotal), got: out?.subtotal, want: t.subtotal },
        { field: 'tax_total', correct: money(out?.tax_total, t.tax_total), got: out?.tax_total, want: t.tax_total },
        { field: 'grand_total', correct: money(out?.grand_total, t.grand_total), got: out?.grand_total, want: t.grand_total },
      ];
      const correct = fields.every((f) => f.correct);
      const failureMode = correct ? null
        : lines.length < t.line_items.length ? 'dropped_line'
        : lines.length > t.line_items.length ? 'hallucinated_line'
        : !fields[6]!.correct ? 'wrong_total'
        : !fields[3]!.correct ? 'wrong_line_values'
        : !fields[2]!.correct ? 'wrong_gstin'
        : 'wrong_header';
      return { correct, fieldScore: fields.filter((f) => f.correct).length / fields.length, fields, failureMode };
    },
    items,
  };
}

/**
 * Ground-truth-free grader. Checks the extraction for internal consistency only,
 * so it runs on live traffic where no labels exist.
 *
 * Deliberately weaker than the labelled grader, and the gap between the two is
 * itself the useful number: it tells you what fraction of real errors a
 * production monitor would actually catch once the eval set is gone.
 */
export function gradeArithmetic(out: Partial<InvoiceOutput> | null): { consistent: boolean; violations: string[] } {
  const v: string[] = [];
  if (!out || !Array.isArray(out.line_items) || out.line_items.length === 0) return { consistent: false, violations: ['no line items'] };
  const tol = 0.05;
  out.line_items.forEach((l, i) => {
    if (typeof l?.qty !== 'number' || typeof l?.rate !== 'number' || typeof l?.amount !== 'number') { v.push(`line ${i + 1} non-numeric`); return; }
    if (Math.abs(l.qty * l.rate - l.amount) > Math.max(tol, Math.abs(l.amount) * 0.001)) v.push(`line ${i + 1}: ${l.qty} x ${l.rate} != ${l.amount}`);
  });
  const sum = out.line_items.reduce((a, l) => a + (typeof l?.amount === 'number' ? l.amount : 0), 0);
  if (typeof out.subtotal === 'number' && Math.abs(sum - out.subtotal) > Math.max(tol, Math.abs(out.subtotal) * 0.001)) v.push(`lines sum to ${sum.toFixed(2)}, subtotal says ${out.subtotal.toFixed(2)}`);
  if (typeof out.subtotal === 'number' && typeof out.tax_total === 'number' && typeof out.grand_total === 'number') {
    if (Math.abs(out.subtotal + out.tax_total - out.grand_total) > Math.max(tol, Math.abs(out.grand_total) * 0.001)) v.push(`subtotal + tax != grand total`);
  }
  return { consistent: v.length === 0, violations: v };
}
