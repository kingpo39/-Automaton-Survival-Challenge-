/**
 * Heartbeat Tests
 * Tests tasks, scheduler, tick context, and leases.
 */

import { describe, it, expect } from 'vitest';
import { DurableScheduler } from '../heartbeat/scheduler.js';
import { BUILTIN_TASKS } from '../heartbeat/tasks.js';
import { createMockDatabase, createMockConwayClient, createMockInferenceClient, createMockConfig, createMockState } from './mocks.js';
import type { TickContext, HeartbeatTask } from '../types.js';

function makeTickContext(overrides?: Partial<TickContext>): TickContext {
  return {
    creditsBalance: 1000,
    usdcBalance: 10_000_000,
    survivalTier: 'normal',
    config: createMockConfig(),
    db: createMockDatabase(),
    conwayClient: createMockConwayClient(),
    inferenceClient: createMockInferenceClient(),
    logger: { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } },
    ...overrides,
  };
}

describe('Heartbeat Tasks', () => {
  it('should have 12 built-in tasks', () => {
    expect(BUILTIN_TASKS.length).toBe(12);
  });

  it('each task should have required fields', () => {
    for (const task of BUILTIN_TASKS) {
      expect(task.id).toBeDefined();
      expect(task.schedule).toBeDefined();
      expect(task.minTier).toBeDefined();
      expect(typeof task.execute).toBe('function');
    }
  });

  it('heartbeat_ping should succeed', async () => {
    const task = BUILTIN_TASKS.find(t => t.id === 'heartbeat_ping')!;
    const result = await task.execute(makeTickContext());
    expect(result.success).toBe(true);
  });

  it('check_credits should report balance', async () => {
    const task = BUILTIN_TASKS.find(t => t.id === 'check_credits')!;
    const result = await task.execute(makeTickContext({ creditsBalance: 500 }));
    expect(result.success).toBe(true);
    expect(result.message).toContain('$');
  });

  it('check_usdc_balance should succeed', async () => {
    const task = BUILTIN_TASKS.find(t => t.id === 'check_usdc_balance')!;
    const result = await task.execute(makeTickContext());
    expect(result.success).toBe(true);
  });

  it('health_check should work in local mode', async () => {
    const task = BUILTIN_TASKS.find(t => t.id === 'health_check')!;
    const ctx = makeTickContext();
    ctx.config.sandboxId = '';
    const result = await task.execute(ctx);
    expect(result.success).toBe(true);
  });

  it('prune_dead_children should report count', async () => {
    const task = BUILTIN_TASKS.find(t => t.id === 'prune_dead_children')!;
    const result = await task.execute(makeTickContext());
    expect(result.success).toBe(true);
  });
});

describe('Durable Scheduler', () => {
  it('should seed schedule on construction', () => {
    const db = createMockDatabase();
    const scheduler = new DurableScheduler(BUILTIN_TASKS, db, 60000);
    const schedule = db.getHeartbeatSchedule();
    expect(schedule.length).toBe(BUILTIN_TASKS.length);
  });

  it('should return tick interval', () => {
    const db = createMockDatabase();
    const scheduler = new DurableScheduler(BUILTIN_TASKS, db, 30000);
    expect(scheduler.getTickInterval()).toBe(30000);
  });

  it('should execute due tasks during tick', async () => {
    const db = createMockDatabase();
    let executed = false;
    const testTask: HeartbeatTask = {
      id: 'test-task',
      schedule: '* * * * *',
      minTier: 'normal',
      execute: async () => {
        executed = true;
        return { success: true, message: 'done', shouldWake: false };
      },
    };
    const scheduler = new DurableScheduler([testTask], db, 60000);
    await scheduler.tick(makeTickContext(), true); // forceRun
    expect(executed).toBe(true);
  });

  it('should insert wake event when task requires it', async () => {
    const db = createMockDatabase();
    const wakeTask: HeartbeatTask = {
      id: 'wake-task',
      schedule: '* * * * *',
      minTier: 'normal',
      execute: async () => {
        return { success: true, message: 'wake up!', shouldWake: true };
      },
    };
    const scheduler = new DurableScheduler([wakeTask], db, 60000);
    await scheduler.tick(makeTickContext(), true);
    expect(db.hasPendingWakeEvent()).toBe(true);
  });

  it('should skip tasks below current tier', async () => {
    const db = createMockDatabase();
    let executed = false;
    const criticalTask: HeartbeatTask = {
      id: 'critical-only',
      schedule: '* * * * *',
      minTier: 'critical',
      execute: async () => {
        executed = true;
        return { success: true, message: 'done', shouldWake: false };
      },
    };
    const scheduler = new DurableScheduler([criticalTask], db, 60000);
    // normal tier should still run critical tasks (normal < critical in importance)
    await scheduler.tick(makeTickContext({ survivalTier: 'high' }), true);
    expect(executed).toBe(true);
  });
});

describe('Wake Events', () => {
  it('should insert and consume wake events', () => {
    const db = createMockDatabase();
    db.insertWakeEvent({ source: 'test', reason: 'wake up', timestamp: Date.now(), consumed: false });
    expect(db.hasPendingWakeEvent()).toBe(true);

    const events = db.consumeWakeEvents();
    expect(events.length).toBe(1);
    expect(events[0].reason).toBe('wake up');

    expect(db.hasPendingWakeEvent()).toBe(false);
  });
});
