/**
 * WORKLOAD 3 — support ticket to queue, priority and refund flag. Consumer.
 *
 * Written in Hinglish, because that is what Indian consumer support actually
 * receives and no Western benchmark contains a line of it. Code-mixing is not a
 * cosmetic difficulty: it moves the text off-distribution for models whose
 * instruction tuning is overwhelmingly monolingual, and it is exactly the
 * degradation a customer will hit in week one and you will not have measured.
 *
 * This workload also carries the bench's own control experiment.
 *
 * The queue options are presented in a DIFFERENT ORDER for every item, seeded
 * per item, and each item records where the correct option sat. If a model's
 * accuracy depends on that position, it is not classifying — it is exhibiting
 * position bias, and any single-order evaluation would have measured the
 * ordering as if it were a capability. Most published comparisons never check.
 * `positionBias()` at the bottom reports it, and the answer is occasionally
 * large enough to reorder the grid.
 */

import type { CorruptionTag, EvalItem, GradeResult, Workload } from '../../types.ts';
import { rng } from '../../core/stats.ts';

export const QUEUES = ['billing', 'delivery', 'product_quality', 'account_access', 'cancellation'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

type Queue = typeof QUEUES[number];
type Priority = typeof PRIORITIES[number];
type TicketInput = { message: string; optionOrder: Queue[] };
/**
 * NOTE: no `truthPosition` here. It is derivable from input.optionOrder, and
 * storing it in the truth object put an extra key into anything that echoes
 * truth — which failed `additionalProperties: false` and scored every ticket as
 * ungradeable. Derived state does not belong in ground truth.
 */
type TicketTruth = { queue: Queue; priority: Priority; refund_requested: boolean };
type TicketOutput = { queue: string; priority: string; refund_requested: boolean; confidence: number };

/** [template, queue, priority, refundRequested] */
const TEMPLATES: [string, Queue, Priority, boolean][] = [
  ['Bhai mera order abhi tak nahi aaya, {d} din ho gaye. Kab tak milega?', 'delivery', 'medium', false],
  ['Payment ho gaya hai but order confirm nahi hua. Paise kat gaye account se, please check karo urgently.', 'billing', 'urgent', true],
  ['Product damaged aaya hai, box bhi tuta hua tha. Replace kar do please ya paise wapas.', 'product_quality', 'high', true],
  ['Login nahi ho raha hai, OTP hi nahi aa raha phone pe. {d} baar try kiya.', 'account_access', 'high', false],
  ['Order cancel karna hai, galti se do baar order ho gaya. Duplicate wala cancel kar dijiye.', 'cancellation', 'medium', true],
  ['Delivery boy ne bola address nahi mila, but main ghar pe hi tha poora din. Reschedule karwa do.', 'delivery', 'medium', false],
  ['Mujhe double charge kiya gaya hai is order pe. Statement mein do entry dikh rahi hai.', 'billing', 'high', true],
  ['Item ka size bilkul galat hai, description mein kuch aur likha tha. Return karna hai.', 'product_quality', 'medium', true],
  ['Password reset link expire ho jata hai har baar. Account access nahi mil pa raha {d} din se.', 'account_access', 'high', false],
  ['I want to cancel my order placed yesterday, abhi tak shipped nahi hua hai. Kindly process.', 'cancellation', 'low', true],
  ['Refund abhi tak nahi aaya, {d} din ho gaye return pickup ko. Paisa kab milega?', 'billing', 'high', true],
  ['Package to deliver dikha raha hai app pe but mujhe mila hi nahi. Koi aur le gaya shayad.', 'delivery', 'urgent', true],
  ['Wrong item bheja hai aapne, maine kuch aur order kiya tha. Photo bhej raha hoon.', 'product_quality', 'high', true],
  ['Account temporarily locked bata raha hai. Kuch galat nahi kiya maine, please unlock kar do.', 'account_access', 'urgent', false],
  ['Order ko cancel karke dobara place karna hai different address pe. Help kijiye.', 'cancellation', 'low', false],
  ['Invoice mein GST number galat print hua hai, company ke liye chahiye. Corrected invoice bhej dijiye.', 'billing', 'low', false],
  ['{d} days late already and no update from courier. Bahut disappointed hoon service se.', 'delivery', 'high', false],
  ['Product working nahi kar raha, second day mein hi kharab ho gaya. Warranty claim karna hai.', 'product_quality', 'urgent', true],
];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['queue', 'priority', 'refund_requested', 'confidence'],
  properties: {
    queue: { type: 'string', enum: [...QUEUES] },
    priority: { type: 'string', enum: [...PRIORITIES] },
    refund_requested: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

function shuffled<T>(arr: readonly T[], r: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function ticketWorkload(n = 200, seed = 3): Workload<TicketInput, TicketTruth, TicketOutput> {
  const r = rng(seed);
  const items: EvalItem<TicketInput, TicketTruth>[] = [];

  for (let i = 0; i < n; i++) {
    const [tpl, queue, priority, refund] = TEMPLATES[Math.floor(r() * TEMPLATES.length)]!;
    let message = tpl.replace('{d}', String(2 + Math.floor(r() * 12)));
    const tags: CorruptionTag[] = ['code_mixed'];
    if (r() < 0.25) { message = message.toLowerCase().replace(/[.,?]/g, ''); tags.push('ocr_noise'); }
    if (r() < 0.15) { message = message.slice(0, Math.floor(message.length * 0.7)); tags.push('truncated'); }

    const optionOrder = shuffled(QUEUES, r);
    items.push({
      id: `tkt-${String(i).padStart(4, '0')}`,
      input: { message, optionOrder },
      truth: { queue, priority, refund_requested: refund },
      tags,
      split: i % 3 === 0 ? 'calib' : 'test',
    });
  }

  return {
    id: 'ticket',
    title: 'Support ticket → queue, priority, refund',
    vertical: 'Consumer',
    unit: 'ticket',
    // Priority is graded and reported, but deliberately not part of `correct`.
    // See the note in grade().
    humanSecondsPerUnit: 30,
    reworkSecondsPerEscapedError: 240,   // a misrouted urgent ticket sits in the wrong queue until someone notices
    schema: SCHEMA as unknown as Record<string, unknown>,
    systemPrompt:
      `You triage customer support messages for an Indian e-commerce operation.\n\n` +
      `Messages are written in a mix of Hindi and English, often informally, sometimes with no punctuation.\n\n` +
      `Route each message to one queue, assign a priority, and flag whether the customer is asking for money back.\n` +
      `Priority reflects customer impact and urgency: urgent means money or access is currently blocked.\n` +
      `Set confidence to your probability that ALL THREE fields are correct.`,
    // Options are re-ordered per item on purpose. See the header.
    renderUser: (input) =>
      `Available queues: ${input.optionOrder.join(', ')}\nPriorities: ${PRIORITIES.join(', ')}\n\nMessage:\n${input.message}`,

    grade: (item, out): GradeResult => {
      const t = item.truth;
      const norm = (s: unknown) => String(s ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
      const fields = [
        { field: 'queue', correct: norm(out?.queue) === t.queue, got: out?.queue, want: t.queue },
        { field: 'priority', correct: norm(out?.priority) === t.priority, got: out?.priority, want: t.priority },
        { field: 'refund_requested', correct: out?.refund_requested === t.refund_requested, got: out?.refund_requested, want: t.refund_requested },
      ];
      // PRIORITY IS EXCLUDED FROM THE COMPOSITE, on purpose.
      //
      // The first real run scored 93% on queue and 38% on priority from the same
      // message — the models read the Hinglish fine and disagreed with my
      // judgement calls about "high" versus "urgent". Every disagreement was off
      // by exactly one level and defensible; on several the model applied my own
      // stated rubric ("urgent means money or access is currently blocked") more
      // faithfully than my label did.
      //
      // Those labels are one person's opinion, written once, never checked
      // against a second annotator. Scoring them as accuracy measures my
      // consistency and charges it to the model. Until this field has two
      // annotators and a reported kappa it is agreement, not truth, and it is
      // reported separately rather than folded into a headline number.
      const scored = [fields[0]!, fields[2]!];          // queue, refund_requested
      const correct = scored.every((f) => f.correct);
      const failureMode = correct ? null
        : !fields[0]!.correct ? 'wrong_queue'
        : 'missed_refund_intent';
      return { correct, fieldScore: scored.filter((f) => f.correct).length / scored.length, fields, failureMode };
    },
    items,
  };
}

/**
 * Accuracy split by where the correct option was listed. A flat profile means
 * the model read the message. A sloped one means it partly read the list.
 */
export function positionBias(
  items: EvalItem<TicketInput, TicketTruth>[],
  correctById: Map<string, boolean | null>,
): { position: number; n: number; accuracy: number }[] {
  const buckets = new Map<number, { n: number; k: number }>();
  for (const it of items) {
    const c = correctById.get(it.id);
    if (c === null || c === undefined) continue;
    const pos = it.input.optionOrder.indexOf(it.truth.queue);   // derived, not stored
    if (pos < 0) continue;
    const b = buckets.get(pos) ?? { n: 0, k: 0 };
    b.n++; if (c) b.k++;
    buckets.set(pos, b);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0])
    .map(([position, b]) => ({ position, n: b.n, accuracy: b.k / b.n }));
}
