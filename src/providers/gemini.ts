/**
 * Google Gemini Provider — Backup option, free limited tier
 * Free tier: 1500 requests/day
 */

import type { ProviderConfig } from '../platform-config.js'
import type { InferenceResult } from './groq.js'

export async function callGemini(
  prompt: string,
  config: ProviderConfig,
  options?: { maxTokens?: number; systemPrompt?: string }
): Promise<InferenceResult> {
  const start = Date.now()

  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []
  
  if (options?.systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: options.systemPrompt }] })
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] })
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] })

  const url = `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 4096,
        temperature: 0.3,
      },
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Gemini ${response.status}: ${body.slice(0, 200)}`)
  }

  const data = await response.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
    usageMetadata: { totalTokenCount: number }
  }

  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    provider: 'gemini',
    model: config.model,
    tokensUsed: data.usageMetadata?.totalTokenCount ?? 0,
    latencyMs: Date.now() - start,
  }
}
