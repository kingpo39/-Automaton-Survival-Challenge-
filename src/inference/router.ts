/**
 * Conway Automaton — Inference Router
 * Selects optimal model based on survival tier and task type.
 */

import type {
  InferenceRequest, InferenceResponse, InferenceClient,
  SurvivalTier, InferenceTaskType, RoutingMatrix,
} from '../types.js';
import { DEFAULT_ROUTING_MATRIX } from '../types.js';
import { detectTaskType, TASK_TIMEOUTS } from './types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('inference:router');

export class InferenceRouter {
  private inferenceClient: InferenceClient;
  private routingMatrix: RoutingMatrix;
  private fallbackModels: string[];
  private budgetTracker: InferenceBudgetTracker;

  constructor(
    inferenceClient: InferenceClient,
    routingMatrix?: RoutingMatrix,
    fallbackModels?: string[],
    budgetTracker?: InferenceBudgetTracker,
  ) {
    this.inferenceClient = inferenceClient;
    this.routingMatrix = routingMatrix ?? DEFAULT_ROUTING_MATRIX;
    this.fallbackModels = fallbackModels ?? ['gpt-4o-mini'];
    this.budgetTracker = budgetTracker ?? new InferenceBudgetTracker();
  }

  async route(request: InferenceRequest, tier: SurvivalTier): Promise<InferenceResponse> {
    const taskType = request.taskType ?? detectTaskType(request.messages);

    // Get model preferences for this tier + task
    const preferences = this.routingMatrix[tier]?.[taskType] ?? [];
    const allModels = [...preferences.map(p => p.model), ...this.fallbackModels];

    for (const model of allModels) {
      // Check budget
      if (!this.budgetTracker.canAfford(model)) {
        logger.debug('Model over budget, skipping', { model });
        continue;
      }

      try {
        const response = await this.inferenceClient.chatCompletion({
          ...request,
          model,
        });

        // Record cost
        this.budgetTracker.recordCost(model, response.cost);

        return response;
      } catch (err) {
        logger.warn('Inference failed for model, trying next', { model, error: String(err) });
        continue;
      }
    }

    throw new Error('All models exhausted for inference');
  }
}

/**
 * Budget tracker for hourly/daily inference spend.
 */
export class InferenceBudgetTracker {
  private hourlySpend = new Map<string, number>();
  private dailySpend = new Map<string, number>();
  private hourlyWindowStart = Date.now();
  private dailyWindowStart = Date.now();

  canAfford(model: string, estimatedCost = 0.01): boolean {
    this.rotateWindows();

    const hourlyTotal = this.getWindowTotal(this.hourlySpend);
    const dailyTotal = this.getWindowTotal(this.dailySpend);

    // Default budget limits (cents)
    const hourlyLimit = 200;  // $2/hour
    const dailyLimit = 2000;  // $20/day

    return (hourlyTotal + estimatedCost * 100) < hourlyLimit &&
           (dailyTotal + estimatedCost * 100) < dailyLimit;
  }

  recordCost(model: string, costDollars: number): void {
    this.rotateWindows();
    const costCents = costDollars * 100;

    const hourlyKey = `hourly:${model}`;
    const dailyKey = `daily:${model}`;

    this.hourlySpend.set(hourlyKey, (this.hourlySpend.get(hourlyKey) ?? 0) + costCents);
    this.dailySpend.set(dailyKey, (this.dailySpend.get(dailyKey) ?? 0) + costCents);
  }

  private rotateWindows(): void {
    const now = Date.now();
    if (now - this.hourlyWindowStart > 60 * 60 * 1000) {
      this.hourlySpend.clear();
      this.hourlyWindowStart = now;
    }
    if (now - this.dailyWindowStart > 24 * 60 * 60 * 1000) {
      this.dailySpend.clear();
      this.dailyWindowStart = now;
    }
  }

  private getWindowTotal(window: Map<string, number>): number {
    let total = 0;
    for (const v of window.values()) total += v;
    return total;
  }
}
