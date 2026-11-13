import { MODEL_PRICES_USD_PER_M } from '../config.ts';

export type UsageRecord = {
  role: string;
  provider: string;
  model: string;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  /** Estimated from MODEL_PRICES_USD_PER_M; undefined when the model has no price entry. */
  estimatedCostUsd?: number;
};

export type UsageSummary = {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  /** Models without a price entry (their cost is not included in the total). */
  unpricedModels: string[];
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd?: number }>;
  records: UsageRecord[];
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const price = MODEL_PRICES_USD_PER_M[model];
  if (!price) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Collects token usage of every LLM call in a run (one process = one run in the CLI). */
export class UsageTracker {
  private records: UsageRecord[] = [];

  record(entry: Omit<UsageRecord, 'estimatedCostUsd'>) {
    this.records.push({ ...entry, estimatedCostUsd: estimateCostUsd(entry.model, entry.inputTokens, entry.outputTokens) });
  }

  reset() {
    this.records = [];
  }

  summary(): UsageSummary {
    const byModel: UsageSummary['byModel'] = {};
    const unpriced = new Set<string>();
    let estimatedCostUsd = 0;

    for (const r of this.records) {
      const key = r.provider;
      const agg = (byModel[key] ??= { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
      agg.calls++;
      agg.inputTokens += r.inputTokens;
      agg.outputTokens += r.outputTokens;
      if (r.estimatedCostUsd === undefined) {
        if (r.inputTokens || r.outputTokens) unpriced.add(r.model);
      } else {
        agg.estimatedCostUsd = (agg.estimatedCostUsd ?? 0) + r.estimatedCostUsd;
        estimatedCostUsd += r.estimatedCostUsd;
      }
    }

    return {
      calls: this.records.length,
      failedCalls: this.records.filter((r) => !r.success).length,
      inputTokens: this.records.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: this.records.reduce((s, r) => s + r.outputTokens, 0),
      estimatedCostUsd,
      unpricedModels: [...unpriced],
      byModel,
      records: [...this.records],
    };
  }

  printSummary() {
    const s = this.summary();
    console.log(`\n💰 LLM usage: ${s.calls} calls (${s.failedCalls} failed) | ${s.inputTokens} in / ${s.outputTokens} out tokens | ~US$ ${s.estimatedCostUsd.toFixed(4)} (estimate; Gemini direct counted at list price)`);
    for (const [model, m] of Object.entries(s.byModel)) {
      console.log(`   - ${model}: ${m.calls} calls, ${m.inputTokens} in / ${m.outputTokens} out, ~US$ ${(m.estimatedCostUsd ?? 0).toFixed(4)}`);
    }
    if (s.unpricedModels.length) console.log(`   (no price entry for: ${s.unpricedModels.join(', ')})`);
  }
}

export const usageTracker = new UsageTracker();
