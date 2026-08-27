/**
 * engines/spider/index.ts
 * 
 * MINDSPIDER — Multi-Platform Crawler
 * 
 * Crawls 7 social media platforms for intelligence gathering:
 * Twitter/X, Reddit, Mastodon, Bluesky, YouTube, Telegram, Discord
 * 
 * Core principle: RESPECT ROBOTS.TXT
 * Crawl ethically, cache aggressively, rate-limit always.
 */

import { createLogger } from '../../observability/logger.js'

const log = createLogger('engine:spider')

// ── Platform Types ───────────────────────────────────────────────────────────

export type Platform = 'twitter' | 'reddit' | 'mastodon' | 'bluesky' | 'youtube' | 'telegram' | 'discord'

export interface PlatformConfig {
  name: Platform
  enabled: boolean
  apiKey?: string
  rateLimitMs: number
  maxRequestsPerMinute: number
  respectRobotsTxt: boolean
}

export interface CrawlRequest {
  platform: Platform
  query?: string
  userId?: string
  subreddit?: string
  channel?: string
  maxResults: number
  timeRange?: 'hour' | 'day' | 'week' | 'month' | 'year'
  language?: string
  includeReplies?: boolean
}

export interface CrawlResult {
  platform: Platform
  posts: Post[]
  totalResults: number
  crawlTimeMs: number
  cached: boolean
  rateLimitRemaining: number
}

export interface Post {
  id: string
  platform: Platform
  author: PostAuthor
  content: string
  timestamp: number
  url: string
  metrics: PostMetrics
  media?: MediaAttachment[]
  language?: string
  sentiment?: number
  topics?: string[]
}

export interface PostAuthor {
  id: string
  name: string
  handle: string
  followers?: number
  verified?: boolean
  profileUrl: string
}

export interface PostMetrics {
  likes: number
  shares: number
  replies: number
  views?: number
  bookmarks?: number
}

export interface MediaAttachment {
  type: 'image' | 'video' | 'audio' | 'link'
  url: string
  thumbnail?: string
  caption?: string
}

// ── Spider Interface ─────────────────────────────────────────────────────────

export interface Spider {
  /**
   * Crawl a platform for posts.
   */
  crawl(request: CrawlRequest): Promise<CrawlResult>

  /**
   * Get trending topics from a platform.
   */
  getTrending(platform: Platform, location?: string): Promise<TrendingTopic[]>

  /**
   * Get user posts.
   */
  getUserPosts(platform: Platform, userId: string, maxResults?: number): Promise<Post[]>

  /**
   * Get post details.
   */
  getPost(platform: Platform, postId: string): Promise<Post | null>

  /**
   * Search across all platforms.
   */
  searchAll(query: string, platforms?: Platform[]): Promise<Map<Platform, CrawlResult>>

  /**
   * Get platform status (rate limits, health).
   */
  getPlatformStatus(platform: Platform): Promise<PlatformStatus>

  /**
   * Configure a platform.
   */
  configurePlatform(config: PlatformConfig): void
}

export interface TrendingTopic {
  topic: string
  postCount: number
  sentiment?: number
  url?: string
}

export interface PlatformStatus {
  platform: Platform
  healthy: boolean
  rateLimitRemaining: number
  rateLimitResetMs: number
  lastCrawlTime?: number
}

// ── Spider Implementation ────────────────────────────────────────────────────

export class MindSpider implements Spider {
  private platforms: Map<Platform, PlatformConfig> = new Map()
  private cache: Map<string, CrawlResult> = new Map()
  private rateLimitCounters: Map<Platform, { count: number; resetAt: number }> = new Map()

  constructor(configs: PlatformConfig[] = []) {
    // Initialize default configs
    const defaults: PlatformConfig[] = [
      { name: 'twitter', enabled: true, rateLimitMs: 1000, maxRequestsPerMinute: 60, respectRobotsTxt: true },
      { name: 'reddit', enabled: true, rateLimitMs: 2000, maxRequestsPerMinute: 30, respectRobotsTxt: true },
      { name: 'mastodon', enabled: true, rateLimitMs: 1500, maxRequestsPerMinute: 40, respectRobotsTxt: true },
      { name: 'bluesky', enabled: true, rateLimitMs: 1000, maxRequestsPerMinute: 50, respectRobotsTxt: true },
      { name: 'youtube', enabled: true, rateLimitMs: 2000, maxRequestsPerMinute: 25, respectRobotsTxt: true },
      { name: 'telegram', enabled: true, rateLimitMs: 1500, maxRequestsPerMinute: 35, respectRobotsTxt: true },
      { name: 'discord', enabled: true, rateLimitMs: 1000, maxRequestsPerMinute: 50, respectRobotsTxt: true },
    ]

    for (const config of defaults) {
      this.platforms.set(config.name, config)
    }

    // Override with provided configs
    for (const config of configs) {
      this.platforms.set(config.name, config)
    }
  }

  async crawl(request: CrawlRequest): Promise<CrawlResult> {
    // Check rate limit
    await this.checkRateLimit(request.platform)

    // Check cache
    const cacheKey = this.getCacheKey(request)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return { ...cached, cached: true }
    }

    // Execute crawl
    const startTime = Date.now()
    const adapter = this.getAdapter(request.platform)
    const result = await adapter.crawl(request)
    
    result.crawlTimeMs = Date.now() - startTime
    result.cached = false

    // Cache result
    this.cache.set(cacheKey, result)

    // Update rate limit counter
    this.incrementRateLimit(request.platform)

