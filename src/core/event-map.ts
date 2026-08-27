/**
 * core/event-map.ts
 *
 * UNIFIED EVENT MAP — every event the system can emit.
 *
 * Convention: colon-namespaced keys (survival:*, opinion:*, router:*, resource:*).
 * Typed: TypeScript enforces payload shapes at compile time.
 * Complete: covers all subsystems in one place.
 *
 * Replaces the ad-hoc BusEvents interface with a single source of truth.
 */

// ── Sentiment helper (avoids circular dep with opinion/types.ts) ────────────

export type SentimentLabel =
  | 'very_negative' | 'negative' | 'neutral' | 'positive' | 'very_positive'

// ── Event Map ────────────────────────────────────────────────────────────────

export interface EventMap {
  // ── Survival Events ─────────────────────────────────────────────────────

  'survival:tier-changed': {
    from: string
    to: string
    reason: string
    timestamp: number
  }

  'survival:health-updated': {
    health: number
    scores: Record<string, number>
    timestamp: number
  }

  'survival:distress-signal': {
    severity: 'warning' | 'critical' | 'catastrophic'
    reason: string
    timestamp: number
  }

  'survival:critical': {
    reason: string
    usdcBalance: number
    ramFreeMB: number
  }

  'survival:dead': {
    reason: string
    criticalForMs: number
  }

  'survival:recovered': {
    from: string
    usdcBalance: number
  }

  // ── Opinion Events ──────────────────────────────────────────────────────

  'opinion:signal-updated': {
    signal: any    // OpinionSignal
    sources: string[]
    timestamp: number
  }

  'opinion:trend-alert': {
    topic: string
    sentiment: string
    velocity: number
    timestamp: number
  }

  'opinion:keyword-spike': {
    keyword: string
    sentiment: string
    volume: number
    timestamp: number
  }

  'opinion:momentum-shift': {
    from: number
    to: number
    confidence: number
    sources: string[]
  }

  // ── Router Events ───────────────────────────────────────────────────────

  'router:classification': {
    taskId: string
    classification: string
    opinionModified: boolean
    timestamp: number
  }

  'router:fallback': {
    from: string
    to: string
    reason: string
  }

  // ── Resource Events ─────────────────────────────────────────────────────

  'resource:ram-warning': {
    freeMB: number
    pressure: 'none' | 'moderate' | 'severe' | 'critical'
    timestamp: number
  }

  'resource:ram-critical': {
    freeMB: number
    timestamp: number
  }

  'resource:cpu-overload': {
    loadPercent: number
    timestamp: number
  }

  'resource:balance-restored': {
    amount: number
    newBalance: number
    source: string
  }

  'resource:balance-depleted': {
    balance: number
    tier: string
    burnRatePerDay: number
  }

  'resource:spend-approved': {
    toolName: string
    amountUSDC: number
    valueScore: number
  }

  'resource:spend-denied': {
    toolName: string
    amountUSDC: number
    reason: string
  }

  // ── Inference Events ────────────────────────────────────────────────────

  'inference:lock-acquired': {
    caller: string
    provider: 'omniroute' | 'ollama' | 'none'
  }

  'inference:lock-released': {
    caller: string
    durationMs: number
    tokensOut: number
    route: string
  }

  'inference:failed': {
    error: string
    provider: string
    consecutiveFailures: number
    willFallback: boolean
  }

  'inference:fallback': {
    from: string
    to: string
    reason: string
  }

  // ── Agent Lifecycle Events ──────────────────────────────────────────────

  'agent:waking': {
    reason: string
    source: string
  }

  'agent:sleeping': {
    reason: string
    idleTurns: number
  }

  'agent:turn-completed': {
    toolsUsed: string[]
    phase: string
    route: string
    durationMs: number
  }

  'agent:turn-failed': {
    error: string
    turn: number
  }

  // ── Heartbeat Events ────────────────────────────────────────────────────

  'heartbeat:task-completed': {
    task: string
    shouldWake: boolean
    durationMs: number
  }

  'heartbeat:task-skipped': {
    task: string
    reason: string
  }

  'heartbeat:interval-changed': {
    from: number
    to: number
    tier: string
  }

  // ── Compute Events ──────────────────────────────────────────────────────

  'compute:pressure-changed': {
    from: string
    to: string
    freeMB: number
  }

  'ollama:status-changed': {
    healthy: boolean
    responseMs: number
    modelLoaded: boolean
  }

  // ── Child / Replication Events ──────────────────────────────────────────

  'child:spawned': {
    childId: string
    fundedUSDC: number
    containerName: string
  }

  'child:died': {
    childId: string
    reason: string
  }

  'child:recovered': {
    childId: string
  }
}

// ── Event Name Type ──────────────────────────────────────────────────────────

export type EventName = keyof EventMap
export type EventPayload<E extends EventName> = EventMap[E]

// ── Backward Compat: Map old dot-namespaced keys to new colon-namespaced ────

export const LEGACY_EVENT_MAP: Partial<Record<string, EventName>> = {
  'survival.tier.changed':   'survival:tier-changed',
  'survival.critical':       'survival:critical',
  'survival.dead':           'survival:dead',
  'survival.recovered':      'survival:recovered',
  'balance.restored':        'resource:balance-restored',
  'balance.depleted':        'resource:balance-depleted',
  'spend.approved':          'resource:spend-approved',
  'spend.denied':            'resource:spend-denied',
  'inference.lock.acquired': 'inference:lock-acquired',
  'inference.lock.released': 'inference:lock-released',
  'inference.failed':        'inference:failed',
  'inference.fallback':      'inference:fallback',
  'agent.waking':            'agent:waking',
  'agent.sleeping':          'agent:sleeping',
  'agent.turn.completed':    'agent:turn-completed',
  'agent.turn.failed':       'agent:turn-failed',
  'heartbeat.task.completed':  'heartbeat:task-completed',
  'heartbeat.task.skipped':    'heartbeat:task-skipped',
  'heartbeat.interval.changed': 'heartbeat:interval-changed',
  'compute.pressure.changed':  'compute:pressure-changed',
  'ollama.status.changed':     'ollama:status-changed',
  'child.spawned':           'child:spawned',
  'child.died':              'child:died',
  'child.recovered':         'child:recovered',
}
