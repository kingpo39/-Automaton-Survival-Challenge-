/**
 * Platform Configuration — API keys + provider settings
 * Loads from environment variables, with .env fallback.
 */

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
      rateLimit: { requests: 100, windowMs: 86400000 }, // 100/day
    },
    huggingface: {
      apiKey: env('HUGGINGFACE_API_KEY'),
      baseUrl: 'https://api-inference.huggingface.co',
      model: 'meta-llama/Llama-3.3-70B-Instruct',
      maxTokens: 4096,
      rateLimit: { requests: 30000, windowMs: 2592000000 }, // 30k/month
    },
    deepseek: {
      apiKey: env('DEEPSEEK_API_KEY'),
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      maxTokens: 4096,
      rateLimit: { requests: 1000, windowMs: 86400000 }, // 1k/day
    },
    gemini: {
      apiKey: env('GEMINI_API_KEY'),
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.0-flash',
      maxTokens: 4096,
      rateLimit: { requests: 1500, windowMs: 86400000 }, // 1500/day
    },
  }
}
