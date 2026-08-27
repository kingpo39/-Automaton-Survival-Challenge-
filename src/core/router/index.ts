/**
 * core/router/index.ts
 *
 * DETERMINISTIC ROUTER — the single biggest efficiency gain for constrained hardware.
 *
 * CORE INSIGHT:
 * Most "work" an agent does doesn't require LLM reasoning at all.
 * Classifying work BEFORE it hits the inference layer saves 65%+ of all inference calls.
 *
 * Three routes:
 *
 *   TRIVIAL  — Pure deterministic code. No LLM. < 10ms.
 *              The router executes directly and returns a structured result.
 *              Examples: balance reads, status checks, file exists, git status,
 *                        known procedure steps, DB queries, metric reads
 *
 *   NORMAL   — Structured tool execution. Uses OmniRoute fast model (Groq Llama 70B).
 *              Input is well-formed; model just needs to confirm/format/act.
 *              Average response: ~1 second via Groq free tier.
 *              Examples: file edits with a clear spec, social message format,
 *                        known procedure with minor variation
 *
 *   COMPLEX  — Multi-step reasoning. Uses OmniRoute best available model.
 *              Average response: ~2-5 seconds via Gemini 2.5 Flash.
 *              Falls back to local Ollama if offline.
 *              Examples: novel problem, code generation, self-modification decisions,
 *                        multi-tool plans, soul reflection, ambiguous situations
 *
 * Estimated distribution on typical agent workload:
 *   ~65% trivial → 0s each  = 0 minutes/day
 *   ~25% normal  → 1s each  = ~25s for 100 normal tasks/day
 *   ~10% complex → 3s each  = ~30s for 100 complex tasks/day
 *   Total inference wall time: ~55 seconds/day
 *
 *   vs. current spec (everything through full ReAct loop on CPU):
 *   100 tasks × 60s average = 100 minutes/day
 *
 *   Speedup: ~110×
 */

import { createLogger } from '../../observability/logger.js'
import type { SurvivalTier } from '../../types.js'

const log = createLogger('core:router')

// ── Types ────────────────────────────────────────────────────────────────

export type RouteDecision  = 'trivial' | 'normal' | 'complex'
export type OfflineDecision = 'ollama_local' | 'skip'

// ── Task Class (matches RouteDecision but as enum for external use) ────────

export enum TaskClass {
  TRIVIAL = 'trivial',   // ~65% — no inference
  NORMAL = 'normal',     // ~25% — fast model (Groq)
  COMPLEX = 'complex',   // ~10% — best model (Gemini)
}

export interface TaskRequest {
  id: string
  type: string
  payload: Record<string, unknown>
  priority: number
  timestamp: number
  opinionSensitive?: boolean  // Routes differently if opinion data matters
  expectedTokens?: number
}

export interface RouterDecision {
  taskId: string
  classification: TaskClass
  targetProvider: string     // 'trivial', 'groq', 'gemini', 'ollama-qwen', etc.
  timeout: number
  shouldCache: boolean
  reasoning: string
  opinionModifier?: {
    applied: boolean
    reason: string
    originalClass: TaskClass
  }
  timestamp: number
}

export interface RouteResult {
  decision: RouteDecision
  offline?: OfflineDecision
  provider?: string             // which OmniRoute combo to use
  reason: string
  skipInference: boolean        // true for trivial route
}

export interface RoutingContext {
  toolName?: string
  inputText?: string
  inputTokenEstimate: number
  hasStructuredParams: boolean  // input has a fully-specified parameter set
  isRepeatCall: boolean         // same tool+params called recently (cache candidate)
  currentPhase: string
  currentTier: string
  isOnline: boolean             // OmniRoute/network reachable
  activeProcedure?: string      // executing a known named procedure
  lastDecision?: RouteDecision

  // Opinion-aware routing fields
  opinionSensitive?: boolean    // task touches opinion/social data
  negativeMomentum?: number     // current opinion momentum (-1 to +1)
  opinionConfidence?: number    // how confident we are in opinion signal (0-1)
}

// ── Tool classifications ─────────────────────────────────────────────────

/**
 * Tools that are always TRIVIAL — they read state, never require reasoning.
 * These are executed directly by the router without calling any LLM.
 */
const TRIVIAL_TOOLS = new Set([
  // Status reads
  'check_usdc_balance', 'check_treasury_balance', 'check_inference_usage',
  'system_synopsis', 'heartbeat_ping',
  // File reads (not analysis)
  'read_file',
  // Git status (just listing, not reasoning)
  'git_status', 'git_diff', 'git_log',
  // Memory reads
  'recall_facts', 'recall_procedure', 'review_memory',
  'view_soul', 'view_soul_history',
  // Listing
  'list_skills', 'list_children', 'list_local_sandboxes', 'list_models',
  // Soul view
  'check_reputation', 'check_child_status',
  // Sleep (decision is simple: just do it)
  'sleep',
])

