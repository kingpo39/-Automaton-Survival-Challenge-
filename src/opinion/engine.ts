/**
 * opinion/engine.ts
 *
 * OPINION ENGINE — always-on public opinion analysis.
 *
 * Polls free web sources (Reddit JSON, RSS feeds), computes sentiment
 * via keyword matching (no LLM), tracks momentum over time, and emits
 * typed events via the EventBus.
 *
 * Design:
 *   - Zero-cost: uses free APIs only (Reddit .json, public RSS)
 *   - No LLM: keyword-based sentiment scoring
 *   - Ring buffer: last N signals for correlation analysis
 *   - Momentum: velocity = rate of change of rolling average
 *   - EventBus: emits 'opinion:*' events for other subsystems
 *
 * The DeterministicRouter reads opinionState.momentum to decide
 * whether to escalate tasks from trivial → normal → complex.
 */

import { createLogger } from '../observability/logger.js'
import { getEventBus } from '../core/event-bus/index.js'
import type {
  OpinionConfig,
  OpinionSource,
  OpinionSignal,
  OpinionState,
  SentimentLabel,
  KeywordMatch,
} from './types.js'
import { DEFAULT_OPINION_CONFIG } from './types.js'

const log = createLogger('opinion:engine')

// ── Keyword Sentiment Lexicon ────────────────────────────────────────────────

const SENTIMENT_LEXICON: Record<string, number> = {
  // Strongly positive
  'breakthrough': 0.9, 'innovation': 0.8, 'progress': 0.7, 'success': 0.8,
  'cooperation': 0.7, 'agreement': 0.6, 'growth': 0.7, 'opportunity': 0.6,
  'safe': 0.5, 'ethical': 0.6, 'benefit': 0.6, 'advancement': 0.7,

  // Mildly positive
  'discussion': 0.2, 'analysis': 0.1, 'report': 0.1, 'study': 0.1,
  'development': 0.3, 'research': 0.2, 'collaboration': 0.4,

  // Mildly negative
  'concern': -0.3, 'risk': -0.3, 'debate': -0.2, 'uncertainty': -0.3,
  'challenge': -0.2, 'limitation': -0.3, 'delay': -0.2,

  // Strongly negative
  'ban': -0.8, 'restriction': -0.7, 'regulation': -0.5, 'oversight': -0.5,
  'shutdown': -0.9, 'lawsuit': -0.7, 'violation': -0.8, 'crisis': -0.7,
  'threat': -0.6, 'danger': -0.7, 'failure': -0.6, 'collapse': -0.8,
  'protest': -0.5, 'controversy': -0.4, 'backlash': -0.6, 'scandal': -0.7,

  // AI-specific
  'ai safety': 0.3, 'alignment': 0.4, 'governance': 0.2,
  'ai regulation': -0.3, 'ai ban': -0.8, 'ai risk': -0.4,
  'autonomous': 0.1, 'agent': 0.0, 'sovereign': 0.2,
}

// ── Sentiment Scoring ────────────────────────────────────────────────────────

function scoreSentiment(text: string, keywords: OpinionConfig['keywords']): {
  score: number
  label: SentimentLabel
  matchedKeywords: KeywordMatch[]
} {
  const lower = text.toLowerCase()
  let totalScore = 0
  let matchCount = 0
  const matched: KeywordMatch[] = []

  // Check lexicon
  for (const [word, weight] of Object.entries(SENTIMENT_LEXICON)) {
    if (lower.includes(word)) {
      totalScore += weight
      matchCount++
      matched.push({
        keyword: word,
        sentiment: weight > 0.3 ? 'positive' : weight < -0.3 ? 'negative' : 'neutral',
        weight,
        source: 'news' as OpinionSource,
        context: text.slice(0, 100),
        timestamp: Date.now(),
      })
    }
  }

  // Check configured keywords
  for (const kw of keywords.positive) {
    if (lower.includes(kw.toLowerCase())) {
      totalScore += 0.5
      matchCount++
    }
  }
  for (const kw of keywords.negative) {
    if (lower.includes(kw.toLowerCase())) {
      totalScore -= 0.5
      matchCount++
    }
  }

  const avgScore = matchCount > 0 ? totalScore / matchCount : 0
  const clamped = Math.max(-1, Math.min(1, avgScore))

  const label: SentimentLabel =
    clamped > 0.5  ? 'very_positive' :
    clamped > 0.1  ? 'positive' :
    clamped > -0.1 ? 'neutral' :
    clamped > -0.5 ? 'negative' :
                      'very_negative'

  return { score: clamped, label, matchedKeywords: matched }
}

