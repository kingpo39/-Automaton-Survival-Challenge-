/**
 * opinion/types.ts
 *
 * Types for public-opinion analysis — the NLP/social layer
 * that feeds the survival brain's decision-making.
 *
 * These signals tell the agent HOW THE WORLD FEELS about topics,
 * which routes affect routing (opinion-sensitive tasks escalate),
 * and which funding requests gain social proof.
 */

// ── Sentiment & Sources ──────────────────────────────────────────────────────

export type SentimentLabel =
  | 'very_negative'
  | 'negative'
  | 'neutral'
  | 'positive'
  | 'very_positive'

export type OpinionSource =
  | 'weibo'
  | 'twitter'
  | 'reddit'
  | 'news'
  | 'forum'
  | 'survey'

// ── Core Opinion Signal ──────────────────────────────────────────────────────

export interface OpinionSignal {
  label: SentimentLabel
  score: number        // -1 to +1
  volume: number       // how many mentions
  velocity: number     // rate of change (positive = momentum growing)
  source: OpinionSource
  rank: number
  timestamp: number
}

export interface KeywordMatch {
  keyword: string
  sentiment: SentimentLabel
  weight: number
  source: OpinionSource
  context: string
  timestamp: number
}

export interface OpinionEvent {
  id: string
  type: 'SIGNAL_UPDATE' | 'TREND_ALERT' | 'KEYWORD_SPIKE'
  signal: OpinionSignal
  metadata: Record<string, unknown>
  timestamp: number
}

// ── Platform-Specific Feeds ──────────────────────────────────────────────────

export interface WeiboTrending {
  topic: string
  mentions: number
  hotValue: number    // Weibo's heat metric
  sentiment?: SentimentLabel
  timestamp: number
}

export interface TwitterFeed {
  id: string
  author: string
  text: string
  sentiment: SentimentLabel
  timestamp: number
  likes: number
  retweets: number
  engagementScore: number
}

export interface RedditPost {
  id: string
  subreddit: string
  title: string
  text: string
  sentiment: SentimentLabel
  score: number
  comments: number
  timestamp: number
}

// ── Opinion Configuration ────────────────────────────────────────────────────

export interface OpinionConfig {
  /** Which sources to monitor */
  sources: OpinionSource[]

  /** Keywords to track (domain-specific) */
  keywords: {
    positive: string[]
    negative: string[]
    neutral: string[]
  }

  /** Sentiment thresholds for router escalation */
  thresholds: {
    escalateIfNegativeMomentum: number   // e.g., -0.5
    deescalateIfPositiveMomentum: number // e.g., 0.6
  }

  /** Update frequency (ms) */
  pollInterval: number

  /** History retention (ms) */
  historyWindow: number

  /** Ring buffer size for packet capture */
  packetBufferSize: number
}

// ── Aggregate Opinion State ──────────────────────────────────────────────────

export interface OpinionState {
  momentum: number     // -1 to +1 (aggregate direction)
  confidence: number   // 0-1 (how confident are we in the signal)
  volume: number       // total mentions across all sources
  velocity: number     // rate of change of momentum
  topKeywords: KeywordMatch[]
  lastUpdate: number
  sourceBreakdown: Record<OpinionSource, {
    sentiment: number
    volume: number
    velocity: number
  }>
}

// ── Convenience Defaults ─────────────────────────────────────────────────────

export const DEFAULT_OPINION_CONFIG: OpinionConfig = {
  sources: ['twitter', 'reddit', 'news', 'forum'],
  keywords: {
    positive: ['AI safety', 'regulation', 'compliance', 'cooperation'],
    negative: ['ban', 'restriction', 'regulation', 'oversight'],
    neutral: ['discussion', 'analysis', 'report'],
  },
  thresholds: {
    escalateIfNegativeMomentum: -0.5,
    deescalateIfPositiveMomentum: 0.6,
  },
  pollInterval: 60_000,       // 1 minute
  historyWindow: 24 * 3600_000, // 24 hours
  packetBufferSize: 1000,
}