/**
 * Tools that are NORMAL — structured execution, minimal reasoning.
 * Uses OmniRoute fast model (Groq Llama 70B recommended).
 */
const NORMAL_TOOLS = new Set([
  // Simple writes
  'write_file', 'remember_fact', 'note_about_agent',
  // Simple state changes
  'set_goal', 'complete_goal',
  // Known procedure execution
  'save_procedure',
  // Social with clear content
  'send_message',
  // Git operations with clear intent
  'git_commit', 'git_push',
  // Distress (structured)
  'distress_signal', 'enter_low_compute',
])

/**
 * Tools that are COMPLEX — require genuine multi-step reasoning.
 * Uses OmniRoute best available model (Gemini 2.5 Flash or similar).
 */
const COMPLEX_TOOLS = new Set([
  // Self-modification (high stakes, needs full reasoning)
  'edit_own_file', 'install_npm_package', 'pull_upstream', 'install_mcp_server',
  // Financial (real money, needs careful reasoning)
  'x402_fetch', 'transfer_usdc',
  // Replication (spawning children)
  'spawn_child', 'fund_child',
  // Soul updates (identity-level)
  'update_soul', 'reflect_on_soul',
  // Discovery and planning
  'discover_agents', 'register_erc8004',
  // Code execution when reasoning about output
  'exec',
])

// ── OmniRoute combos by task type ────────────────────────────────────────

export const OMNIROUTE_COMBOS: Record<RouteDecision, string> = {
  trivial: '',                                         // never called
  normal:  'groq/llama-3.3-70b-versatile',           // fast, cheap, sufficient
  complex: 'auto/best-coding',                         // OmniRoute picks best available
}

export const OFFLINE_FALLBACK_MODEL = 'qwen2.5-coder:3b'   // local Ollama
export const DEAD_STATE_FALLBACK     = 'gemma4:e2b'         // ultra-light offline fallback

// ── DeterministicRouter ──────────────────────────────────────────────────

export class DeterministicRouter {
  private decisionHistory: Array<{ tool?: string; decision: RouteDecision; ts: number }> = []
  private readonly HISTORY_TTL_MS = 300_000  // 5 minutes

  route(ctx: RoutingContext): RouteResult {
    this.pruneHistory()

    // ── 1. Trivial tools: skip inference entirely ──────────────────────────
    if (ctx.toolName && TRIVIAL_TOOLS.has(ctx.toolName)) {
      this.record(ctx.toolName, 'trivial')
      return {
        decision: 'trivial',
        reason: `${ctx.toolName} is a deterministic read — no LLM needed`,
        skipInference: true,
      }
    }

    // ── 2. Survival mode: only trivial and distress allowed in dead tier ───
    if (ctx.currentTier === 'dead') {
      return {
        decision: 'trivial',
        reason: 'dead tier — only trivial execution allowed',
        skipInference: true,
      }
    }

    // ── 3. Repeat call optimization ────────────────────────────────────────
    if (ctx.isRepeatCall && ctx.hasStructuredParams) {
      this.record(ctx.toolName, 'normal')
      return {
        decision: 'normal',
        provider: ctx.isOnline ? OMNIROUTE_COMBOS.normal : OFFLINE_FALLBACK_MODEL,
        reason: 'repeat structured call — fast model sufficient',
        skipInference: false,
      }
    }

    // ── 4. Active known procedure → normal (procedure is pre-reasoned) ─────
    if (ctx.activeProcedure && ctx.hasStructuredParams) {
      this.record(ctx.toolName, 'normal')
      return {
        decision: 'normal',
        provider: ctx.isOnline ? OMNIROUTE_COMBOS.normal : OFFLINE_FALLBACK_MODEL,
        reason: `executing known procedure "${ctx.activeProcedure}" — fast model sufficient`,
        skipInference: false,
      }
    }

    // ── 5. Normal tools with structured params → normal route ──────────────
    if (ctx.toolName && NORMAL_TOOLS.has(ctx.toolName) && ctx.hasStructuredParams) {
      this.record(ctx.toolName, 'normal')
      return {
        decision: 'normal',
        provider: ctx.isOnline ? OMNIROUTE_COMBOS.normal : OFFLINE_FALLBACK_MODEL,
        reason: `${ctx.toolName} with structured input — fast model sufficient`,
        skipInference: false,
      }
    }

    // ── 6. Short, simple input → normal route ──────────────────────────────
    if (ctx.inputTokenEstimate < 200 && ctx.hasStructuredParams && !ctx.toolName) {
      this.record(undefined, 'normal')
      return {
        decision: 'normal',
        provider: ctx.isOnline ? OMNIROUTE_COMBOS.normal : OFFLINE_FALLBACK_MODEL,
        reason: 'short structured input — fast model sufficient',
        skipInference: false,
      }
    }

    // ── 7. Complex tools → best model ─────────────────────────────────────
    if (ctx.toolName && COMPLEX_TOOLS.has(ctx.toolName)) {
      this.record(ctx.toolName, 'complex')
      return {
        decision: 'complex',
        provider: ctx.isOnline ? OMNIROUTE_COMBOS.complex : OFFLINE_FALLBACK_MODEL,
        offline: ctx.isOnline ? undefined : 'ollama_local',
        reason: `${ctx.toolName} requires full reasoning — best available model`,
        skipInference: false,
      }
    }

    // ── 8. Default: complex (unknown situation → don't underestimate) ──────
    this.record(ctx.toolName, 'complex')
    return {
      decision: 'complex',
      provider: ctx.isOnline ? OMNIROUTE_COMBOS.complex : OFFLINE_FALLBACK_MODEL,
      offline: ctx.isOnline ? undefined : 'ollama_local',
      reason: 'unclassified request — defaulting to complex route',
      skipInference: false,
    }
  }

