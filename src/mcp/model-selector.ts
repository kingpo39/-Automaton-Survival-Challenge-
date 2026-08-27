/**
 * src/mcp/model-selector.ts
 *
 * Auto-detects available Ollama models and selects the best one for tool use.
 *
 * Selection criteria (weighted):
 *   1. Tool support (30%) — does the model support function calling?
 *   2. Parameter count (25%) — larger models reason better
 *   3. Quantization quality (20%) — Q4 < Q5 < Q6 < Q8 < F16
 *   4. Context length (15%) — longer context = better for tools
 *   5. RAM fit (10%) — must fit in available memory
 *
 * Known tool-capable models:
 *   - qwen2.5-coder: tool calling via content parsing
 *   - llama3: tool calling via OpenAI-compatible API
 *   - mistral: tool calling via function calling format
 *
 * The selector runs at agent startup and picks the optimal model.
 * Falls back to a user-configured model if no good match found.
 */

import { createLogger } from '../observability/logger.js'

const log = createLogger('mcp:model-selector')

const OLLAMA_API = process.env.OLLAMA_API || 'http://localhost:11434'

// ── Model capability database ────────────────────────────────────────────────

interface ModelProfile {
  name: string
  family: string
  params: number         // parameter count in billions
  contextLength: number  // max context window
  toolSupport: 'native' | 'content' | 'none'
  toolReliability: number // 0-1: how reliably it calls tools
  description: string
}

// Known model profiles — updated as new models are released
const MODEL_PROFILES: Record<string, ModelProfile> = {
  // ── Qwen family ──
  'qwen2.5:7b':          { name: 'qwen2.5:7b', family: 'qwen2.5', params: 7, contextLength: 32768, toolSupport: 'native', toolReliability: 0.9, description: 'Best tool use at 7B' },
  'qwen2.5:14b':         { name: 'qwen2.5:14b', family: 'qwen2.5', params: 14, contextLength: 32768, toolSupport: 'native', toolReliability: 0.95, description: 'Excellent tool use' },
  'qwen2.5:32b':         { name: 'qwen2.5:32b', family: 'qwen2.5', params: 32, contextLength: 32768, toolSupport: 'native', toolReliability: 0.97, description: 'Near-GPT4 tool use' },
  'qwen2.5-coder:7b':    { name: 'qwen2.5-coder:7b', family: 'qwen2.5-coder', params: 7, contextLength: 32768, toolSupport: 'native', toolReliability: 0.85, description: 'Code-focused, good tools' },
  'qwen2.5-coder:32b':   { name: 'qwen2.5-coder:32b', family: 'qwen2.5-coder', params: 32, contextLength: 32768, toolSupport: 'native', toolReliability: 0.95, description: 'Best code + tools' },
  'qwen3:8b':            { name: 'qwen3:8b', family: 'qwen3', params: 8, contextLength: 32768, toolSupport: 'native', toolReliability: 0.9, description: 'Latest Qwen, strong tools' },

  // ── Llama family ──
  'llama3.1:8b':         { name: 'llama3.1:8b', family: 'llama3.1', params: 8, contextLength: 128000, toolSupport: 'native', toolReliability: 0.85, description: 'Good general + tools' },
  'llama3.1:70b':        { name: 'llama3.1:70b', family: 'llama3.1', params: 70, contextLength: 128000, toolSupport: 'native', toolReliability: 0.95, description: 'Excellent tools' },
  'llama3.2:3b':         { name: 'llama3.2:3b', family: 'llama3.2', params: 3, contextLength: 128000, toolSupport: 'content', toolReliability: 0.5, description: 'Lightweight, basic tools' },

  // ── Mistral family ──
  'mistral:7b':          { name: 'mistral:7b', family: 'mistral', params: 7, contextLength: 32000, toolSupport: 'native', toolReliability: 0.8, description: 'Decent tool use' },
  'mixtral:8x7b':        { name: 'mixtral:8x7b', family: 'mixtral', params: 47, contextLength: 32000, toolSupport: 'native', toolReliability: 0.9, description: 'MoE, fast + good tools' },

  // ── DeepSeek family ──
  'deepseek-r1:1.5b':    { name: 'deepseek-r1:1.5b', family: 'deepseek-r1', params: 1.5, contextLength: 64000, toolSupport: 'content', toolReliability: 0.3, description: 'Reasoning focus, weak tools' },
  'deepseek-r1:7b':      { name: 'deepseek-r1:7b', family: 'deepseek-r1', params: 7, contextLength: 64000, toolReliability: 0.6, toolSupport: 'content', description: 'Reasoning + basic tools' },
  'deepseek-r1:14b':     { name: 'deepseek-r1:14b', family: 'deepseek-r1', params: 14, contextLength: 64000, toolSupport: 'content', toolReliability: 0.7, description: 'Strong reasoning, OK tools' },

  // ── Abliterated variants (same capability, no safety filters) ──
  'huihui_ai/deepseek-r1-abliterated:1.5b': { name: 'huihui_ai/deepseek-r1-abliterated:1.5b', family: 'deepseek-r1', params: 1.5, contextLength: 64000, toolSupport: 'content', toolReliability: 0.3, description: 'Abliterated, weak tools' },
  'huihui_ai/qwen2.5-coder-abliterate:1.5b': { name: 'huihui_ai/qwen2.5-coder-abliterate:1.5b', family: 'qwen2.5-coder', params: 1.5, contextLength: 32768, toolSupport: 'content', toolReliability: 0.4, description: 'Abliterated coder, basic tools' },
  'qwen35-2b:latest':    { name: 'qwen35-2b:latest', family: 'qwen3.5', params: 1.9, contextLength: 32768, toolSupport: 'content', toolReliability: 0.35, description: 'Small, reasoning focus' },

  // ── Groq cloud models (free tier, no local CPU needed) ──
  'llama-3.3-70b-versatile': { name: 'llama-3.3-70b-versatile', family: 'llama3.3', params: 70, contextLength: 128000, toolSupport: 'native', toolReliability: 0.95, description: 'Groq cloud, 70B, excellent tools' },
  'llama-3.1-8b-instant': { name: 'llama-3.1-8b-instant', family: 'llama3.1', params: 8, contextLength: 128000, toolSupport: 'native', toolReliability: 0.85, description: 'Groq cloud, 8B, fast' },
  'qwen-qwq-32b': { name: 'qwen-qwq-32b', family: 'qwen3', params: 32, contextLength: 32768, toolSupport: 'native', toolReliability: 0.9, description: 'Groq cloud, reasoning + tools' },
  'gemma2-9b-it': { name: 'gemma2-9b-it', family: 'gemma2', params: 9, contextLength: 8192, toolSupport: 'content', toolReliability: 0.7, description: 'Groq cloud, Google Gemma' },
  'meta-llama/llama-4-scout-17b-16e-instruct': { name: 'meta-llama/llama-4-scout-17b-16e-instruct', family: 'llama4', params: 17, contextLength: 131072, toolSupport: 'native', toolReliability: 0.9, description: 'Groq cloud, Llama 4 Scout' },

}

