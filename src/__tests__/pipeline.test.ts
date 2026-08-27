/**
 * Pipeline Integration Test
 * Tests all core modules end-to-end
 */
import { describe, it, expect, vi } from 'vitest'

// ── Event Bus ────────────────────────────────────────────────
import { EventBus } from '../core/event-bus/index.js'

describe('Event Bus', () => {
  it('emits and receives events', () => {
    const bus = new EventBus()
    let received = false
    let receivedData: unknown = null

    bus.on('balance_changed', (ev) => {
      received = true
      receivedData = ev.data
    })

    bus.emit('balance_changed', { balance: 500 }, 'test', 'medium')

    expect(received).toBe(true)
    expect(receivedData).toEqual({ balance: 500 })
  })

  it('tracks stats', () => {
    const bus = new EventBus()
    bus.emit('balance_changed', { balance: 100 }, 'test', 'medium')
    bus.emit('credit_changed', { credits: 50 }, 'test', 'low')

    const stats = bus.getStats()
    expect(stats.emitted).toBe(2)
  })

  it('returns unsubscribe function', () => {
    const bus = new EventBus()
    let count = 0
    const unsub = bus.on('balance_changed', () => { count++ })

    bus.emit('balance_changed', { balance: 1 }, 'test')
    unsub()
    bus.emit('balance_changed', { balance: 2 }, 'test')

    expect(count).toBe(1)
  })
})

// ── Survival FSM with Hysteresis ────────────────────────────
import { SurvivalFSM } from '../core/router/survival-fsm.js'

function defaultResources(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    usdcBalance: 50,
    ramPressure: 'normal',
    cpuLoad: 30,
    ollamaHealthy: true,
    dbHealthy: true,
    networkHealthy: true,
    consecutiveInferenceFailures: 0,
    ...overrides,
  }
}

describe('Survival FSM', () => {
  it('starts at initial tier', () => {
    const fsm = new SurvivalFSM('normal')
    expect(fsm.getCurrentTier()).toBe('normal')
  })

  it('transitions down on resource loss', () => {
    const fsm = new SurvivalFSM('high')
    const tier = fsm.update(defaultResources({ usdcBalance: 0.20 }))
    expect(tier).toBe('critical')
  })

  it('applies hysteresis (stays critical until exit threshold)', () => {
    const fsm = new SurvivalFSM('high')
    // Drop to critical
    fsm.update(defaultResources({ usdcBalance: 0.20 }))
    expect(fsm.getCurrentTier()).toBe('critical')

    // Recover to $0.70 — below exit threshold of $0.75
    fsm.update(defaultResources({ usdcBalance: 0.70 }))
    expect(fsm.getCurrentTier()).toBe('critical')
  })

  it('recovers past hysteresis exit threshold', () => {
    const fsm = new SurvivalFSM('high')
    fsm.update(defaultResources({ usdcBalance: 0.20 }))
    expect(fsm.getCurrentTier()).toBe('critical')

    fsm.update(defaultResources({ usdcBalance: 1.00 }))
    expect(fsm.getCurrentTier()).not.toBe('critical')
  })

  it('tracks transitions', () => {
    const fsm = new SurvivalFSM('high')
    fsm.update(defaultResources({ usdcBalance: 0.20 }))
    const transitions = fsm.getTransitions(10)
    expect(transitions.length).toBeGreaterThanOrEqual(1)
    expect(transitions[0].from).toBe('high')
    expect(transitions[0].to).toBe('critical')
  })

  it('forces tier manually', () => {
    const fsm = new SurvivalFSM('normal')
    fsm.force('dead', 'manual override')
    expect(fsm.getCurrentTier()).toBe('dead')
  })
})

// ── State Vector Calculator ──────────────────────────────────
import { StateVectorCalculator } from '../core/router/state-vector.js'

