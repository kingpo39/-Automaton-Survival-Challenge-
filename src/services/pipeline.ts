/**
 * Search → Extract → Infer Pipeline
 * The core intelligence layer: searches the web, extracts content, summarizes with LLM.
 */

import { searchWeb, type SearchResult } from './search.js'
import { extractWebpage, type ExtractedPage } from './web-extractor.js'
import { inferWithFallback, type InferenceResult } from '../providers/index.js'

export interface PipelineResult {
  query: string
  searchResults: SearchResult[]
  extractedPages: ExtractedPage[]
  summary: string
  provider: string
  model: string
  latencyMs: number
}

/**
 * Full pipeline: Search → Extract top results → Summarize with LLM.
 */
export async function runPipeline(
  query: string,
  options?: {
    maxSearchResults?: number
    maxExtractPages?: number
    systemPrompt?: string
  }
): Promise<PipelineResult> {
  const start = Date.now()
  const maxSearch = options?.maxSearchResults ?? 5
  const maxExtract = options?.maxExtractPages ?? 3

  // Step 1: Search
  const searchResults = await searchWeb(query, maxSearch)

  // Step 2: Extract top pages
  const extractedPages: ExtractedPage[] = []
  for (const result of searchResults.slice(0, maxExtract)) {
    try {
      const page = await extractWebpage(result.url)
      extractedPages.push(page)
    } catch {
      // Skip failed extractions
    }
  }

  // Step 3: Build context from extracted content
  const contextParts: string[] = []
  for (const page of extractedPages) {
    contextParts.push(`## ${page.title}\nSource: ${page.url}\n\n${page.text.slice(0, 3000)}`)
  }

  const context = contextParts.join('\n\n---\n\n')

  // Step 4: Summarize with LLM
  const systemPrompt = options?.systemPrompt ?? 
    'You are a helpful research assistant. Summarize the provided web content accurately and concisely. Include key facts, figures, and sources. If the content is about recent events, note the date.'

  const prompt = `Research query: "${query}"\n\nHere is the extracted content from the top search results:\n\n${context}\n\nPlease provide a comprehensive summary of this information, covering the main points, key facts, and any notable details. Cite sources where relevant.`

  let summary = ''
  let provider = 'none'
  let model = 'none'

  try {
    const llmResult = await inferWithFallback(prompt, {
      systemPrompt,
      maxTokens: 2000,
    })
    summary = llmResult.text
    provider = llmResult.provider
    model = llmResult.model
  } catch (err) {
    // LLM failed — return raw search results
    summary = `LLM summarization unavailable. Here are the raw search results:\n\n` +
      searchResults.map(r => `**${r.title}**\n${r.url}\n${r.snippet}`).join('\n\n')
  }

  return {
    query,
    searchResults,
    extractedPages,
    summary,
    provider,
    model,
    latencyMs: Date.now() - start,
  }
}
