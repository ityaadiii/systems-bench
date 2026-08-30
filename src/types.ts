/**
 * Core domain types.
 *
 * The atom of this system is an Attempt: one model, one item, one call, fully
 * instrumented. Everything else — calibration curves, cost per resolved unit,
 * drift alarms, the cascade optimiser — is a fold over a list of Attempts.
 * Keeping the atom rich is what lets the analysis stay honest later; you cannot
 * recover p95 latency or a refusal rate from an accuracy number.
 */

// ---------------------------------------------------------------- workloads

/** Corruption tags drive the failure taxonomy. An item carries every tag applied to it. */
export type CorruptionTag =
  | 'clean'
  | 'pin_missing'
  | 'pin_wrong'
  | 'abbreviated'
  | 'transliterated'
  | 'landmark_noise'
  | 'misspelled'
  | 'reordered'
  | 'code_mixed'
  | 'ocr_noise'
  | 'truncated'
  | 'digit_confusion'
  | 'duplicate_lines'
  | 'unicode_mixed';

export type EvalItem<I = unknown, T = unknown> = {
  id: string;
  input: I;
  truth: T;
  tags: CorruptionTag[];
  /** Split assignment. Calibration is FIT on `calib` and REPORTED on `test`. */
  split: 'calib' | 'test';
};

export type FieldVerdict = { field: string; correct: boolean; got: unknown; want: unknown };

export type GradeResult = {
  /** Strict all-fields-correct. This is what accuracy is computed from. */
  correct: boolean;
  /** Partial credit, for diagnosis only. Never fed into the headline number. */
  fieldScore: number;
  fields: FieldVerdict[];
  /** Single dominant failure mode, used to build the taxonomy. */
  failureMode: string | null;
};

export type Workload<I = unknown, T = unknown, O = unknown> = {
  id: string;
  title: string;
  vertical: string;
  /** The thing being resolved. Economics are always per resolved unit, never per token. */
  unit: string;
  /** Median human handling seconds for one unit, done manually. Source it or state it. */
  humanSecondsPerUnit: number;
  /**
   * Seconds to undo one error that escaped review. Almost always much larger than
   * review time — a wrong serviceability call is a failed delivery, not a typo.
   * This asymmetry is why the optimal auto-approve coverage is not 100%.
   */
  reworkSecondsPerEscapedError: number;
  /** JSON Schema the model must satisfy. Also handed to providers that support constrained output. */
  schema: Record<string, unknown>;
  systemPrompt: string;
  renderUser: (input: I) => string;
  grade: (item: EvalItem<I, T>, output: O) => GradeResult;
  items: EvalItem<I, T>[];
};

// ---------------------------------------------------------------- providers

export type ModelKey = string; // "anthropic:claude-sonnet-4-5" etc.

export type ModelSpec = {
  key: ModelKey;
  provider: 'anthropic' | 'openai' | 'google' | 'ollama' | 'mock';
  /** The alias you request. */
  model: string;
  label: string;
  /** USD per 1M tokens. Verify against the provider's page before quoting; see PRICING.md. */
  usdPerMTokIn: number;
  usdPerMTokOut: number;
  /** Whether the provider returns token logprobs we can use as a confidence source. */
  logprobs: boolean;
  /** Whether the provider enforces a JSON schema server-side. */
  nativeSchema: boolean;
  /**
   * Requests that may be in flight at once against this model's RESOURCE.
   *
   * Local models must be 1, and the limit has to apply across every model
   * sharing the device, not per model. Measured: one local model alone answers
   * in 2.3s; two running concurrently both report 12.8s. Nothing got slower —
   * they were queueing on one GPU, and the queue time landed inside the
   * measured request. A per-model limit fixes nothing here, because the second
   * model is a different pool contending for the same silicon.
   *
   * That is blindspot #6 committed against myself, twice.
   */
  maxConcurrency?: number;
  /**
   * Models sharing a resourceGroup share one concurrency budget. All local
   * models share the GPU; each hosted provider has its own rate limit.
   */
  resourceGroup?: string;
};

export type CompletionRequest = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
  /** n>1 asks for independent samples, used by the sampling-agreement estimator. */
  n: number;
  seed?: number;
  /**
   * Ground truth, passed ONLY to the mock provider so it can synthesise a
   * plausible wrong answer. Named this way so nobody mistakes it for something
   * a real adapter could see: the live adapters ignore it, and the runner only
   * populates it when the target provider is 'mock'.
   */
  mockTruth?: unknown;
};

export type CompletionSample = {
  text: string;
  /** Mean logprob of the emitted tokens, if the provider exposes it. */
  meanLogprob: number | null;
};

export type CompletionResponse = {
  samples: CompletionSample[];
  tokensIn: number;
  tokensOut: number;
  /**
   * The version string the API actually returned, not the alias we asked for.
   * This is the only reliable silent-drift detector: aliases are repointed
   * without notice, and a repointed alias is indistinguishable from a
   * regression unless you record what actually served the request.
   */
  servedModel: string;
  /** Time to first byte / total, separated so throttling does not pollute latency. */
  queueMs: number;
  serviceMs: number;
  retries: number;
};

export type Adapter = {
  spec: ModelSpec;
  available: () => boolean;
  complete: (req: CompletionRequest) => Promise<CompletionResponse>;
};

// ---------------------------------------------------------------- attempts

export type ConfidenceSource = 'self_report' | 'sampling_agreement' | 'mean_logprob';

export type Attempt = {
  runId: string;
  workloadId: string;
  modelKey: ModelKey;
  itemId: string;
  split: 'calib' | 'test';
  tags: CorruptionTag[];

  parsed: unknown | null;
  schemaValid: boolean;
  /** Repair passes needed to get valid JSON. Counted as a cost, never as a free fix. */
  repairs: number;
  /** Model declined or hedged out of answering. Reported separately from wrong. */
  refused: boolean;

  /** null when there was nothing gradeable. Never silently coerced to false. */
  correct: boolean | null;
  fieldScore: number | null;
  /**
   * Per-field verdicts, kept because a composite accuracy hides which half of a
   * task is broken. On the ticket workload the composite read 33% while the
   * model was routing correctly 93% of the time — the gap was one subjective
   * field dragging the whole score down, and the composite alone made that look
   * like the model could not read Hinglish.
   */
  fieldVerdicts: Record<string, boolean> | null;
  failureMode: string | null;

  confidence: Partial<Record<ConfidenceSource, number>>;

  queueMs: number;
  serviceMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  servedModel: string;
  retries: number;
  cached: boolean;
  ts: string;
};

export type RunManifest = {
  runId: string;
  startedAt: string;
  finishedAt: string | null;
  /** Every model that produced at least one attempt, with the version actually served. */
  models: { key: ModelKey; label: string; servedModels: string[]; evidential: boolean }[];
  workloads: { id: string; title: string; n: number }[];
  /** False if ANY attempt came from the mock provider. Gates the report. */
  evidential: boolean;
  totalCostUsd: number;
  seed: number;
  notes: string[];
};