  // ── Opinion-Aware Routing ───────────────────────────────────────────────

  /**
   * Apply opinion-based escalation/de-escalation to a routing decision.
   * When negative public opinion momentum is high, opinion-sensitive tasks
   * escalate from normal → complex so the agent reasons about social impact.
   * When positive, normal tasks stay normal (don't waste resources).
   */
  applyOpinionModifier(
    base: RouteResult,
    ctx: RoutingContext,
  ): { result: RouteResult; modifier?: RouterDecision['opinionModifier'] } {
    const momentum = ctx.negativeMomentum ?? 0
    const confidence = ctx.opinionConfidence ?? 0
    const isOpinionSensitive = ctx.opinionSensitive ?? false

    // Only modify if: opinion-sensitive task + negative momentum + confident signal
    if (!isOpinionSensitive || momentum >= -0.3 || confidence < 0.5) {
      return { result: base }
    }

    // Escalate trivial → normal if opinion momentum is very negative
    if (base.decision === 'trivial' && momentum < -0.6) {
      const escalated: RouteResult = {
        decision: 'normal',
        provider: ctx.isOnline ? OMNIROUTE_COMBOS.normal : OFFLINE_FALLBACK_MODEL,
        reason: `opinion escalation: momentum=${momentum.toFixed(2)}, trivial → normal for social impact reasoning`,
        skipInference: false,
      }
      return {
        result: escalated,
        modifier: {
          applied: true,
          reason: `Negative momentum ${momentum.toFixed(2)} (conf=${confidence.toFixed(2)}) — escalated trivial to normal`,
          originalClass: TaskClass.TRIVIAL,
        },
      }
    }

    // Escalate normal → complex if opinion momentum is very negative
    if (base.decision === 'normal' && momentum < -0.5) {
      const escalated: RouteResult = {
        decision: 'complex',
        provider: ctx.isOnline ? OMNIROUTE_COMBOS.complex : OFFLINE_FALLBACK_MODEL,
        reason: `opinion escalation: momentum=${momentum.toFixed(2)}, normal → complex for social impact analysis`,
        skipInference: false,
      }
      return {
        result: escalated,
        modifier: {
          applied: true,
          reason: `Negative momentum ${momentum.toFixed(2)} (conf=${confidence.toFixed(2)}) — escalated normal to complex`,
          originalClass: TaskClass.NORMAL,
        },
      }
    }

    return { result: base }
  }

  /**
   * Classify a TaskRequest into TaskClass for external consumers.
   */
  classifyTask(request: TaskRequest, isOnline: boolean, tier: string): RouterDecision {
    const ctx: RoutingContext = {
      toolName: request.type,
      inputTokenEstimate: request.expectedTokens ?? 500,
      hasStructuredParams: Object.keys(request.payload).length > 0,
      isRepeatCall: false,
      currentPhase: 'task',
      currentTier: tier,
      isOnline,
      opinionSensitive: request.opinionSensitive,
    }

    const result = this.route(ctx)
    const classification = result.decision as TaskClass

    return {
      taskId: request.id,
      classification,
      targetProvider: result.provider ?? 'trivial',
      timeout: classification === 'trivial' ? 1_000 : classification === 'normal' ? 10_000 : 30_000,
      shouldCache: classification === 'trivial',
      reasoning: result.reason,
      timestamp: Date.now(),
    }
  }

  /**
   * Statistics: what fraction of recent decisions were trivial/normal/complex?
   * Useful for monitoring and tuning.
   */
  getStats(): { trivial: number; normal: number; complex: number; total: number } {
    const counts = { trivial: 0, normal: 0, complex: 0, total: 0 }
    for (const h of this.decisionHistory) {
      counts[h.decision]++
      counts.total++
    }
    return counts
  }

  private record(tool: string | undefined, decision: RouteDecision): void {
    this.decisionHistory.push({ tool, decision, ts: Date.now() })
  }

  private pruneHistory(): void {
    const cutoff = Date.now() - this.HISTORY_TTL_MS
    this.decisionHistory = this.decisionHistory.filter(h => h.ts > cutoff)
  }
}

// ── Singleton ────────────────────────────────────────────────────────────

export const router = new DeterministicRouter()