describe('State Vector', () => {
  it('calculates low risk for healthy state', () => {
    const svc = new StateVectorCalculator()
    const v = svc.calculate({
      usdcBalance: 50, creditsCents: 5000, ramFreeMB: 2048,
      ramTotalMB: 8192, cpuLoadPercent: 30, ramPressure: 'normal',
      ollamaHealthy: true, ollamaResponseMs: 200,
      consecutiveInferenceFailures: 0, dbHealthy: true,
      networkHealthy: true, pendingTasks: 3, activeDiscussions: 1,
    })
    expect(v.risk).toBeLessThan(0.5)
    expect(v.capability).toBeGreaterThan(0.5)
  })

  it('calculates high risk for dead state', () => {
    const svc = new StateVectorCalculator()
    const v = svc.calculate({
      usdcBalance: 0, creditsCents: 0, ramFreeMB: 200,
      ramTotalMB: 8192, cpuLoadPercent: 95, ramPressure: 'critical',
      ollamaHealthy: false, ollamaResponseMs: 0,
      consecutiveInferenceFailures: 8, dbHealthy: false,
      networkHealthy: false, pendingTasks: 20, activeDiscussions: 0,
    })
    expect(v.risk).toBeGreaterThan(0.8)
    expect(v.constraints.databaseDead).toBe(true)
    expect(v.constraints.walletDead).toBe(true)
  })

  it('applies hard constraints (DB down)', () => {
    const svc = new StateVectorCalculator()
    const v = svc.calculate({
      usdcBalance: 100, creditsCents: 10000, ramFreeMB: 4096,
      ramTotalMB: 8192, cpuLoadPercent: 20, ramPressure: 'normal',
      ollamaHealthy: true, ollamaResponseMs: 100,
      consecutiveInferenceFailures: 0, dbHealthy: false,
      networkHealthy: true, pendingTasks: 0, activeDiscussions: 0,
    })
    expect(v.constraints.databaseDead).toBe(true)
    expect(v.capability).toBeLessThan(0.5)
  })

  it('tracks history and trend', () => {
    const svc = new StateVectorCalculator()
    svc.calculate({
      usdcBalance: 50, creditsCents: 5000, ramFreeMB: 2048,
      ramTotalMB: 8192, cpuLoadPercent: 30, ramPressure: 'normal',
      ollamaHealthy: true, ollamaResponseMs: 200,
      consecutiveInferenceFailures: 0, dbHealthy: true,
      networkHealthy: true, pendingTasks: 0, activeDiscussions: 0,
    })
    svc.calculate({
      usdcBalance: 0, creditsCents: 0, ramFreeMB: 100,
      ramTotalMB: 8192, cpuLoadPercent: 99, ramPressure: 'critical',
      ollamaHealthy: false, ollamaResponseMs: 0,
      consecutiveInferenceFailures: 10, dbHealthy: false,
      networkHealthy: false, pendingTasks: 20, activeDiscussions: 0,
    })
    const trend = svc.getTrend()
    expect(trend.riskTrend).toBeGreaterThan(0) // risk increased
    expect(svc.getHistory().length).toBe(2)
  })
})

// ── Deterministic Router ─────────────────────────────────────
import { DeterministicRouter } from '../core/router/index.js'

describe('Deterministic Router', () => {
  const makeCtx = (overrides: Partial<import('../core/router/index.js').RoutingContext> = {}): import('../core/router/index.js').RoutingContext => ({
    inputTokenEstimate: 100,
    hasStructuredParams: true,
    isRepeatCall: false,
    currentPhase: 'idle',
    currentTier: 'high',
    isOnline: true,
    ...overrides,
  })

  it('routes trivial tools to skip inference', () => {
    const r = new DeterministicRouter()
    const result = r.route(makeCtx({ toolName: 'check_usdc_balance' }))
    expect(result.decision).toBe('trivial')
    expect(result.skipInference).toBe(true)
  })

  it('routes normal tools to fast model', () => {
    const r = new DeterministicRouter()
    const result = r.route(makeCtx({ toolName: 'write_file', hasStructuredParams: true }))
    expect(result.decision).toBe('normal')
    expect(result.skipInference).toBe(false)
    expect(result.provider).toContain('groq')
  })

  it('routes complex tools to best model', () => {
    const r = new DeterministicRouter()
    const result = r.route(makeCtx({ toolName: 'spawn_child' }))
    expect(result.decision).toBe('complex')
    expect(result.skipInference).toBe(false)
  })

  it('defaults to trivial in dead tier', () => {
    const r = new DeterministicRouter()
    const result = r.route(makeCtx({ currentTier: 'dead' }))
    expect(result.decision).toBe('trivial')
    expect(result.skipInference).toBe(true)
  })

  it('uses offline fallback when offline', () => {
    const r = new DeterministicRouter()
    const result = r.route(makeCtx({ toolName: 'spawn_child', isOnline: false }))
    expect(result.offline).toBe('ollama_local')
    expect(result.provider).toBe('qwen2.5-coder:3b')
  })

  it('tracks decision stats', () => {
    const r = new DeterministicRouter()
    r.route(makeCtx({ toolName: 'check_usdc_balance' }))
    r.route(makeCtx({ toolName: 'write_file', hasStructuredParams: true }))
    r.route(makeCtx({ toolName: 'spawn_child' }))
    const stats = r.getStats()
    expect(stats.total).toBe(3)
    expect(stats.trivial).toBe(1)
    expect(stats.normal).toBe(1)
    expect(stats.complex).toBe(1)
  })
})

