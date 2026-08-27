/**
 * Multi-Provider Inference Router
 * Tries providers in priority order with intelligent fallback.
 * 
 * Fallback chain: Groq → HuggingFace → Deepseek → Gemini
 */

import { loadPlatformConfig, type PlatformConfig } from '../platform-config.js'
import { callGroq, type InferenceResult } from './groq.js'
export type { InferenceResult } from './groq.js'
import type { ProviderConfig } from '../platform-config.js'
import { callHuggingFace } from './huggingface.js'
import { callDeepseek } from './deepseek.js'
import { callGemini } from './gemini.js'
import { callOpenRouter } from './openrouter.js'
import { callGitHub } from './github.js'

export type ProviderName = 'groq' | 'huggingface' | 'deepseek' | 'gemini' | 'openrouter' | 'github'

// Provider call functions
const PROVIDERS: Record<ProviderName, typeof callGroq> = {
  groq: callGroq,
  huggingface: callHuggingFace,
  deepseek: callDeepseek,
  gemini: callGemini,
  openrouter: callOpenRouter,
  github: callGitHub,
}

// Default priority chain (fastest first)
const DEFAULT_CHAIN: ProviderName[] = ['openrouter', 'groq', 'github', 'huggingface', 'deepseek', 'gemini']

// Rate limit tracking per provider
const rateLimits = new Map<ProviderName, { count: number; resetAt: number }>()

function checkRateLimit(provider: ProviderName, config: ProviderConfig): boolean {
  const now = Date.now()
  const limit = rateLimits.get(provider)
  
  if (!limit || now > limit.resetAt) {
    rateLimits.set(provider, { count: 1, resetAt: now + config.rateLimit.windowMs })
    return true
  }
  
  if (limit.count >= config.rateLimit.requests) {
    return false // Rate limited
  }
  
  limit.count++
  return true
}

export interface InferOptions {
  maxTokens?: number
  systemPrompt?: string
  preferredProvider?: ProviderName
  chain?: ProviderName[]
}

/**
 * Infer with automatic fallback across providers.
 * Tries each provider in the chain until one succeeds.
 */
export async function inferWithFallback(
  prompt: string,
  options?: InferOptions
): Promise<InferenceResult> {
  const config = loadPlatformConfig()
  const chain = options?.chain ?? DEFAULT_CHAIN
  const errors: Array<{ provider: string; error: string }> = []

  for (const providerName of chain) {
    const providerConfig = config[providerName]
    
    // Skip if no API key
    if (!providerConfig.apiKey) {
      continue
    }

    // Skip if rate limited
    if (!checkRateLimit(providerName, providerConfig)) {
      errors.push({ provider: providerName, error: 'Rate limited' })
      continue
    }

    try {
      const callFn = PROVIDERS[providerName]
      const result = await callFn(prompt, providerConfig, {
        maxTokens: options?.maxTokens,
        systemPrompt: options?.systemPrompt,
      })

      // Success — return result
      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      errors.push({ provider: providerName, error: errorMsg })
      // Continue to next provider
    }
  }

  throw new Error(
    `All providers exhausted: ${errors.map(e => `${e.provider}(${e.error})`).join(', ')}`
  )
}

/**
 * Get available providers (ones with API keys set).
 */
export function getAvailableProviders(): ProviderName[] {
  const config = loadPlatformConfig()
  const available: ProviderName[] = []
  
  for (const [name, providerConfig] of Object.entries(config)) {
    if (providerConfig.apiKey) {
      available.push(name as ProviderName)
    }
  }
  
  return available
}

/**
 * Get rate limit status for all providers.
 */
export function getRateLimitStatus(): Record<ProviderName, { used: number; limit: number; resetsIn: number }> {
  const config = loadPlatformConfig()
  const status = {} as Record<ProviderName, { used: number; limit: number; resetsIn: number }>

  for (const [name, providerConfig] of Object.entries(config)) {
    const limit = rateLimits.get(name as ProviderName)
    const now = Date.now()
    status[name as ProviderName] = {
      used: limit?.count ?? 0,
      limit: providerConfig.rateLimit.requests,
      resetsIn: limit ? Math.max(0, limit.resetAt - now) : providerConfig.rateLimit.windowMs,
    }
  }

  return status
}
