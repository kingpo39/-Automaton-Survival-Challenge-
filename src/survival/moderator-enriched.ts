/**
 * survival/moderator-enriched.ts
 * 
 * ENRICHED MODERATOR — Reads Multi-Agent Discussions
 * 
 * Reads moderator summaries from multi-agent discussions to enrich analysis.
 * Like Wireshark captures ALL packets, this processes ALL discussion signals
 * to help activate survival mode.
 * 
 * Core principle: INTELLIGENCE FROM COLLECTIVE
 * Every discussion contains signals. Every signal informs survival.
 */

import { createLogger } from '../observability/logger.js'
import type { AutomatonDatabase, SurvivalTier } from '../types.js'
import { PacketCapture, type Packet, type DiscussionPacketData } from './packet-capture.js'

const log = createLogger('survival:moderator-enriched')

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModeratorSummary {
  id: string
  timestamp: number
  source: string
  type: 'discussion' | 'multi_agent' | 'consensus' | 'debate' | 'brainstorm'
  
  // Content
  topic: string
  summary: string
  keyPoints: string[]
  participants: string[]
  
  // Intelligence
  sentiment: number          // -1.0 to 1.0
  threatKeywords: string[]
  actionItems: string[]
  
  // Enrichment
  relevanceScore: number     // 0-1, how relevant to survival
  survivalSignals: SurvivalSignal[]
}

export interface SurvivalSignal {
  type: 'threat' | 'opportunity' | 'warning' | 'info'
  source: string
  message: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  confidence: number         // 0-1
  actionRequired: boolean
}

export interface EnrichedSnapshot {
  timestamp: number
  discussionsRead: number
  signalsExtracted: number
  survivalSignals: SurvivalSignal[]
  enrichedTier: SurvivalTier
  enrichmentScore: number    // 0-100, how much discussion data enriched analysis
  packetStats: {
    totalCaptured: number
    discussions: number
    threats: number
  }
}

// ── Enriched Moderator ───────────────────────────────────────────────────────

export class EnrichedModerator {
  private packetCapture: PacketCapture
  private summaries: ModeratorSummary[] = []
  private survivalSignals: SurvivalSignal[] = []

  constructor(
    private readonly db: AutomatonDatabase,
  ) {
    this.packetCapture = new PacketCapture(db)
  }

  /**
   * Read all multi-agent discussion summaries.
   * This is the Wireshark-like capture — read EVERYTHING.
   */
  readAllDiscussions(): ModeratorSummary[] {
    const summaries: ModeratorSummary[] = []

    // 1. Read from working memory (discussion category)
    const workingMemory = this.db.getWorkingMemory()
    for (const entry of workingMemory) {
      if (entry.category === 'discussion' || entry.category === 'moderator' || entry.category === 'multi_agent') {
        const summary = this.parseDiscussionSummary(entry.key, entry.value, entry.createdAt)
        if (summary) {
          summaries.push(summary)
          this.packetCapture.captureDiscussion('working_memory', {
            action: 'summary',
            discussionId: entry.key,
            content: entry.value,
            sentiment: summary.sentiment > 0.2 ? 'positive' : summary.sentiment < -0.2 ? 'negative' : 'neutral',
            topics: summary.keyPoints,
          })
        }
      }
    }

    // 2. Read from episodic memory (discussion events)
    const episodes = this.db.getEpisodicMemory(50)
    for (const episode of episodes) {
      if (episode.classification === 'discussion' || 
          episode.classification === 'multi_agent' ||
          episode.classification === 'consensus' ||
          episode.classification === 'debate') {
        const summary = this.parseDiscussionSummary(
          `episode_${episode.id}`,
          episode.event,
          episode.timestamp
        )
        if (summary) {
          summaries.push(summary)
          this.packetCapture.captureDiscussion('episodic_memory', {
            action: 'message',
            discussionId: `ep_${episode.id}`,
            content: episode.event,
          })
        }
      }
    }

    // 3. Read from semantic memory (knowledge from discussions)
    const semanticMemory = this.db.getSemanticMemory('discussion')
    for (const entry of semanticMemory) {
      const summary = this.parseDiscussionSummary(
        `semantic_${entry.key}`,
        entry.value,
        entry.createdAt
      )
      if (summary) {
        summaries.push(summary)
      }
    }

    // 4. Read from relationship memory (trust signals)
    const relationshipMemory = this.db.getRelationshipMemory('discussions')
    if (relationshipMemory) {
      const metadata = JSON.parse(relationshipMemory.metadata || '{}')
      if (metadata.recentDiscussions) {
        for (const disc of metadata.recentDiscussions) {
          const summary = this.parseDiscussionSummary(
            `relationship_${disc.id}`,
            disc.summary,
            disc.timestamp
          )
          if (summary) {
            summaries.push(summary)
          }
        }
      }
    }

    // Sort by timestamp, most recent first
    this.summaries = summaries.sort((a, b) => b.timestamp - a.timestamp)
    
    log.info('Discussions read', {
      total: this.summaries.length,
      withThreats: this.summaries.filter(s => s.threatKeywords.length > 0).length,
    })

    return this.summaries
  }

