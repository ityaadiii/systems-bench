import type { Adapter } from '../types.ts';
import type { Scenario, ScenarioResult, RunOpts } from './types.ts';
import { catalogueScenario } from './catalogue/index.ts';
import { underwritingScenario } from './underwriting/index.ts';
import { pricingScenario } from './pricing/index.ts';
import { collectionsScenario } from './collections/index.ts';

export const SCENARIOS: Record<string, () => Scenario> = {
  catalogue: catalogueScenario,
  underwriting: underwritingScenario,
  pricing: pricingScenario,
  collections: collectionsScenario,
};

export async function runScenarios(
  ids: string[], adapters: Adapter[], opts: RunOpts,
): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const id of ids) {
    const make = SCENARIOS[id];
    if (!make) continue;
    const s = make();
    for (const a of adapters) {
      // The deterministic baseline has no business in three of these four; it
      // exists for lookups and is silently absent where it cannot apply.
      if (a.spec.key.startsWith('baseline:') && id !== 'catalogue') continue;
      try {
        out.push(await s.run(a, opts));
      } catch (err) {
        out.push({
          scenarioId: s.id, account: s.account, archetype: s.archetype,
          modelKey: a.spec.key, modelLabel: a.spec.label,
          valueInrPerMonth: 0, baselineInrPerMonth: 0,
          headline: { label: 'Run failed', value: '—' },
          detail: { error: err instanceof Error ? err.message.slice(0, 300) : String(err) },
          caveats: ['This cell failed to run and is reported rather than dropped.'],
          costUsd: 0, attempts: 0,
        });
      }
    }
  }
  return out;
}

export { ARCHETYPE_META, ACCOUNT_DISCLAIMER } from './types.ts';
export type { Scenario, ScenarioResult, Archetype } from './types.ts';