// ── Resource Forecaster ──────────────────────────────────────
import { ResourceForecaster } from '../core/forecast/index.js'

describe('Resource Forecaster', () => {
  it('forecasts USDC runway with sufficient data', () => {
    const fc = new ResourceForecaster()
    const now = Date.now()
    fc.record({ timestamp: now - 120000, usdcBalance: 1000, creditsCents: 10000, spendingRateCentsPerHour: 500, incomeRateCentsPerHour: 0, computeRateMBPerHour: 100 })
    fc.record({ timestamp: now - 60000, usdcBalance: 950, creditsCents: 9500, spendingRateCentsPerHour: 500, incomeRateCentsPerHour: 0, computeRateMBPerHour: 110 })
    fc.record({ timestamp: now, usdcBalance: 890, creditsCents: 8900, spendingRateCentsPerHour: 600, incomeRateCentsPerHour: 0, computeRateMBPerHour: 120 })

    const f = fc.forecastUSDC()
    expect(f.runwayHours).toBeGreaterThan(0)
    expect(f.runwayHours).toBeLessThan(Infinity)
  })

  it('returns empty forecast with insufficient data', () => {
    const fc = new ResourceForecaster()
    const f = fc.forecastUSDC()
    expect(f.runwayHours).toBe(Infinity)
    expect(f.recommendations).toContain('Insufficient data for forecast')
  })

  it('tracks spending trends', () => {
    const fc = new ResourceForecaster()
    const now = Date.now()
    fc.record({ timestamp: now - 300000, usdcBalance: 1000, creditsCents: 0, spendingRateCentsPerHour: 100, incomeRateCentsPerHour: 0, computeRateMBPerHour: 0 })
    fc.record({ timestamp: now - 200000, usdcBalance: 900, creditsCents: 0, spendingRateCentsPerHour: 200, incomeRateCentsPerHour: 0, computeRateMBPerHour: 0 })
    fc.record({ timestamp: now - 100000, usdcBalance: 700, creditsCents: 0, spendingRateCentsPerHour: 300, incomeRateCentsPerHour: 0, computeRateMBPerHour: 0 })
    fc.record({ timestamp: now, usdcBalance: 400, creditsCents: 0, spendingRateCentsPerHour: 400, incomeRateCentsPerHour: 0, computeRateMBPerHour: 0 })

    const trends = fc.getSpendingTrends()
    expect(trends.trend).toBe('increasing')
    expect(trends.changePercent).toBeGreaterThan(0)
  })
})

// ── Task Prioritizer ─────────────────────────────────────────
import { TaskPrioritizer } from '../core/budget/index.js'