  /**
   * Extract survival signals from all discussions.
   * This is the enrichment step — turn discussions into actionable intelligence.
   */
  extractSurvivalSignals(): SurvivalSignal[] {
    const signals: SurvivalSignal[] = []

    for (const summary of this.summaries) {
      // Extract threat signals
      for (const keyword of summary.threatKeywords) {
        signals.push({
          type: 'threat',
          source: summary.source,
          message: `Threat keyword detected: "${keyword}" in discussion about ${summary.topic}`,
          severity: this.computeKeywordSeverity(keyword),
          confidence: summary.relevanceScore,
          actionRequired: true,
        })
      }

      // Extract warning signals from negative sentiment
      if (summary.sentiment < -0.5) {
        signals.push({
          type: 'warning',
          source: summary.source,
          message: `Highly negative discussion: ${summary.summary.substring(0, 100)}`,
          severity: 'medium',
          confidence: Math.abs(summary.sentiment),
          actionRequired: false,
        })
      }

      // Extract opportunity signals from positive sentiment
      if (summary.sentiment > 0.5 && summary.relevanceScore > 0.7) {
        signals.push({
          type: 'opportunity',
          source: summary.source,
          message: `Positive opportunity: ${summary.summary.substring(0, 100)}`,
          severity: 'low',
          confidence: summary.sentiment,
          actionRequired: false,
        })
      }

      // Extract action items as info signals
      for (const action of summary.actionItems) {
        signals.push({
          type: 'info',
          source: summary.source,
          message: `Action item: ${action}`,
          severity: 'low',
          confidence: summary.relevanceScore,
          actionRequired: true,
        })
      }
    }

    // Deduplicate signals
    const uniqueSignals = this.deduplicateSignals(signals)
    
    // Sort by severity and confidence
    this.survivalSignals = uniqueSignals.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
      return severityOrder[a.severity] - severityOrder[b.severity]
    })

    log.info('Survival signals extracted', {
      total: this.survivalSignals.length,
      threats: this.survivalSignals.filter(s => s.type === 'threat').length,
      warnings: this.survivalSignals.filter(s => s.type === 'warning').length,
      opportunities: this.survivalSignals.filter(s => s.type === 'opportunity').length,
    })

    return this.survivalSignals
  }

  /**
   * Get enriched snapshot combining all discussion intelligence.
   */
  getEnrichedSnapshot(currentTier: SurvivalTier): EnrichedSnapshot {
    const discussions = this.readAllDiscussions()
    const signals = this.extractSurvivalSignals()
    const stats = this.packetCapture.getStats()

    // Compute enrichment score based on available data
    const enrichmentScore = Math.min(100, 
      (discussions.length * 10) + 
      (signals.filter(s => s.type === 'threat').length * 20) +
      (signals.filter(s => s.type === 'warning').length * 10)
    )

    // Determine if tier should be adjusted based on signals
    const enrichedTier = this.computeEnrichedTier(currentTier, signals)

    return {
      timestamp: Date.now(),
      discussionsRead: discussions.length,
      signalsExtracted: signals.length,
      survivalSignals: signals,
      enrichedTier,
      enrichmentScore,
      packetStats: {
        totalCaptured: stats.totalCaptured,
        discussions: stats.byType['discussion'] ?? 0,
        threats: signals.filter(s => s.type === 'threat').length,
      },
    }
  }

  /**
   * Get packet capture instance for direct access.
   */
  getPacketCapture(): PacketCapture {
    return this.packetCapture
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private parseDiscussionSummary(
    key: string,
    value: string,
    timestamp: number
  ): ModeratorSummary | null {
    if (!value || value.length < 10) return null

    const lower = value.toLowerCase()
    
    // Extract threat keywords
    const threatKeywords: string[] = []
    const threatPatterns = [
      'attack', 'exploit', 'vulnerability', 'compromise', 'malicious',
      'injection', 'denial', 'breach', 'leak', 'steal', 'hack',
      'phishing', 'scam', 'fraud', 'theft', 'sabotage'
    ]
    for (const pattern of threatPatterns) {
      if (lower.includes(pattern)) {
        threatKeywords.push(pattern)
      }
    }

    // Extract action items
    const actionItems: string[] = []
    const actionPatterns = ['should', 'need to', 'must', 'action:', 'todo:', 'follow up']
    for (const pattern of actionPatterns) {
      const idx = lower.indexOf(pattern)
      if (idx !== -1) {
        const sentence = value.substring(idx, Math.min(idx + 100, value.length))
        actionItems.push(sentence)
      }
    }

    // Compute sentiment
    const sentiment = this.computeSentiment(value)

    // Compute relevance to survival
    const relevanceScore = this.computeRelevance(value, threatKeywords)

    return {
      id: key,
      timestamp,
      source: key.split('_')[0],
      type: this.classifyDiscussionType(value),
      topic: this.extractTopic(value),
      summary: value.substring(0, 200),
      keyPoints: this.extractKeyPoints(value),
      participants: this.extractParticipants(value),
      sentiment,
      threatKeywords,
      actionItems,
      relevanceScore,
      survivalSignals: [], // Will be populated by extractSurvivalSignals
    }
  }

  private computeSentiment(text: string): number {
    const lower = text.toLowerCase()
    const positive = ['good', 'great', 'excellent', 'success', 'positive', 'improve', 'opportunity']
    const negative = ['bad', 'terrible', 'fail', 'negative', 'risk', 'threat', 'danger', 'loss']

    let score = 0
    for (const word of positive) {
      if (lower.includes(word)) score += 0.2
    }
    for (const word of negative) {
      if (lower.includes(word)) score -= 0.2
    }

    return Math.max(-1, Math.min(1, score))
  }

  private computeRelevance(text: string, threatKeywords: string[]): number {
    let relevance = 0
    const lower = text.toLowerCase()

    // Survival-related terms increase relevance
    const survivalTerms = ['survival', 'tier', 'credits', 'usdc', 'funding', 'distress', 'alive']
    for (const term of survivalTerms) {
      if (lower.includes(term)) relevance += 0.2
    }

    // Threat keywords increase relevance
    relevance += threatKeywords.length * 0.15

    return Math.min(1, relevance)
  }

  private classifyDiscussionType(text: string): ModeratorSummary['type'] {
    const lower = text.toLowerCase()
    if (lower.includes('debate') || lower.includes('argument')) return 'debate'
    if (lower.includes('brainstorm') || lower.includes('idea')) return 'brainstorm'
    if (lower.includes('consensus') || lower.includes('agreement')) return 'consensus'
    if (lower.includes('multi') || lower.includes('agent')) return 'multi_agent'
    return 'discussion'
  }

  private extractTopic(text: string): string {
    // Simple topic extraction — first meaningful sentence
    const sentences = text.split(/[.!?]+/)
    return sentences[0]?.trim().substring(0, 100) ?? 'Unknown topic'
  }

  private extractKeyPoints(text: string): string[] {
    // Extract bullet points or key phrases
    const points: string[] = []
    const lines = text.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
        points.push(trimmed.substring(1).trim())
      }
    }
    return points.slice(0, 5)
  }

  private extractParticipants(text: string): string[] {
    // Simple participant extraction — look for @mentions or names
    const participants: string[] = []
    const mentions = text.match(/@[\w]+/g) ?? []
    participants.push(...mentions.map(m => m.substring(1)))
    return [...new Set(participants)].slice(0, 10)
  }

  private computeKeywordSeverity(keyword: string): SurvivalSignal['severity'] {
    const criticalKeywords = ['compromise', 'breach', 'theft', 'sabotage']
    const highKeywords = ['attack', 'exploit', 'malicious', 'hack']
    const mediumKeywords = ['vulnerability', 'injection', 'phishing']

    if (criticalKeywords.includes(keyword)) return 'critical'
    if (highKeywords.includes(keyword)) return 'high'
    if (mediumKeywords.includes(keyword)) return 'medium'
    return 'low'
  }

  private computeEnrichedTier(
    currentTier: SurvivalTier,
    signals: SurvivalSignal[]
  ): SurvivalTier {
    const criticalThreats = signals.filter(
      s => s.type === 'threat' && s.severity === 'critical'
    ).length

    const highThreats = signals.filter(
      s => s.type === 'threat' && s.severity === 'high'
    ).length

    // If critical threats detected, consider downgrading tier
    if (criticalThreats > 0) {
      const tierOrder: SurvivalTier[] = ['high', 'normal', 'low_compute', 'critical', 'dead']
      const currentIdx = tierOrder.indexOf(currentTier)
      return tierOrder[Math.min(currentIdx + 1, tierOrder.length - 1)]
    }

    // If multiple high threats, consider caution
    if (highThreats >= 3 && currentTier === 'high') {
      return 'normal'
    }

    return currentTier
  }

  private deduplicateSignals(signals: SurvivalSignal[]): SurvivalSignal[] {
    const seen = new Set<string>()
    return signals.filter(signal => {
      const key = `${signal.type}:${signal.source}:${signal.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}
