/**
 * core/event-bus/index.ts
 *
 * Typed, in-process pub/sub event bus.
 *
 * Uses the unified EventMap (colon-namespaced keys) as the source of truth.
 * Legacy BusEvents (dot-namespaced) are mapped for backward compatibility.
 *
 * Design decisions:
 *   - Synchronous dispatch: listeners run before emit() returns.
 *   - Typed: TypeScript enforces payload shapes at compile time.
 *   - Singleton: one bus per process.
 *   - No external dependencies: Node.js EventEmitter.
 */

import { EventEmitter } from 'events'
import { createLogger } from '../../observability/logger.js'

const log = createLogger('core:event-bus')

// ── Re-export unified EventMap ────────────────────────────────────────────────

export type {
  EventMap,
  EventName,
  EventPayload,
  SentimentLabel,
} from '../event-map.js'

export { LEGACY_EVENT_MAP } from '../event-map.js'

// ── Legacy types (backward compat) ───────────────────────────────────────────

export type SurvivalTier = 'high' | 'normal' | 'low_compute' | 'critical' | 'dead'
export type RouteDecision = 'trivial' | 'normal' | 'complex'

// ── Unified TypedEventBus ────────────────────────────────────────────────────

import type { EventMap, EventName, EventPayload } from '../event-map.js'

type Listener<E extends EventName> = (payload: EventPayload<E>) => void

class TypedEventBus {
  private readonly emitter = new EventEmitter()
  private eventCount = 0

  // Legacy handlers for backward compat
  private legacyHandlers: Map<string, Set<(event: LegacyEvent) => void>> = new Map()

  constructor() {
    this.emitter.setMaxListeners(50)
  }

  // ── New API: colon-namespaced EventMap ─────────────────────────────────

  emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
    this.eventCount++
    log.debug(`emit:${event}`, { payload })
    this.emitter.emit(event, payload)
  }

  on<E extends EventName>(event: E, listener: Listener<E>): () => void {
    this.emitter.on(event, listener as (p: unknown) => void)
    return () => this.emitter.off(event, listener as (p: unknown) => void)
  }

  once<E extends EventName>(event: E, listener: Listener<E>): () => void {
    this.emitter.once(event, listener as (p: unknown) => void)
    return () => this.emitter.off(event, listener as (p: unknown) => void)
  }

  waitFor<E extends EventName>(event: E, timeoutMs = 30_000): Promise<EventPayload<E>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for: ${event}`)), timeoutMs)
      this.emitter.once(event, (payload: unknown) => {
        clearTimeout(timer)
        resolve(payload as EventPayload<E>)
      })
    })
  }

  get totalEvents(): number { return this.eventCount }

  // ── Legacy API (dot-namespaced) — backward compat ──────────────────────

  emitLegacy(type: string, data: Record<string, unknown>, source: string, priority: string = 'medium'): void {
    const event: LegacyEvent = { type, timestamp: Date.now(), source, data, priority: priority as any }
    this.eventCount++

    // Map to new colon-namespaced event if known
    const mapped = LEGACY_MAP[type as keyof typeof LEGACY_MAP]
    if (mapped) {
      this.emitter.emit(mapped, data)
    }

    // Dispatch to legacy handlers
    const handlers = this.legacyHandlers.get(type)
    if (handlers) {
      for (const handler of handlers) {
        try { handler(event) } catch (err) {
          log.error('Legacy handler failed', { type, error: String(err) })
        }
      }
    }

    // Wildcard handlers
    const wildcards = this.legacyHandlers.get('*')
    if (wildcards) {
      for (const handler of wildcards) {
        try { handler(event) } catch (err) {
          log.error('Wildcard handler failed', { type, error: String(err) })
        }
      }
    }
  }

  onLegacy(type: string, handler: (event: LegacyEvent) => void): () => void {
    if (!this.legacyHandlers.has(type)) {
      this.legacyHandlers.set(type, new Set())
    }
    this.legacyHandlers.get(type)!.add(handler)
    return () => { this.legacyHandlers.get(type)?.delete(handler) }
  }

  emitFinancial(type: string, data: Record<string, unknown>): void {
    this.emitLegacy(type, data, 'financial', type === 'spending_alert' ? 'high' : 'medium')
  }

  emitResource(type: string, data: Record<string, unknown>): void {
    this.emitLegacy(type, data, 'resources', type === 'cpu_overload' ? 'high' : 'medium')
  }

  emitModel(type: string, data: Record<string, unknown>): void {
    this.emitLegacy(type, data, 'model', type === 'model_unavailable' ? 'high' : 'medium')
  }

  emitInfra(type: string, data: Record<string, unknown>): void {
    this.emitLegacy(type, data, 'infra', type.includes('failure') ? 'high' : 'medium')
  }

  getStats() {
    return { emitted: this.eventCount, legacyHandlers: this.legacyHandlers.size }
  }
}

// ── Legacy Event type ────────────────────────────────────────────────────────

export interface LegacyEvent {
  type: string
  timestamp: number
  source: string
  data: Record<string, unknown>
  priority: 'low' | 'medium' | 'high' | 'critical'
}

export type EventHandler = (event: LegacyEvent) => void | Promise<void>

export type EventType = string

// ── Legacy → New Event Mapping ───────────────────────────────────────────────

const LEGACY_MAP: Partial<Record<string, EventName>> = {
  'survival.tier.changed':      'survival:tier-changed',
  'survival.critical':          'survival:critical',
  'survival.dead':              'survival:dead',
  'survival.recovered':         'survival:recovered',
  'balance.restored':           'resource:balance-restored',
  'balance.depleted':           'resource:balance-depleted',
  'spend.approved':             'resource:spend-approved',
  'spend.denied':               'resource:spend-denied',
  'inference.lock.acquired':    'inference:lock-acquired',
  'inference.lock.released':    'inference:lock-released',
  'inference.failed':           'inference:failed',
  'inference.fallback':         'inference:fallback',
  'agent.waking':               'agent:waking',
  'agent.sleeping':             'agent:sleeping',
  'agent.turn.completed':       'agent:turn-completed',
  'agent.turn.failed':          'agent:turn-failed',
  'heartbeat.task.completed':   'heartbeat:task-completed',
  'heartbeat.task.skipped':     'heartbeat:task-skipped',
  'heartbeat.interval.changed': 'heartbeat:interval-changed',
  'compute.pressure.changed':   'compute:pressure-changed',
  'ollama.status.changed':      'ollama:status-changed',
  'child.spawned':              'child:spawned',
  'child.died':                 'child:died',
  'child.recovered':            'child:recovered',
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const bus = new TypedEventBus()

export function getEventBus(): TypedEventBus {
  return bus
}

// ── Convenience helpers ──────────────────────────────────────────────────────

export function emitTierChange(
  from: string,
  to: string,
  reason: string,
  urgency: 'routine' | 'immediate' | 'emergency' = 'routine',
): void {
  bus.emit('survival:tier-changed', { from, to, reason, timestamp: Date.now() })
  if (to === 'critical') {
    bus.emit('survival:critical', { reason, usdcBalance: 0, ramFreeMB: 0 })
  }
  if (to === 'dead') {
    bus.emit('survival:dead', { reason, criticalForMs: 0 })
  }
}

// Re-export legacy EventBus class for backward compat
export class EventBus {
  private emitted = 0
  private handlers = new Set<EventHandler>()

  on(type: string, handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  emit(type: string, data: Record<string, unknown>, source: string, priority: LegacyEvent['priority'] = 'medium'): void {
    this.emitted++
    const event: LegacyEvent = { type, timestamp: Date.now(), source, data, priority }
    for (const handler of this.handlers) {
      try { handler(event) } catch {}
    }
  }

  getStats() {
    return { emitted: this.emitted, handlers: this.handlers.size }
  }
}
