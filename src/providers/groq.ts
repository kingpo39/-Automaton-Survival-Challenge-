/**
 * Groq Provider — Fastest free inference
 * Free tier: 100 requests/day, 30k tokens/min
 */

import type { ProviderConfig } from '../platform-config.js'

export interface InferenceResult {
  text: string
  provider: string
  model: string
  tokensUsed: number
  latencyMs: number
}

export async function callGroq(
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
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
    throw new Error(`Groq ${response.status}: ${body.slice(0, 200)}`)
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>
    usage: { total_tokens: number }
  }

  return {
    text: data.choices[0]?.message?.content ?? '',
    provider: 'groq',
    model: config.model,
    tokensUsed: data.usage?.total_tokens ?? 0,
    latencyMs: Date.now() - start,
  }
}