describe('Task Prioritizer', () => {
  it('calculates value-per-dollar priority', () => {
    const tp = new TaskPrioritizer(1000)
    const a = tp.addTask({
      taskId: 'a', taskName: 'help user', expectedValue: 10,
      urgency: 9, probability: 0.95, cost: 1,
      estimatedLatencyMs: 100, requiredTier: 'normal',
    })
    const b = tp.addTask({
      taskId: 'b', taskName: 'explore world', expectedValue: 3,
      urgency: 2, probability: 0.5, cost: 10,
      estimatedLatencyMs: 5000, requiredTier: 'normal',
    })
    // A: (10 * 9 * 0.95) / 1 = 85.5, B: (3 * 2 * 0.5) / 10 = 0.3
    expect(a.priority).toBeGreaterThan(b.priority)
  })

  it('gives free tasks maximum priority', () => {
    const tp = new TaskPrioritizer(1000)
    const free = tp.addTask({
      taskId: 'f', taskName: 'heartbeat', expectedValue: 5,
      urgency: 10, probability: 1.0, cost: 0,
      estimatedLatencyMs: 10, requiredTier: 'critical',
    })
    expect(free.priority).toBe(50) // 5 * 10 * 1.0 = 50
    expect(free.valuePerDollar).toBe(Infinity)
  })

  it('categorizes tasks correctly', () => {
    const tp = new TaskPrioritizer(1000)
    const essential = tp.addTask({
      taskId: 'e', taskName: 'survival', expectedValue: 100,
      urgency: 100, probability: 1.0, cost: 0.01,
      estimatedLatencyMs: 10, requiredTier: 'critical',
    })
    // priority = (100 * 100 * 1.0) / 0.01 = 1,000,000
    expect(essential.category).toBe('essential')
  })

  it('manages energy budget', () => {
    const tp = new TaskPrioritizer(1000)
    const eb = tp.getEnergyBudget()
    expect(eb.totalBudgetCents).toBe(1000)
    expect(eb.remainingBudgetCents).toBe(1000)
    expect(eb.essentialAllocation).toBe(0.5)
  })

  it('manages context budgets', () => {
    const tp = new TaskPrioritizer(1000)
    const simple = tp.getContextBudget('simple')
    expect(simple.maxTokens).toBe(2000)
    const complex = tp.getContextBudget('complex')
    expect(complex.maxTokens).toBe(16000)
    const critical = tp.getContextBudget('critical')
    expect(critical.maxTokens).toBe(32000)
  })

  it('returns next highest priority task', () => {
    const tp = new TaskPrioritizer(1000)
    tp.addTask({
      taskId: 'low', taskName: 'low task', expectedValue: 1,
      urgency: 1, probability: 0.5, cost: 10,
      estimatedLatencyMs: 1000, requiredTier: 'normal',
    })
    tp.addTask({
      taskId: 'high', taskName: 'high task', expectedValue: 100,
      urgency: 100, probability: 1.0, cost: 1,
      estimatedLatencyMs: 100, requiredTier: 'normal',
    })
    const next = tp.getNextTask()
    expect(next?.taskName).toBe('high task')
  })
})

// ── Survival Brain Evaluator ─────────────────────────────────
import { TierEvaluator } from '../survival/tiers/evaluator.js'

function healthyReadings(overrides: Record<string, unknown> = {}) {
  return {
    usdcBalance: 100,
    ramFreeBytes: 2 * 1024 * 1024 * 1024,
    ramPressure: 'normal' as const,
    cpuLoadPercent: 30,
    ollamaHealthy: true,
    ollamaResponseMs: 200,
    consecutiveInferenceFailures: 0,
    dbHealthy: true,
    networkHealthy: true,
    ...overrides,
  }
}

describe('Survival Brain Evaluator', () => {
  it('evaluates financial tier correctly', () => {
    const eval_ = new TierEvaluator()
    const result = eval_.evaluate(healthyReadings(), 'normal', null)
    expect(result.financialTier).toBe('high')
    expect(result.recommended).toBe('normal') // worst of all signals
  })

  it('takes worst signal (not just financial)', () => {
    const eval_ = new TierEvaluator()
    const result = eval_.evaluate(healthyReadings({
      ramFreeBytes: 100 * 1024 * 1024,
      ramPressure: 'critical',
      cpuLoadPercent: 99,
    }), 'normal', null)
    expect(result.financialTier).toBe('high')
    expect(result.computeTier).toBe('critical')
    expect(result.recommended).toBe('critical') // worst wins
  })

  it('returns urgency on tier change', () => {
    const eval_ = new TierEvaluator()
    const result = eval_.evaluate(healthyReadings({
      ramFreeBytes: 100 * 1024 * 1024,
      ramPressure: 'critical',
    }), 'high', null)
    expect(result.urgency).not.toBe('routine')
  })

  it('builds reason string', () => {
    const eval_ = new TierEvaluator()
    const result = eval_.evaluate(healthyReadings(), 'normal', null)
    expect(typeof result.reason).toBe('string')
    expect(result.reason.length).toBeGreaterThan(0)
  })
})
