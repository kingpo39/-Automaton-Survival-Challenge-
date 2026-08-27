/**
 * Conway Automaton — Heartbeat Daemon
 * Background daemon using setTimeout (no setInterval) for overlap protection.
 */

import { WAKE_CHECK_INTERVAL_MS } from '../types.js';
import type { AutomatonDatabase, StructuredLogger } from '../types.js';
import { createLogger } from '../observability/logger.js';
import { DurableScheduler } from './scheduler.js';
import type { HeartbeatTask, TickContext } from '../types.js';

const logger = createLogger('heartbeat:daemon');

export class HeartbeatDaemon {
  private scheduler: DurableScheduler;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private forceRunRequested = false;
  private tickContextBuilder: () => Promise<TickContext>;
  private db: AutomatonDatabase;

  constructor(
    tasks: HeartbeatTask[],
    db: AutomatonDatabase,
    tickContextBuilder: () => Promise<TickContext>,
    tickIntervalMs = WAKE_CHECK_INTERVAL_MS,
  ) {
    this.db = db;
    this.tickContextBuilder = tickContextBuilder;
    this.scheduler = new DurableScheduler(tasks, db, tickIntervalMs);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('Heartbeat daemon started');
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Heartbeat daemon stopped');
  }

  forceRun(): void {
    this.forceRunRequested = true;
    if (!this.running) {
      this.running = true;
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;

    this.timer = setTimeout(async () => {
      try {
        const context = await this.tickContextBuilder();
        await this.scheduler.tick(context, this.forceRunRequested);
        this.forceRunRequested = false;
      } catch (err) {
        logger.error('Heartbeat tick failed', { error: String(err) });
      }

      this.scheduleNext();
    }, this.scheduler.getTickInterval());
  }
}
