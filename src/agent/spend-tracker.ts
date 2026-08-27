/**
 * Conway Automaton — Spend Tracker
 * Records every financial action. Queries hourly/daily aggregates.
 */

import type { AutomatonDatabase } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('agent:spend-tracker');

export class SpendTracker {
  private db: AutomatonDatabase;

  constructor(db: AutomatonDatabase) {
    this.db = db;
  }

  record(category: string, amountCents: number, description: string): void {
    this.db.insertSpendRecord({
      timestamp: Date.now(),
      category,
      amountCents,
      description,
    });
    logger.debug('Spend recorded', { category, amountCents, description });
  }

  hourlyTotal(category: string): number {
    return this.db.getSpendTotal(category, 60 * 60 * 1000);
  }

  dailyTotal(category: string): number {
    return this.db.getSpendTotal(category, 24 * 60 * 60 * 1000);
  }

  totalInferenceCost(windowMs: number): number {
    return this.db.getInferenceCostTotal(windowMs);
  }

  exceedsHourlyLimit(category: string, limitCents: number): boolean {
    return this.hourlyTotal(category) >= limitCents;
  }

  exceedsDailyLimit(category: string, limitCents: number): boolean {
    return this.dailyTotal(category) >= limitCents;
  }
}
