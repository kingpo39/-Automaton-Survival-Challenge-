/**
 * Platform Configuration — API keys + provider settings
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Load .env file from project root
const envPath = join(process.cwd(), '.env')
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  }
}

export interface ProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  rateLimit: { requests: number; windowMs: number }
}

export interface PlatformConfig {
  groq: ProviderConfig
  huggingface: ProviderConfig
  deepseek: ProviderConfig
  gemini: ProviderConfig
}

function env(key: string, fallback = ''): string {
  return process.env[key] || fallback
}

export function loadPlatformConfig(): PlatformConfig {
  return {
    groq: {
      apiKey: env('GROQ_API_KEY'),
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      maxTokens: 4096,
      rateLimit: { requests: 100, windowMs: 86400000 },
    },
    huggingface: {
      apiKey: env('HUGGINGFACE_API_KEY'),
      baseUrl: 'https://api-inference.huggingface.co',
      model: 'meta-llama/Llama-3.3-70B-Instruct',
      maxTokens: 4096,
      rateLimit: { requests: 30000, windowMs: 2592000000 },
    },
    deepseek: {
      apiKey: env('DEEPSEEK_API_KEY'),
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      maxTokens: 4096,
      rateLimit: { requests: 1000, windowMs: 86400000 },
    },
    gemini: {
      apiKey: env('GEMINI_API_KEY'),
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.0-flash',
      maxTokens: 4096,
      rateLimit: { requests: 1500, windowMs: 86400000 },
    },
  }
}
