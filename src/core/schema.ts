/**
 * JSON extraction, repair and validation. No dependencies — the whole point of
 * a bench is that it is auditable, and an auditable thing does not begin with
 * six hundred transitive packages.
 *
 * Two things here are deliberate and both are about not flattering the models:
 *
 *  - Repairs are COUNTED, not hidden. Every harness that silently retries until
 *    the JSON parses is reporting a number that includes a fixer the customer
 *    will also have to pay for. Retries are latency, cost and operational risk.
 *  - Structural failure is distinguished from being wrong. A model that emits
 *    unparseable output has a different problem from one that emits clean JSON
 *    with the wrong values, and the fixes are different.
 */

export type ValidationError = { path: string; message: string };

/** Strip fences and prose, then take the first balanced JSON value. */
export function extractJson(text: string): { value: unknown; recovered: boolean } | null {
  const trimmed = text.trim();
  try { return { value: JSON.parse(trimmed), recovered: false }; } catch { /* fall through */ }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try { return { value: JSON.parse(fence[1].trim()), recovered: true }; } catch { /* fall through */ }
  }

  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = trimmed.indexOf(open);
    if (start === -1) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try { return { value: JSON.parse(trimmed.slice(start, i + 1)), recovered: true }; } catch { break; }
      }
    }
  }
  return null;
}

type Schema = Record<string, any>;

/** JSON Schema subset: type, required, properties, items, enum, min/max, additionalProperties. */
export function validate(value: unknown, schema: Schema, path = '$'): ValidationError[] {
  const errs: ValidationError[] = [];
  const fail = (m: string) => errs.push({ path, message: m });

  if (schema.enum && !schema.enum.some((e: unknown) => e === value)) {
    fail(`expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    return errs;
  }

  const t = schema.type as string | undefined;
  if (t) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const ok =
      t === 'integer' ? (typeof value === 'number' && Number.isInteger(value)) :
      t === 'number' ? typeof value === 'number' && Number.isFinite(value) :
      t === actual;
    if (!ok) { fail(`expected ${t}, got ${actual}`); return errs; }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`above maximum ${schema.maximum}`);
  }

  if (t === 'object' && value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const req of (schema.required ?? []) as string[]) {
      if (!(req in obj)) fail(`missing required property "${req}"`);
    }
    for (const [k, sub] of Object.entries((schema.properties ?? {}) as Record<string, Schema>)) {
      if (k in obj) errs.push(...validate(obj[k], sub, `${path}.${k}`));
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(obj)) {
        if (!(schema.properties && k in schema.properties)) fail(`unexpected property "${k}"`);
      }
    }
  }

  if (t === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)));
  }

  return errs;
}

/** Compact human-readable schema, cheaper in tokens than the raw JSON Schema. */
export function describeSchema(schema: Schema, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (schema.type === 'object') {
    const req = new Set((schema.required ?? []) as string[]);
    const lines = Object.entries((schema.properties ?? {}) as Record<string, Schema>).map(
      ([k, v]) => `${pad}  "${k}": ${describeSchema(v, indent + 1)}${req.has(k) ? '' : '   // optional'}`,
    );
    return `{\n${lines.join(',\n')}\n${pad}}`;
  }
  if (schema.type === 'array') return `[ ${describeSchema(schema.items ?? {}, indent)} ]`;
  if (schema.enum) return schema.enum.map((e: unknown) => JSON.stringify(e)).join(' | ');
  let s = String(schema.type ?? 'any');
  if (schema.minimum !== undefined || schema.maximum !== undefined) s += ` (${schema.minimum ?? '-inf'}..${schema.maximum ?? 'inf'})`;
  if (schema.description) s += `  // ${schema.description}`;
  return s;
}
