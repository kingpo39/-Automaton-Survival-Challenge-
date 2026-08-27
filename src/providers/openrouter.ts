/**
 * OpenRouter Provider — Aggregator with free models
 * Uses OpenAI-compatible API at openrouter.ai
 */

import type { ProviderConfig } from '../platform-config.js'
import type { InferenceResult } from './groq.js'

export async function callOpenRouter(
  prompt: string,
  config: ProviderConfig,
  options?: { maxTokens?: number; systemPrompt?: string }
): Promise<InferenceResult> {
  const start = Date.now()
  const messages: Array<{ role: string; content: string }> = []

  if (options?.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://github.com/kingpo39/-Automaton-Survival-Challenge-',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: options?.maxTokens ?? config.maxTokens,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 200)}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>
    usage: { total_tokens: number }
  }

  return {
    text: data.choices[0]?.message?.content ?? '',
    provider: 'openrouter',
    model: config.model,
    tokensUsed: data.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
  }
}