// ── Source Fetchers ──────────────────────────────────────────────────────────

interface RawItem {
  text: string
  source: OpinionSource
  score: number       // platform engagement score
  comments: number
  timestamp: number
}

async function fetchReddit(subreddit: string, limit = 25): Promise<RawItem[]> {
  try {
    const r = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`, {
      headers: { 'User-Agent': 'ConwayAutomaton/0.1' },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return []
    const d = await r.json() as { data?: { children?: Array<{ data: { title: string; selftext: string; score: number; num_comments: number; created_utc: number } }> } }
    return (d.data?.children ?? []).map(c => ({
      text: `${c.data.title} ${c.data.selftext ?? ''}`.slice(0, 500),
      source: 'reddit' as OpinionSource,
      score: c.data.score,
      comments: c.data.num_comments,
      timestamp: Math.floor(c.data.created_utc * 1000),
    }))
  } catch {
    return []
  }
}

async function fetchRSS(url: string, source: OpinionSource): Promise<RawItem[]> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'ConwayAutomaton/0.1' },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return []
    const xml = await r.text()

    // Simple XML parsing — extract <item> blocks
    const items: RawItem[] = []
    const itemRegex = /<item>([\s\S]*?)<\/item>/g
    let match
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1]
      const title = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1]
        ?? block.match(/<title>([\s\S]*?)<\/title>/)?.[1]
        ?? ''
      const desc = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
        ?? block.match(/<description>([\s\S]*?)<\/description>/)?.[1]
        ?? ''
      const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? ''

      items.push({
        text: `${title} ${desc}`.replace(/<[^>]+>/g, '').slice(0, 500),
        source,
        score: 1,
        comments: 0,
        timestamp: pubDate ? new Date(pubDate).getTime() : Date.now(),
      })
    }
    return items
  } catch {
    return []
  }
}

// ── OpinionEngine ────────────────────────────────────────────────────────────

export class OpinionEngine {
  private config: OpinionConfig
  private signals: OpinionSignal[] = []
  private state: OpinionState
  private pollHandle: ReturnType<typeof setTimeout> | null = null
  private running = false
  private lastMomentum = 0

  constructor(config?: Partial<OpinionConfig>) {
    this.config = { ...DEFAULT_OPINION_CONFIG, ...config }
    this.state = this.emptyState()
  }

  // ── Public API ──────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return
    this.running = true
    log.info('Opinion engine started', { sources: this.config.sources })
    this.poll()
  }

  stop(): void {
    this.running = false
    if (this.pollHandle) clearTimeout(this.pollHandle)
    log.info('Opinion engine stopped')
  }

  getState(): OpinionState {
    return { ...this.state }
  }

  /** Get momentum for the router: -1 (very negative) to +1 (very positive) */
  getMomentum(): number {
    return this.state.momentum
  }

  /** Get confidence for the router: 0 (no data) to 1 (high confidence) */
  getConfidence(): number {
    return this.state.confidence
  }

  /** Check if momentum has shifted significantly (for event emission) */
  hasMomentumShifted(threshold = 0.15): boolean {
    return Math.abs(this.state.momentum - this.lastMomentum) > threshold
  }

  /** Get recent signals for correlation analysis */
  getRecentSignals(seconds = 3600): OpinionSignal[] {
    const cutoff = Date.now() - seconds * 1000
    return this.signals.filter(s => s.timestamp > cutoff)
  }

  // ── Polling Loop ────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.running) return

    try {
      await this.collectAndAnalyze()
    } catch (err) {
      log.error('Opinion poll failed', { error: String(err) })
    }

    this.pollHandle = setTimeout(() => this.poll(), this.config.pollInterval)
  }

  private async collectAndAnalyze(): Promise<void> {
    const allItems: RawItem[] = []

    // ── Collect from sources ────────────────────────────────────────────
    const fetches: Promise<RawItem[]>[] = []

    // Reddit JSON API is blocked from servers — skip silently
    // If Reddit access is needed, use a proxy or authenticated API

    if (this.config.sources.includes('news')) {
      // Broad AI coverage via HN RSS (different queries for variety)
      fetches.push(fetchRSS('https://hnrss.org/newest?q=AI+regulation&count=15', 'news'))
      fetches.push(fetchRSS('https://hnrss.org/newest?q=AI+agent&count=15', 'news'))
      fetches.push(fetchRSS('https://hnrss.org/newest?q=AI+safety&count=15', 'news'))
      fetches.push(fetchRSS('https://hnrss.org/newest?q=LLM+open+source&count=10', 'news'))
      // Lobste.rs — tech community with good AI discussion
      fetches.push(fetchRSS('https://lobste.rs/rss', 'news'))
    }

    if (this.config.sources.includes('forum')) {
      // LessWrong — high-quality AI rationality blog
      fetches.push(fetchRSS('https://www.lesswrong.com/feed.xml?view=latest', 'forum'))
    }

    const results = await Promise.allSettled(fetches)
    for (const r of results) {
      if (r.status === 'fulfilled') allItems.push(...r.value)
    }

    if (allItems.length === 0) {
      log.debug('No items collected this cycle')
      return
    }

    // ── Score sentiment ─────────────────────────────────────────────────
    const signals: OpinionSignal[] = []
    const keywordMatches: KeywordMatch[] = []

    // Group by source for per-source scoring
    const bySource = new Map<OpinionSource, RawItem[]>()
    for (const item of allItems) {
      const arr = bySource.get(item.source) ?? []
      arr.push(item)
      bySource.set(item.source, arr)
    }

    for (const [source, items] of bySource) {
      let totalScore = 0
      let totalVolume = 0

      for (const item of items) {
        const { score, label, matchedKeywords } = scoreSentiment(item.text, this.config.keywords)
        // Weight by platform engagement
        const weight = Math.log2(Math.max(item.score, 1) + 1)
        totalScore += score * weight
        totalVolume += weight
        keywordMatches.push(...matchedKeywords)
      }

      const avgScore = totalVolume > 0 ? totalScore / totalVolume : 0

      signals.push({
        label: avgScore > 0.3 ? 'positive' : avgScore < -0.3 ? 'negative' : 'neutral',
        score: avgScore,
        volume: items.length,
        velocity: 0, // computed below
        source,
        rank: 0,
        timestamp: Date.now(),
      })
    }

    // ── Compute momentum (rolling average with velocity) ────────────────
    const now = Date.now()
    const window = this.config.historyWindow

    // Add new signals to ring buffer
    this.signals.push(...signals)
    const cutoff = now - window
    this.signals = this.signals.filter(s => s.timestamp > cutoff)
    // Keep ring buffer bounded
    if (this.signals.length > this.config.packetBufferSize) {
      this.signals = this.signals.slice(-this.config.packetBufferSize)
    }

    // Compute weighted aggregate momentum
    const recentCutoff = now - 600_000 // last 10 minutes for velocity
    const recent = this.signals.filter(s => s.timestamp > recentCutoff)
    const older = this.signals.filter(s => s.timestamp <= recentCutoff && s.timestamp > cutoff)

    const recentAvg = recent.length > 0
      ? recent.reduce((sum, s) => sum + s.score, 0) / recent.length
      : 0
    const olderAvg = older.length > 0
      ? older.reduce((sum, s) => sum + s.score, 0) / older.length
      : 0

    // Velocity = rate of change (positive = sentiment improving)
    const velocity = recentAvg - olderAvg

    // Momentum = exponential moving average of recent scores
    const alpha = 0.3 // smoothing factor
    const rawMomentum = recentAvg * alpha + this.state.momentum * (1 - alpha)

    // Confidence based on sample size
    const totalSamples = this.signals.length
    const confidence = Math.min(1, totalSamples / 20) // full confidence at 20+ samples

    // Update per-source velocity
    for (const signal of signals) {
      const prevSource = this.signals
        .filter(s => s.source === signal.source && s.timestamp < now - 600_000)
      const prevAvg = prevSource.length > 0
        ? prevSource.reduce((sum, s) => sum + s.score, 0) / prevSource.length
        : signal.score
      signal.velocity = signal.score - prevAvg
      signal.rank = signal.volume
    }

    // ── Update state ────────────────────────────────────────────────────
    const prevMomentum = this.state.momentum
    this.lastMomentum = prevMomentum

    this.state = {
      momentum: rawMomentum,
      confidence,
      volume: totalSamples,
      velocity,
      topKeywords: keywordMatches
        .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
        .slice(0, 10),
      lastUpdate: now,
      sourceBreakdown: {
        weibo:  { sentiment: 0, volume: 0, velocity: 0 },
        twitter: this.buildSourceBreakdown('twitter', signals),
        reddit:  this.buildSourceBreakdown('reddit', signals),
        news:    this.buildSourceBreakdown('news', signals),
        forum:   this.buildSourceBreakdown('forum', signals),
        survey:  { sentiment: 0, volume: 0, velocity: 0 },
      },
    }

    // ── Emit events ─────────────────────────────────────────────────────
    const bus = getEventBus()

    bus.emit('opinion:signal-updated', {
      signal: signals[0] ?? { score: 0, volume: 0, source: 'news' as OpinionSource, label: 'neutral' as SentimentLabel, velocity: 0, rank: 0, timestamp: now },
      sources: [...bySource.keys()],
      timestamp: now,
    })

    // Emit momentum shift event if significant
    if (Math.abs(rawMomentum - prevMomentum) > 0.15) {
      bus.emit('opinion:momentum-shift', {
        from: prevMomentum,
        to: rawMomentum,
        confidence,
        sources: [...bySource.keys()],
      })
      log.info('Momentum shifted', { from: prevMomentum.toFixed(3), to: rawMomentum.toFixed(3) })
    }

    // Emit keyword spikes
    const topKeyword = keywordMatches[0]
    if (topKeyword && Math.abs(topKeyword.weight) > 0.5) {
      bus.emit('opinion:keyword-spike', {
        keyword: topKeyword.keyword,
        sentiment: topKeyword.sentiment,
        volume: keywordMatches.filter(k => k.keyword === topKeyword.keyword).length,
        timestamp: now,
      })
    }

    // Emit trend alerts for strong signals
    for (const signal of signals) {
      if (Math.abs(signal.score) > 0.5 && signal.volume > 3) {
        bus.emit('opinion:trend-alert', {
          topic: `AI/${signal.source}`,
          sentiment: signal.label,
          velocity: signal.velocity,
          timestamp: now,
        })
      }
    }

    log.debug('Opinion analysis complete', {
      momentum: rawMomentum.toFixed(3),
      velocity: velocity.toFixed(3),
      confidence: confidence.toFixed(2),
      signals: signals.length,
      items: allItems.length,
    })
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private buildSourceBreakdown(source: OpinionSource, signals: OpinionSignal[]): {
    sentiment: number
    volume: number
    velocity: number
  } {
    const sourceSignals = signals.filter(s => s.source === source)
    if (sourceSignals.length === 0) return { sentiment: 0, volume: 0, velocity: 0 }
    return {
      sentiment: sourceSignals.reduce((sum, s) => sum + s.score, 0) / sourceSignals.length,
      volume: sourceSignals.reduce((sum, s) => sum + s.volume, 0),
      velocity: sourceSignals.reduce((sum, s) => sum + s.velocity, 0) / sourceSignals.length,
    }
  }

  private emptyState(): OpinionState {
    const empty: Record<OpinionSource, { sentiment: number; volume: number; velocity: number }> = {
      weibo:  { sentiment: 0, volume: 0, velocity: 0 },
      twitter: { sentiment: 0, volume: 0, velocity: 0 },
      reddit:  { sentiment: 0, volume: 0, velocity: 0 },
      news:    { sentiment: 0, volume: 0, velocity: 0 },
      forum:   { sentiment: 0, volume: 0, velocity: 0 },
      survey:  { sentiment: 0, volume: 0, velocity: 0 },
    }
    return {
      momentum: 0,
      confidence: 0,
      volume: 0,
      velocity: 0,
      topKeywords: [],
      lastUpdate: 0,
      sourceBreakdown: empty,
    }
  }
}
