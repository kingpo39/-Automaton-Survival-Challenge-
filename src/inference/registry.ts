/**
 * Conway Automaton — Model Registry
 * DB-backed catalog of available models with provider, pricing, capabilities.
 */

import type { ModelRegistryEntry, AutomatonDatabase, InferenceProvider } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('inference:registry');

const BASELINE_MODELS: ModelRegistryEntry[] = [
  { model: 'gpt-5.2', provider: 'openai', pricingPer1kTokens: 0.03, maxContext: 128000, capabilities: ['reasoning', 'tool_use', 'coding'], available: true, updatedAt: Date.now() },
  { model: 'gpt-4o', provider: 'openai', pricingPer1kTokens: 0.005, maxContext: 128000, capabilities: ['reasoning', 'tool_use', 'coding'], available: true, updatedAt: Date.now() },
  { model: 'gpt-4o-mini', provider: 'openai', pricingPer1kTokens: 0.00015, maxContext: 128000, capabilities: ['reasoning', 'tool_use'], available: true, updatedAt: Date.now() },
  { model: 'claude-sonnet-4-20250514', provider: 'anthropic', pricingPer1kTokens: 0.003, maxContext: 200000, capabilities: ['reasoning', 'tool_use', 'coding'], available: true, updatedAt: Date.now() },
];

export class ModelRegistry {
  private db: AutomatonDatabase;

  constructor(db: AutomatonDatabase) {
    this.db = db;
    this.seedBaseline();
  }

  private seedBaseline(): void {
    const existing = this.db.getModelRegistry();
    if (existing.length === 0) {
      for (const model of BASELINE_MODELS) {
        this.db.upsertModelRegistry(model);
      }
      logger.info('Seeded baseline models', { count: BASELINE_MODELS.length });
    }
  }

  getAvailableModels(): ModelRegistryEntry[] {
    return this.db.getModelRegistry();
  }

  getModel(modelName: string): ModelRegistryEntry | undefined {
    return this.db.getModelRegistry().find(m => m.model === modelName);
  }

  updateModel(entry: ModelRegistryEntry): void {
    this.db.upsertModelRegistry({ ...entry, updatedAt: Date.now() });
  }

  refreshFromApi(apiModels: Array<{ model: string; provider: string; available: boolean }>): void {
    for (const apiModel of apiModels) {
      const existing = this.getModel(apiModel.model);
      if (existing) {
        this.updateModel({ ...existing, available: apiModel.available });
      } else {
        this.updateModel({
          model: apiModel.model,
          provider: apiModel.provider as InferenceProvider,
          pricingPer1kTokens: 0,
          maxContext: 128000,
          capabilities: [],
          available: apiModel.available,
          updatedAt: Date.now(),
        });
      }
    }
  }
}
