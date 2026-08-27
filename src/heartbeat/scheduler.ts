/**
 * Conway Automaton — Durable Scheduler
 * DB-backed scheduler with leased execution and cron evaluation.
 */

import type { AutomatonDatabase, HeartbeatTask, TickContext } from '../types.js';
import { LEASE_TTL_MS } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('heartbeat:scheduler');

export class DurableScheduler {
  private tasks: HeartbeatTask[];
  private db: AutomatonDatabase;
  private tickIntervalMs: number;

  constructor(tasks: HeartbeatTask[], db: AutomatonDatabase, tickIntervalMs: number) {
    this.tasks = tasks;
    this.db = db;
    this.tickIntervalMs = tickIntervalMs;
    this.seedSchedule();
  }

  private seedSchedule(): void {
    for (const task of this.tasks) {
      const existing = this.db.getHeartbeatSchedule().find(s => s.taskId === task.id);
      if (!existing) {
        this.db.upsertHeartbeatSchedule({
          taskId: task.id,
          schedule: task.schedule,
          enabled: true,
          minTier: task.minTier,
          leaseTtlMs: LEASE_TTL_MS,
          config: '{}',
        });
      }
    }
  }

  getTickInterval(): number {
    return this.tickIntervalMs;
  }

  async tick(context: TickContext, forceRun = false): Promise<void> {
    const schedule = this.db.getHeartbeatSchedule();
    const now = Date.now();

    for (const entry of schedule) {
      const task = this.tasks.find(t => t.id === entry.taskId);
      if (!task) continue;

      // Check tier minimum
      const tierOrder = ['high', 'normal', 'low_compute', 'critical', 'dead'];
      const currentTierIdx = tierOrder.indexOf(context.survivalTier);
      const minTierIdx = tierOrder.indexOf(entry.minTier);
      if (currentTierIdx > minTierIdx && !forceRun) continue;

      // Check if due (simplified cron check)
      if (!forceRun && !isCronDue(entry.schedule, now)) continue;

      // Acquire lease
      if (!this.db.acquireLease(entry.taskId, LEASE_TTL_MS)) {
        logger.debug('Lease not acquired', { task: entry.taskId });
        continue;
      }

      try {
        const startTime = Date.now();
        const result = await task.execute(context);
        const durationMs = Date.now() - startTime;

        // Record history
        this.db.insertHeartbeatHistory({
          taskId: entry.taskId,
          timestamp: now,
          success: result.success,
          result: result.message,
          durationMs,
          shouldWake: result.shouldWake,
        });

        if (result.shouldWake) {
          this.db.insertWakeEvent({
            source: `heartbeat:${entry.taskId}`,
            reason: result.message,
            timestamp: now,
            consumed: false,
          });
          logger.info('Wake event inserted', { task: entry.taskId, reason: result.message });
        }

        logger.debug('Heartbeat task completed', {
          task: entry.taskId,
          success: result.success,
          durationMs,
          shouldWake: result.shouldWake,
        });
      } catch (err) {
        this.db.insertHeartbeatHistory({
          taskId: entry.taskId,
          timestamp: now,
          success: false,
          result: String(err),
          durationMs: Date.now() - now,
          shouldWake: false,
        });
        logger.error('Heartbeat task failed', { task: entry.taskId, error: String(err) });
      } finally {
        this.db.releaseLease(entry.taskId);
      }
    }
  }
}

/**
 * Simplified cron evaluation - checks if a task should run at the given time.
 * Supports: star/N, N, N-M patterns for minutes and hours.
 */
function isCronDue(schedule: string, now: number): boolean {
  const date = new Date(now);
  const parts = schedule.split(' ');
  if (parts.length < 5) return false;

  const [minPart, hourPart] = parts;

  // Check minute
  if (!matchesCronField(minPart, date.getMinutes())) return false;
  // Check hour
  if (!matchesCronField(hourPart, date.getHours())) return false;

  return true;
}

function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const interval = parseInt(field.substring(2), 10);
    return value % interval === 0;
  }
  if (field.includes('-')) {
    const [min, max] = field.split('-').map(Number);
    return value >= min && value <= max;
  }
  return value === parseInt(field, 10);
}