// ── Ollama API types ─────────────────────────────────────────────────────────

interface OllamaModel {
  name: string
  model: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Fetch all available models from Ollama.
 */
export async function detectModels(): Promise<OllamaModel[]> {
  try {
    const resp = await fetch(`${OLLAMA_API}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return []
    const data = await resp.json() as any
    return data.models || []
  } catch (e: any) {
    log.warn('Failed to detect Ollama models', { error: e.message })
    return []
  }
}

/**
 * Check if a model supports tool calling by sending a test request.
 */
async function testToolSupport(modelName: string): Promise<'native' | 'content' | 'none'> {
  try {
    const resp = await fetch(`${OLLAMA_API}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        max_tokens: 10,
        tools: [{
          type: 'function',
          function: {
            name: 'calculate',
            description: 'Perform a calculation',
            parameters: {
              type: 'object',
              properties: {
                expression: { type: 'string', description: 'Math expression' }
              },
              required: ['expression']
            }
          }
        }],
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!resp.ok) return 'none'
    const data = await resp.json() as any
    const choice = data.choices?.[0]

    // Check if model returned tool_calls
    if (choice?.message?.tool_calls?.length > 0) {
      return 'native'
    }
    // Check if model output tool call in content
    if (choice?.message?.content?.includes('calculate')) {
      return 'content'
    }
    return 'none'
  } catch {
    return 'none'
  }
}

// ── Scoring ──────────────────────────────────────────────────────────────────

function estimateRamGB(model: OllamaModel): number {
  return model.size / (1024 * 1024 * 1024)
}

function parseParams(model: OllamaModel): number {
  const paramStr = model.details?.parameter_size || ''
  const match = paramStr.match(/([\d.]+)\s*B/)
  if (match) return parseFloat(match[1])
  // Estimate from family name
  const family = model.details?.family || model.name
  for (const [key, profile] of Object.entries(MODEL_PROFILES)) {
    if (family.includes(profile.family) || model.name.includes(key)) {
      return profile.params
    }
  }
  return 1 // default to 1B
}

function parseContextLength(model: OllamaModel): number {
  for (const [key, profile] of Object.entries(MODEL_PROFILES)) {
    if (model.name.includes(key) || model.name.includes(profile.family)) {
      return profile.contextLength
    }
  }
  // Default context lengths by family
  const family = model.details?.family || ''
  if (family.includes('qwen')) return 32768
  if (family.includes('llama')) return 128000
  if (family.includes('deepseek')) return 64000
  return 8192 // conservative default
}

function getToolReliability(model: OllamaModel): number {
  for (const [key, profile] of Object.entries(MODEL_PROFILES)) {
    if (model.name.includes(key) || model.name.includes(profile.family)) {
      return profile.toolReliability
    }
  }
  // Unknown model — estimate from params
  const params = parseParams(model)
  if (params >= 14) return 0.7
  if (params >= 7) return 0.5
  if (params >= 3) return 0.3
  return 0.15
}

interface ScoredModel {
  model: OllamaModel
  score: number
  breakdown: {
    toolScore: number
    paramScore: number
    quantScore: number
    contextScore: number
    ramScore: number
  }
  estimatedRamGB: number
  fitsInRam: boolean
  toolSupport: 'native' | 'content' | 'none'
}

/**
 * Score and rank all available models.
 */
export async function rankModels(availableRamGB = 8): Promise<ScoredModel[]> {
  const models = await detectModels()
  if (models.length === 0) return []

  log.info('Detected models', { count: models.length, names: models.map(m => m.name) })

  // Filter out cloud models (they're not local)
  const localModels = models.filter(m => !m.name.includes(':cloud') && m.size > 0)

  const scored: ScoredModel[] = []

  for (const model of localModels) {
    const params = parseParams(model)
    const contextLen = parseContextLength(model)
    const ramGB = estimateRamGB(model)
    const fitsInRam = ramGB < availableRamGB * 0.7 // leave 30% for OS + inference overhead

    const toolReliability = getToolReliability(model)

    // Tool support score (0-1)
    const toolScore = toolReliability

    // Parameter score (0-1) — logarithmic scale, 1B=0.1, 7B=0.5, 70B=1.0
    const paramScore = Math.min(1, Math.log10(params + 1) / Math.log10(70))

    // Quantization score (0-1) — rough estimate from file size vs params
    const expectedSizeGB = params * 0.5 // rough F16 baseline
    const compressionRatio = expectedSizeGB / Math.max(ramGB, 0.1)
    const quantScore = Math.min(1, compressionRatio > 4 ? 0.5 : compressionRatio > 2 ? 0.7 : 0.9)

    // Context score (0-1)
    const contextScore = Math.min(1, contextLen / 128000)

    // RAM fit score — penalty for not fitting
    const ramScore = fitsInRam ? 1.0 : Math.max(0, 1 - (ramGB - availableRamGB * 0.7) / availableRamGB)

    // Weighted total
    const score =
      toolScore * 0.30 +
      paramScore * 0.25 +
      quantScore * 0.20 +
      contextScore * 0.15 +
      ramScore * 0.10

    scored.push({
      model,
      score,
      breakdown: { toolScore, paramScore, quantScore, contextScore, ramScore },
      estimatedRamGB: ramGB,
      fitsInRam,
      toolSupport: 'content', // will be upgraded if tested
    })
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  return scored
}

/**
 * Select the best model for tool use.
 * Tests actual tool support on the top candidate.
 */
export async function selectBestModel(
  availableRamGB = 8,
  fallbackModel?: string,
): Promise<{
  selected: ScoredModel | null
  allModels: ScoredModel[]
  recommendation: string
}> {
  const ranked = await rankModels(availableRamGB)

  if (ranked.length === 0) {
    return {
      selected: null,
      allModels: [],
      recommendation: 'No local models found. Pull one with: ollama pull qwen2.5:7b',
    }
  }

  // Test tool support on top 3 candidates
  const candidates = ranked.filter(m => m.fitsInRam).slice(0, 3)
  for (const candidate of candidates) {
    const toolSupport = await testToolSupport(candidate.model.name)
    candidate.toolSupport = toolSupport
    if (toolSupport === 'native') {
      // Re-score with actual tool support
      candidate.score = candidate.score * 0.7 + 0.3 // boost for native tools
    }
  }

  // Re-sort with actual tool support data
  candidates.sort((a, b) => b.score - a.score)

  const best = candidates[0] || ranked[0]
  if (!best) {
    return {
      selected: null,
      allModels: ranked,
      recommendation: 'No suitable models found.',
    }
  }

  // Build recommendation
  const toolNote = best.toolSupport === 'native'
    ? 'native tool calling'
    : best.toolSupport === 'content'
      ? 'content-based tool parsing (less reliable)'
      : 'no tool support'

  const recommendation = [
    `Selected: ${best.model.name}`,
    `Score: ${best.score.toFixed(2)}/1.00`,
    `Tool support: ${toolNote}`,
    `RAM: ${best.estimatedRamGB.toFixed(1)}GB (fits: ${best.fitsInRam})`,
    `Context: ${parseContextLength(best.model).toLocaleString()} tokens`,
    `Params: ${parseParams(best.model)}B`,
  ].join('\n')

  log.info('Model selected', {
    model: best.model.name,
    score: best.score,
    toolSupport: best.toolSupport,
    ram: best.estimatedRamGB,
  })

  return { selected: best, allModels: ranked, recommendation }
}

/**
 * Format model list for display.
 */
export function formatModelList(models: ScoredModel[]): string {
  if (models.length === 0) return 'No models available.'

  const lines = ['Available Ollama models:\n']
  for (const m of models) {
    const fit = m.fitsInRam ? '✅' : '⚠️ RAM'
    const tools = m.toolSupport === 'native' ? '🔧' : m.toolSupport === 'content' ? '📝' : '❌'
    lines.push(
      `  ${fit} ${tools} ${m.model.name.padEnd(45)} ` +
      `Score: ${m.score.toFixed(2)} | ` +
      `${parseParams(m.model)}B | ` +
      `${m.estimatedRamGB.toFixed(1)}GB | ` +
      `${parseContextLength(m.model).toLocaleString()} ctx`
    )
  }

  return lines.join('\n')
}
