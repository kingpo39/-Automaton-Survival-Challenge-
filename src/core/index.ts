/**
 * core/index.ts
 * 
 * Core Modules — The Nervous System
 * 
 * Extremely fast, deterministic, no LLM.
 * Always-on survival controller.
 */

// ── Event Bus ────────────────────────────────────────────────────────────────
export { EventBus, getEventBus, bus } from './event-bus/index.js'
export type { EventType, LegacyEvent, EventHandler } from './event-bus/index.js'
export type { EventMap, EventName, EventPayload, SentimentLabel } from './event-map.js'
export { LEGACY_EVENT_MAP } from './event-map.js'

// ── Survival FSM ─────────────────────────────────────────────────────────────
export { SurvivalFSM } from './router/survival-fsm.js'
export type { FSMState, StateTransition, HysteresisThreshold } from './router/survival-fsm.js'

// ── State Vector ─────────────────────────────────────────────────────────────
export { StateVectorCalculator } from './router/state-vector.js'
export type { StateVector, HardConstraints, ResourceReadings } from './router/state-vector.js'

// ── Deterministic Router ─────────────────────────────────────────────────────
export { DeterministicRouter, router, OMNIROUTE_COMBOS, OFFLINE_FALLBACK_MODEL, DEAD_STATE_FALLBACK, TaskClass } from './router/index.js'
export type { RouteDecision, RouteResult, RoutingContext, OfflineDecision, TaskRequest, RouterDecision } from './router/index.js'

// ── Resource Forecasting ─────────────────────────────────────────────────────
export { ResourceForecaster } from './forecast/index.js'
export type { ResourceForecast, FinancialTrajectory, RamTrend, SignalCorrelation } from './forecast/index.js'

// ── Task Prioritization + Context Budgeting ──────────────────────────────────
export { TaskPrioritizer } from './budget/index.js'
export type { TaskPriority, ContextBudget, EnergyBudget } from './budget/index.js'
