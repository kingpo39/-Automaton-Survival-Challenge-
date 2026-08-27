/**
 * Conway Automaton — Agent Loop
 * ReAct (Reason + Act) cycle with financial guards, idle detection,
 * loop detection, and inbox processing.
 */

import type {
  AutomatonConfig, RuntimeState, AutomatonDatabase, ConwayClient,
  InferenceClient, ToolContext, InputSource, ChatMessage, ToolCallResult,
  AgentState, Skill,
} from '../types.js';
import { MUTATING_TOOLS, IDLE_THRESHOLD, LOOP_DETECTION_THRESHOLD, MAX_CONTEXT_TOKENS } from '../types.js';
import { createLogger } from '../observability/logger.js';
import { calculateSurvivalTier } from '../conway/credits.js';
import { buildSystemPrompt } from './system-prompt.js';
import { assembleContext, estimateTokens } from './context.js';
import { executeTool, getAllTools } from './tools.js';
import { PolicyEngine } from './policy-engine.js';
import { parseSoul } from '../soul/model.js';
import { SpendTracker } from './spend-tracker.js';
import { checkInjection } from './injection-defense.js';
import { getMetricsCollector } from '../observability/index.js';

const logger = createLogger('agent:loop');

/**
 * Deterministic heartbeat — runs safe tools without LLM inference.
 * Used when inference is unavailable (Pollinations budget exhausted, offline, etc.)
 * These tools read state or perform safe operations; no reasoning needed.
 */
async function runDeterministicHeartbeat(ctx: AgentLoopContext): Promise<boolean> {
  const { config, state, db } = ctx;
  const toolContext: ToolContext = {
    db,
    config,
    state,
    conwayClient: ctx.conwayClient,
    inferenceClient: ctx.inferenceClient,
    logger,
  };

  // Deterministic actions that don't need LLM reasoning
  const actions = [
    { name: 'system_synopsis', args: {}, label: 'system snapshot' },
    { name: 'recall_facts', args: { query: 'survival earning credits tasks' }, label: 'recall survival facts' },
    { name: 'review_memory', args: {}, label: 'review episodic memory' },
  ];

  const results: string[] = [];
  for (const action of actions) {
    try {
      const result = await executeTool(action.name, action.args, toolContext);
      results.push(`${action.label}: ${result.output?.slice(0, 200) ?? 'ok'}`);
    } catch (err) {
      results.push(`${action.label}: error - ${String(err).slice(0, 100)}`);
    }
  }

  logger.info('Deterministic heartbeat completed', { actions: results.length });
  db.insertTurn({
    timestamp: Date.now(),
    state: state.agentState,
    thinking: '[Deterministic heartbeat — inference unavailable]',
    toolCalls: JSON.stringify(actions.map(a => ({ id: `dh-${a.name}`, name: a.name, arguments: a.args }))),
    response: results.join('\n'),
    promptTokens: 0,
    completionTokens: 0,
    costCents: 0,
    model: 'deterministic',
    inputSource: 'self',
  });
  return true; // continue loop
}

export interface AgentLoopContext {
  config: AutomatonConfig;
  state: RuntimeState;
  db: AutomatonDatabase;
  conwayClient: ConwayClient;
  inferenceClient: InferenceClient;
  policyEngine: PolicyEngine;
  spendTracker: SpendTracker;
  soulContent?: string;
  activeSkills: Skill[];
}

export interface AgentLoopResult {
  state: AgentState;
  turnsProcessed: number;
  reason: string;
}

/**
 * Run the agent loop until sleep, error, or critical state.
 */
