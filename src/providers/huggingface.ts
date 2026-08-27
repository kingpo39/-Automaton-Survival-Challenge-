/**
 * HuggingFace Provider — Free inference API
 * Free tier: 30k requests/month
 */

import type { ProviderConfig } from '../platform-config.js'
import type { InferenceResult } from './groq.js'

export async function callHuggingFace(
  prompt: string,
  config: ProviderConfig,
  options?: { maxTokens?: number; systemPrompt?: string }
): Promise<InferenceResult> {
  const start = Date.now()

  const response = await fetch(`${config.baseUrl}/models/${config.model}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      inputs: options?.systemPrompt
        ? `${options.systemPrompt}\n\n${prompt}`
        : prompt,
      parameters: {
        max_new_tokens: options?.maxTokens ?? 512,
        temperature: 0.3,
        return_full_text: false,
      },
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`HuggingFace ${response.status}: ${body.slice(0, 200)}`)
  }

  const data = await response.json() as Array<{ generated_text: string }>

  return {
    text: data[0]?.generated_text ?? '',
    provider: 'huggingface',
    model: config.model,
    tokensUsed: 0, // HF doesn't report token counts
    latencyMs: Date.now() - start,
  }
}
