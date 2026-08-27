/**
 * Spend Tracker Tests
 * Tests spend recording, limit checks, and pruning.
 */

import { describe, it, expect } from 'vitest';
import { SpendTracker } from '../agent/spend-tracker.js';
import { createMockDatabase } from './mocks.js';

describe('Spend Tracker', () => {
  it('should record spend', () => {
    const db = createMockDatabase();
    const tracker = new SpendTracker(db);
    tracker.record('inference', 50, 'Turn 1');
    // Verify it doesn't throw
  });

  it('should query hourly totals', () => {
    const db = createMockDatabase();
    const tracker = new SpendTracker(db);
    // Mock returns 0 for all queries
    expect(tracker.hourlyTotal('inference')).toBe(0);
  });

  it('should query daily totals', () => {
    const db = createMockDatabase();
    const tracker = new SpendTracker(db);
    expect(tracker.dailyTotal('inference')).toBe(0);
  });

  it('should check hourly limits', () => {
    const db = createMockDatabase();
    const tracker = new SpendTracker(db);
    expect(tracker.exceedsHourlyLimit('inference', 100)).toBe(false);
  });

  it('should check daily limits', () => {
    const db = createMockDatabase();
    const tracker = new SpendTracker(db);
    expect(tracker.exceedsDailyLimit('inference', 1000)).toBe(false);
  });
});