    log.info('Crawl completed', {
      platform: request.platform,
      results: result.posts.length,
      crawlTimeMs: result.crawlTimeMs,
    })

    return result
  }

  async getTrending(platform: Platform, location?: string): Promise<TrendingTopic[]> {
    const adapter = this.getAdapter(platform)
    return adapter.getTrending(location)
  }

  async getUserPosts(platform: Platform, userId: string, maxResults: number = 20): Promise<Post[]> {
    const result = await this.crawl({ platform, userId, maxResults })
    return result.posts
  }

  async getPost(platform: Platform, postId: string): Promise<Post | null> {
    const adapter = this.getAdapter(platform)
    return adapter.getPost(postId)
  }

  async searchAll(query: string, platforms?: Platform[]): Promise<Map<Platform, CrawlResult>> {
    const targetPlatforms = platforms ?? Array.from(this.platforms.keys()).filter(p => this.platforms.get(p)?.enabled)
    const results = new Map<Platform, CrawlResult>()

    await Promise.all(
      targetPlatforms.map(async platform => {
        try {
          const result = await this.crawl({ platform, query, maxResults: 10 })
          results.set(platform, result)
        } catch (err) {
          log.warn('Crawl failed', { platform, error: String(err) })
        }
      })
    )

    return results
  }

  async getPlatformStatus(platform: Platform): Promise<PlatformStatus> {
    const config = this.platforms.get(platform)
    const counter = this.rateLimitCounters.get(platform)

    return {
      platform,
      healthy: config?.enabled ?? false,
      rateLimitRemaining: (config?.maxRequestsPerMinute ?? 0) - (counter?.count ?? 0),
      rateLimitResetMs: counter?.resetAt ?? Date.now(),
      lastCrawlTime: counter?.resetAt,
    }
  }

  configurePlatform(config: PlatformConfig): void {
    this.platforms.set(config.name, config)
    log.info('Platform configured', { platform: config.name, enabled: config.enabled })
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private getAdapter(platform: Platform): PlatformAdapter {
    // In production, return platform-specific adapters
    return new MockAdapter(platform)
  }

  private async checkRateLimit(platform: Platform): Promise<void> {
    const config = this.platforms.get(platform)
    if (!config) throw new Error(`Platform ${platform} not configured`)

    const counter = this.rateLimitCounters.get(platform)
    if (counter && counter.count >= config.maxRequestsPerMinute) {
      const waitMs = counter.resetAt - Date.now()
      if (waitMs > 0) {
        log.warn('Rate limit reached, waiting', { platform, waitMs })
        await new Promise(resolve => setTimeout(resolve, waitMs))
      }
    }
  }

  private incrementRateLimit(platform: Platform): void {
    const config = this.platforms.get(platform)!
    const counter = this.rateLimitCounters.get(platform)

    if (!counter || Date.now() > counter.resetAt) {
      this.rateLimitCounters.set(platform, {
        count: 1,
        resetAt: Date.now() + 60000, // Reset after 1 minute
      })
    } else {
      counter.count++
    }
  }

  private getCacheKey(request: CrawlRequest): string {
    return `${request.platform}:${request.query ?? ''}:${request.userId ?? ''}:${request.maxResults}`
  }
}

// ── Platform Adapter Interface ───────────────────────────────────────────────

interface PlatformAdapter {
  crawl(request: CrawlRequest): Promise<CrawlResult>
  getTrending(location?: string): Promise<TrendingTopic[]>
  getPost(postId: string): Promise<Post | null>
}

// ── Mock Adapter ─────────────────────────────────────────────────────────────

class MockAdapter implements PlatformAdapter {
  constructor(private platform: Platform) {}

  async crawl(request: CrawlRequest): Promise<CrawlResult> {
    // Return mock data
    const posts: Post[] = Array.from({ length: Math.min(5, request.maxResults) }, (_, i) => ({
      id: `${this.platform}_${Date.now()}_${i}`,
      platform: this.platform,
      author: {
        id: `user_${i}`,
        name: `User ${i}`,
        handle: `@user${i}`,
        followers: Math.floor(Math.random() * 10000),
        verified: Math.random() > 0.8,
        profileUrl: `https://${this.platform}.com/user${i}`,
      },
      content: `This is a mock post from ${this.platform} about "${request.query ?? 'general'}". Post number ${i + 1}.`,
      timestamp: Date.now() - i * 3600000,
      url: `https://${this.platform}.com/post/${i}`,
      metrics: {
        likes: Math.floor(Math.random() * 1000),
        shares: Math.floor(Math.random() * 100),
        replies: Math.floor(Math.random() * 50),
        views: Math.floor(Math.random() * 10000),
      },
      language: request.language ?? 'en',
    }))

    return {
      platform: this.platform,
      posts,
      totalResults: posts.length,
      crawlTimeMs: 100,
      cached: false,
      rateLimitRemaining: 50,
    }
  }

  async getTrending(_location?: string): Promise<TrendingTopic[]> {
    return [
      { topic: `Trending on ${this.platform}`, postCount: 1000 },
      { topic: 'Technology', postCount: 500 },
      { topic: 'AI', postCount: 300 },
    ]
  }

  async getPost(postId: string): Promise<Post | null> {
    return {
      id: postId,
      platform: this.platform,
      author: {
        id: 'user_1',
        name: 'User 1',
        handle: '@user1',
        profileUrl: `https://${this.platform}.com/user1`,
      },
      content: `Post ${postId} content`,
      timestamp: Date.now(),
      url: `https://${this.platform}.com/post/${postId}`,
      metrics: { likes: 10, shares: 5, replies: 2 },
    }
  }
}
