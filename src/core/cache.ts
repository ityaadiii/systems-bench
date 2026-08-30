/**
 * Content-addressed response cache.
 *
 * Keyed on everything that could change an answer: provider, requested model,
 * prompt, schema, temperature, sample count and seed. Change any of them and
 * you get a different key, which is the only safe default — a cache that
 * survives a prompt edit will quietly serve you yesterday's finding.
 *
 * This exists for three reasons, in order of how much they matter:
 *  1. A run that dies at item 340 of 600 resumes instead of restarting, and the
 *     restart is what usually blows an API budget.
 *  2. Re-analysis is free. The same raw attempts get re-graded, re-calibrated
 *     and re-priced without spending anything.
 *  3. Someone else can reproduce the analysis without keys or a bill.
 *
 * Note what is NOT in the key: the served model version. It cannot be — it is
 * only known after the call. That is exactly why drift detection compares
 * `servedModel` across runs rather than trusting the alias.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type CacheEntry<T> = { key: string; storedAt: string; value: T };

export class Cache {
  // Written out rather than using parameter properties: Node's strip-only
  // TypeScript mode cannot erase those, and a build step here would cost more
  // than it buys.
  readonly root: string;
  readonly enabled: boolean;

  constructor(root: string, enabled = true) {
    this.root = root;
    this.enabled = enabled;
  }

  key(parts: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(parts, Object.keys(parts).sort())).digest('hex').slice(0, 32);
  }

  private path(key: string): string {
    return join(this.root, key.slice(0, 2), `${key}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    try {
      const raw = await readFile(this.path(key), 'utf8');
      return (JSON.parse(raw) as CacheEntry<T>).value;
    } catch { return null; }
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.enabled) return;
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const entry: CacheEntry<T> = { key, storedAt: new Date().toISOString(), value };
    await writeFile(p, JSON.stringify(entry), 'utf8');
  }
}
