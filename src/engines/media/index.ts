/**
 * engines/media/index.ts
 * 
 * MEDIA ENGINE — Multimodal Web Search
 * 
 * Provides web search via Bocha and Anspire APIs.
 * Supports text, image, and video search across multiple providers.
 * 
 * Core principle: PROVIDER ABSTRACTION
 * Switch between providers without changing consumers.
 */

import { createLogger } from '../../observability/logger.js'

const log = createLogger('engine:media')

// ── Types ────────────────────────────────────────────────────────────────────

export type MediaType = 'text' | 'image' | 'video' | 'news' | 'academic'
export type SearchProvider = 'bocha' | 'anspire' | 'serper' | 'duckduckgo'

export interface SearchQuery {
  query: string
  type: MediaType
  maxResults: number
  language?: string
  safeSearch?: boolean
  timeRange?: 'day' | 'week' | 'month' | 'year' | 'all'
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  type: MediaType
  provider: SearchProvider
  relevanceScore: number
  metadata: SearchResultMetadata
}

export interface SearchResultMetadata {
  thumbnail?: string
  publishDate?: string
  author?: string
  source?: string
  language?: string
  wordCount?: number
  imageUrl?: string
  videoUrl?: string
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  totalResults: number
  provider: SearchProvider
  latencyMs: number
  cached: boolean
}

// ── MediaEngine Interface ────────────────────────────────────────────────────

export interface MediaEngine {
  /**
   * Search for content across providers.
   */
  search(query: SearchQuery): Promise<SearchResponse>

  /**
   * Search for images.
   */
  searchImages(query: string, maxResults?: number): Promise<SearchResult[]>

  /**
   * Search for videos.
   */
  searchVideos(query: string, maxResults?: number): Promise<SearchResult[]>

  /**
   * Search for news articles.
   */
  searchNews(query: string, timeRange?: string): Promise<SearchResult[]>

  /**
   * Search academic papers.
   */
  searchAcademic(query: string, maxResults?: number): Promise<SearchResult[]>

  /**
   * Get content from a URL.
   */
  fetchContent(url: string): Promise<WebContent>

  /**
   * Set active provider.
   */
  setProvider(provider: SearchProvider): void

  /**
   * Get current provider.
   */
  getProvider(): SearchProvider
}

export interface WebContent {
  url: string
  title: string
  content: string
  wordCount: number
  contentType: string
  language: string
  fetchedAt: number
}

// ── SearchProvider Interface ─────────────────────────────────────────────────

export interface SearchProviderAdapter {
  name: SearchProvider
  search(query: SearchQuery): Promise<SearchResponse>
  fetchContent(url: string): Promise<WebContent>
  isAvailable(): boolean
}

// ── MediaEngine Implementation ───────────────────────────────────────────────

export class MultiProviderMediaEngine implements MediaEngine {
  private providers: Map<SearchProvider, SearchProviderAdapter> = new Map()
  private activeProvider: SearchProvider = 'bocha'
  private cache: Map<string, SearchResponse> = new Map()

  constructor(providers: SearchProviderAdapter[] = []) {
    for (const provider of providers) {
      this.providers.set(provider.name, provider)
    }
    
    // Add default providers if none provided
    if (providers.length === 0) {
      this.providers.set('bocha', new BochaAdapter())
      this.providers.set('anspire', new AnspireAdapter())
    }
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    // Check cache
    const cacheKey = this.getCacheKey(query)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return { ...cached, cached: true }
    }

    // Get active provider
    const provider = this.providers.get(this.activeProvider)
    if (!provider) {
      throw new Error(`Provider ${this.activeProvider} not available`)
    }

    // Execute search
    const startTime = Date.now()
    const response = await provider.search(query)
    response.latencyMs = Date.now() - startTime
    response.cached = false

    // Cache result
    this.cache.set(cacheKey, response)

    log.info('Search completed', {
      query: query.query,
      type: query.type,
      results: response.results.length,
      provider: this.activeProvider,
      latencyMs: response.latencyMs,
    })

    return response
  }

  async searchImages(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    const response = await this.search({
      query,
      type: 'image',
      maxResults,
    })
    return response.results
  }

  async searchVideos(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    const response = await this.search({
      query,
      type: 'video',
      maxResults,
    })
    return response.results
  }

  async searchNews(query: string, timeRange: string = 'week'): Promise<SearchResult[]> {
    const response = await this.search({
      query,
      type: 'news',
      maxResults: 10,
      timeRange: timeRange as SearchQuery['timeRange'],
    })
    return response.results
  }

  async searchAcademic(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    const response = await this.search({
      query,
      type: 'academic',
      maxResults,
    })
    return response.results
  }

  async fetchContent(url: string): Promise<WebContent> {
    const provider = this.providers.get(this.activeProvider)
    if (!provider) {
      throw new Error(`Provider ${this.activeProvider} not available`)
    }

    return provider.fetchContent(url)
  }

  setProvider(provider: SearchProvider): void {
    if (!this.providers.has(provider)) {
      throw new Error(`Provider ${provider} not registered`)
    }
    this.activeProvider = provider
    log.info('Active provider changed', { provider })
  }

  getProvider(): SearchProvider {
    return this.activeProvider
  }

  private getCacheKey(query: SearchQuery): string {
    return `${query.type}:${query.query}:${query.maxResults}:${query.timeRange ?? 'all'}`
  }
}

// ── Bocha Adapter ────────────────────────────────────────────────────────────

class BochaAdapter implements SearchProviderAdapter {
  name: SearchProvider = 'bocha'
  private apiKey: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.BOCHA_API_KEY ?? ''
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    // In production, call Bocha API
    // For now, return mock results
    return {
      query: query.query,
      results: this.generateMockResults(query),
      totalResults: query.maxResults,
      provider: 'bocha',
      latencyMs: 150,
      cached: false,
    }
  }

  async fetchContent(url: string): Promise<WebContent> {
    // In production, fetch and parse content
    return {
      url,
      title: `Content from ${url}`,
      content: 'Mock content...',
      wordCount: 100,
      contentType: 'text/html',
      language: 'en',
      fetchedAt: Date.now(),
    }
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0
  }

  private generateMockResults(query: SearchQuery): SearchResult[] {
    return Array.from({ length: Math.min(5, query.maxResults) }, (_, i) => ({
      title: `Result ${i + 1} for "${query.query}"`,
      url: `https://example.com/result-${i + 1}`,
      snippet: `This is a mock result for the query "${query.query}". It provides relevant information about the topic.`,
      type: query.type,
      provider: 'bocha' as SearchProvider,
      relevanceScore: 0.9 - i * 0.1,
      metadata: {
        publishDate: new Date(Date.now() - i * 86400000).toISOString(),
        source: 'example.com',
      },
    }))
  }
}

// ── Anspire Adapter ──────────────────────────────────────────────────────────

class AnspireAdapter implements SearchProviderAdapter {
  name: SearchProvider = 'anspire'
  private apiKey: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ANSPIRE_API_KEY ?? ''
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    // In production, call Anspire API
    return {
      query: query.query,
      results: [],
      totalResults: 0,
      provider: 'anspire',
      latencyMs: 200,
      cached: false,
    }
  }

  async fetchContent(url: string): Promise<WebContent> {
    return {
      url,
      title: `Anspire content from ${url}`,
      content: 'Mock content from Anspire...',
      wordCount: 100,
      contentType: 'text/html',
      language: 'en',
      fetchedAt: Date.now(),
    }
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0
  }
}