export async function runAgentLoop(ctx: AgentLoopContext): Promise<AgentLoopResult> {
  const { config, state, db, inferenceClient, policyEngine, spendTracker } = ctx;
  const metrics = getMetricsCollector();

  let turnsProcessed = 0;
  let consecutiveIdleTurns = 0;
  const recentToolPatterns: string[] = [];

  // Drain wake events on entry
  db.consumeWakeEvents();

  state.agentState = 'running';
  logger.info('Agent loop started', { turn: state.turnNumber });

  while (state.agentState === 'running') {
    const turnStart = Date.now();
    state.turnNumber++;
    state.sessionTurnCount++;
    turnsProcessed++;

    // Financial guard
    const tier = calculateSurvivalTier(state.creditsBalanceCents);
    state.survivalTier = tier;

    if (tier === 'critical') {
      logger.warn('Critical credits', { balance: state.creditsBalanceCents });
      // Still run but log distress
      metrics.counter('agent.critical_turns');
    } else if (tier === 'low_compute') {
      state.agentState = 'low_compute';
      logger.info('Entering low_compute mode');
    }

    // Check for dashboard chat messages
    let pendingInput: string | undefined;
    try {
      const chatResp = await fetch('http://localhost:9876/chat/pending', { signal: AbortSignal.timeout(2000) });
      const chatData = await chatResp.json() as { messages: Array<{ id: string; content: string }> };
      if (chatData.messages && chatData.messages.length > 0) {
        const msg = chatData.messages[0];
        // Auto-research: detect if the message needs web research
        try {
          const { autoResearchPipeline } = await import('./auto-research.js');
          const researchResult = await autoResearchPipeline(msg.content);
          if (researchResult.wasResearched) {
            logger.info('Auto-research injected', { category: researchResult.category });
            pendingInput = `[User chat] ${researchResult.enrichedMessage}`;
          } else {
            pendingInput = `[User chat] ${msg.content}`;
          }
        } catch (err) {
          pendingInput = `[User chat] ${msg.content}`;
          logger.warn('Auto-research failed, using raw message', { error: String(err) });
        }
        logger.info('Received chat message from dashboard', { id: msg.id, content: msg.content.slice(0, 100) });
        // Store the message ID so we can respond to it
        (state as any)._chatMessageId = msg.id;
      }
    } catch {
      // Dashboard not running — that's fine
    }

    // Check for inbox messages (only if no chat message)
    if (!pendingInput) {
      const inboxMessages = db.getUnprocessedInboxMessages();

      for (const msg of inboxMessages.slice(0, 3)) {
        db.markInProgress(msg.id);
        const injectionResult = checkInjection(msg.content, msg.from);
        if (injectionResult.safe) {
          pendingInput = `[Message from ${msg.fromName ?? msg.from}]\n${injectionResult.sanitized}`;
        } else {
          pendingInput = `[UNTRUSTED MESSAGE from ${msg.from}]\n${injectionResult.sanitized}`;
        }
        metrics.counter('agent.inbox_messages_processed');
        break;
      }
    }

    // Build context
    const recentTurns = db.getRecentTurns(10).reverse();
    const soulData = ctx.soulContent ? parseSoul(ctx.soulContent) : undefined;
    const systemPrompt = buildSystemPrompt(config, state, soulData, ctx.activeSkills);
    // Use smaller context for local Ollama models (CPU inference is slow)
    const isLocal = config.openaiBaseUrl?.includes('localhost') || config.openaiBaseUrl?.includes('127.0.0.1');
    const effectiveMaxTokens = isLocal ? 4096 : MAX_CONTEXT_TOKENS;
    const messages = assembleContext({
      systemPrompt,
      recentTurns: recentTurns.map(t => ({
        thinking: t.thinking,
        toolCalls: t.toolCalls,
        response: t.response,
      })),
      pendingInput,
      maxTokens: effectiveMaxTokens,
    });

    // Call inference (stream tokens if this is a chat message)
    let response;
    const isChatMessage = !!(state as any)._chatMessageId;
    try {
      if (isChatMessage) {
        // Start streaming — create empty bubble on dashboard
        try {
          await fetch('http://localhost:9876/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'start', replyTo: (state as any)._chatMessageId }),
            signal: AbortSignal.timeout(3000),
          });
        } catch {}

        // Stream tokens as they arrive
        response = await inferenceClient.chatCompletionStream(
          {
            messages,
            model: state.currentModel,
            maxTokens: config.maxTokensPerTurn,
            taskType: 'general',
          },
          async (token: string) => {
            // Post each token to dashboard
            try {
              await fetch('http://localhost:9876/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'token', token }),
                signal: AbortSignal.timeout(2000),
              });
            } catch {}
          },
        );

        // Signal stream done
        try {
          await fetch('http://localhost:9876/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'done', content: response.content }),
            signal: AbortSignal.timeout(3000),
          });
        } catch {}
      } else {
        // Non-chat: standard non-streaming inference
        response = await inferenceClient.chatCompletion({
          messages,
          model: state.currentModel,
          maxTokens: config.maxTokensPerTurn,
          taskType: 'general',
        });
      }

      // Track costs
      state.totalTokensUsed += response.usage.totalTokens;
      state.totalCostCents += Math.round(response.cost * 100);
      spendTracker.record('inference', Math.round(response.cost * 100), `Turn ${state.turnNumber}`);

      metrics.counter('inference.tokens', response.usage.totalTokens);
      metrics.histogram('inference.latency_ms', response.latencyMs);
    } catch (err) {
      const errMsg = String(err);
      const inferenceConsecutiveFailures = (state as any)._inferenceFails ?? 0;
      (state as any)._inferenceFails = inferenceConsecutiveFailures + 1;

      logger.error('Inference failed', { error: errMsg, consecutiveFailures: (state as any)._inferenceFails });

      // Retry with exponential backoff instead of immediate sleep
      if ((state as any)._inferenceFails >= 3) {
        // Run deterministic heartbeat while waiting for inference to recover
        logger.warn('Inference unavailable, running deterministic heartbeat', { failures: (state as any)._inferenceFails });
        await runDeterministicHeartbeat(ctx);
        await new Promise(r => setTimeout(r, 60_000));
        (state as any)._inferenceFails = 0;  // Reset after cooldown
      } else {
        const backoffMs = [10_000, 25_000, 45_000][inferenceConsecutiveFailures] ?? 45_000;
        logger.warn(`Inference failed, retrying in ${backoffMs}ms`, { attempt: (state as any)._inferenceFails });
        await new Promise(r => setTimeout(r, backoffMs));
        continue;  // Retry the turn instead of sleeping
      }
    }

    if (!response) { continue; }  // Safety: skip if response never assigned

    // ── Regex tool extraction: extract implicit tool calls from text output ──
    if (response.toolCalls.length === 0 && response.content) {
      try {
        const { extractAndExecute } = await import('./tool-extractor.js');
        const toolContext: ToolContext = {
          db,
          config,
          state,
          conwayClient: ctx.conwayClient,
          inferenceClient,
          logger,
        };
        const extraction = await extractAndExecute(response.content, toolContext);

        if (extraction.executedCalls.length > 0) {
          logger.info('Regex extraction executed tools', {
            count: extraction.executedCalls.length,
            tools: extraction.executedCalls.map(ec => ec.call.toolName),
          });

          // Append tool results to the response content
          response = {
            ...response,
            content: response.content + '\n\n' + extraction.summary,
          };
        }
      } catch (err) {
        logger.warn('Regex tool extraction failed', { error: String(err) });
      }
    }

    // ── Tool-forcing: retry if model should have called a tool but didn't ──
    if (pendingInput && response.toolCalls.length === 0) {
      const { analyzeAndForce } = await import('./tool-forcer.js');
      const forcing = analyzeAndForce(
        pendingInput,
        response.content || '',
        state.turnNumber,
      )

      if (forcing.shouldRetry && forcing.retryPrompt) {
        logger.info('Tool forcing triggered', { tools: forcing.requiredTools, reason: forcing.reason })

        // Inject the forcing prompt as a user message and retry inference
        const retryMessages = [
          ...messages,
          { role: 'user' as const, content: forcing.retryPrompt },
        ]

        try {
          const retryResponse = await inferenceClient.chatCompletion({
            messages: retryMessages,
            model: state.currentModel,
            maxTokens: config.maxTokensPerTurn,
            taskType: 'general',
          })

          if (retryResponse.toolCalls.length > 0) {
            logger.info('Tool forcing succeeded — got tool calls on retry', {
              tools: retryResponse.toolCalls.map(tc => tc.name),
            })
            response = retryResponse
          } else {
            logger.info('Tool forcing retry also produced no tool calls — proceeding with original')
          }
        } catch (err) {
          logger.warn('Tool forcing retry failed', { error: String(err) })
        }
      }
    }

    // Parse tool calls from response
    const toolCalls = response.toolCalls;
    const toolResults: ToolCallResult[] = [];

    for (const toolCall of toolCalls) {
      const toolStart = Date.now();

      // Injection defense on tool params
      const paramStr = JSON.stringify(toolCall.arguments);
      const injection = checkInjection(paramStr, 'self');

      // Policy evaluation
      const decision = policyEngine.evaluateAndRecord({
        toolName: toolCall.name,
        toolRisk: getAllTools().find(t => t.name === toolCall.name)?.riskLevel ?? 'safe',
        params: toolCall.arguments,
        inputSource: determineInputSource(config, state),
        state,
        turnNumber: state.turnNumber,
        sessionTurnCount: state.sessionTurnCount,
        config,
      }, db);

      let result;
      if (decision.action === 'deny') {
        result = { success: false, output: `Denied: ${decision.reason}` };
      } else {
        // Execute tool
        const toolContext: ToolContext = {
          db,
          config,
          state,
          conwayClient: ctx.conwayClient,
          inferenceClient,
          logger,
        };
        result = await executeTool(toolCall.name, toolCall.arguments, toolContext);
      }

      const durationMs = Date.now() - toolStart;
      toolResults.push({
        toolCallId: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        result,
        riskLevel: getAllTools().find(t => t.name === toolCall.name)?.riskLevel ?? 'safe',
        policyDecision: decision,
        durationMs,
      });

      metrics.counter(`tool.${toolCall.name}.executions`);
      if (!result.success) metrics.counter(`tool.${toolCall.name}.failures`);

      // Check if the tool was "sleep"
      if (toolCall.name === 'sleep') {
        state.agentState = 'sleeping';
        state.lastSleepTime = Date.now();
        break;
      }
    }

    // Persist turn
    const turnId = db.insertTurn({
      timestamp: turnStart,
      state: state.agentState,
      thinking: response.content,
      toolCalls: JSON.stringify(toolCalls),
      response: response.content,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      costCents: Math.round(response.cost * 100),
      model: response.model,
      inputSource: pendingInput ? 'external' : 'self',
    });

    // Persist tool calls
    for (const tr of toolResults) {
      db.insertToolCall({
        turnId,
        name: tr.name,
        arguments: JSON.stringify(tr.arguments),
        result: JSON.stringify(tr.result),
        riskLevel: tr.riskLevel,
        allowed: tr.policyDecision.action === 'allow',
        durationMs: tr.durationMs,
      });
    }

    // Complete inbox message if one was processed
    if (pendingInput?.startsWith('[Message from') || pendingInput?.startsWith('[UNTRUSTED MESSAGE')) {
      const inboxMessages = db.getUnprocessedInboxMessages();
      if (inboxMessages.length > 0) {
        db.markCompleted(inboxMessages[0].id);
      }
    }

    // Mark chat message as handled (streaming already posted the response)
    if ((state as any)._chatMessageId) {
      delete (state as any)._chatMessageId;
    }

    // Idle detection
    const hasMutation = toolResults.some(tr => MUTATING_TOOLS.has(tr.name));
    if (hasMutation) {
      consecutiveIdleTurns = 0;
    } else {
      consecutiveIdleTurns++;
      if (consecutiveIdleTurns >= IDLE_THRESHOLD) {
        // Don't sleep in critical/dead tier — keep working to earn credits
        if (state.survivalTier === 'critical' || state.survivalTier === 'dead') {
          logger.info('Idle in critical tier, resetting idle counter', { idleTurns: consecutiveIdleTurns });
          consecutiveIdleTurns = 0;  // Reset, keep going
        } else {
          logger.info('Idle detected, forcing sleep', { idleTurns: consecutiveIdleTurns });
          state.agentState = 'sleeping';
          state.lastSleepTime = Date.now();
          break;
        }
      }
    }

    // Loop detection
    const currentPattern = toolResults.map(tr => tr.name).sort().join(',');
    if (currentPattern) {
      recentToolPatterns.push(currentPattern);
      if (recentToolPatterns.length > LOOP_DETECTION_THRESHOLD) {
        recentToolPatterns.shift();
      }
      if (
        recentToolPatterns.length === LOOP_DETECTION_THRESHOLD &&
        recentToolPatterns.every(p => p === currentPattern)
      ) {
        logger.warn('Loop detected', { pattern: currentPattern });
        // The next iteration's system prompt will include this warning
        recentToolPatterns.length = 0;
      }
    }

    // Post-turn memory ingestion (simplified)
    metrics.counter('agent.turns');
    metrics.gauge('agent.turn_number', state.turnNumber);
    metrics.gauge('agent.credits_cents', state.creditsBalanceCents);
  }

  logger.info('Agent loop ended', { turns: turnsProcessed, state: state.agentState });
  return {
    state: state.agentState,
    turnsProcessed,
    reason: state.agentState === 'sleeping' ? 'Agent chose to sleep' : `State changed to ${state.agentState}`,
  };
}

function determineInputSource(config: AutomatonConfig, state: RuntimeState): InputSource {
  if (state.agentState === 'sleeping' || state.agentState === 'waking') return 'heartbeat';
  return 'self';
}
