/**
 * engines/forum/index.ts
 * 
 * FORUM ENGINE — LLM-Powered Discussion Moderator
 * 
 * Manages multi-agent discussions, moderation, and consensus building.
 * Provides debate facilitation, sentiment tracking, and decision synthesis.
 * 
 * Core principle: FACILITATE, DON'T DOMINATE
 * The moderator guides discussions without imposing opinions.
 */

import { createLogger } from '../../observability/logger.js'

const log = createLogger('engine:forum')

// ── Types ────────────────────────────────────────────────────────────────────

export type DiscussionType = 'debate' | 'brainstorm' | 'review' | 'consensus' | 'analysis'
export type ParticipantRole = 'moderator' | 'contributor' | 'observer' | 'expert'
export type MessageSentiment = 'positive' | 'negative' | 'neutral' | 'constructive' | 'destructive'

export interface Discussion {
  id: string
  topic: string
  type: DiscussionType
  participants: Participant[]
  messages: DiscussionMessage[]
  status: 'active' | 'paused' | 'concluded'
  startedAt: number
  endedAt?: number
  consensus?: ConsensusResult
}

export interface Participant {
  id: string
  name: string
  role: ParticipantRole
  expertise: string[]
  contributionScore: number
}

export interface DiscussionMessage {
  id: string
  participantId: string
  content: string
  timestamp: number
  sentiment: MessageSentiment
  replyTo?: string
  tags: string[]
  moderation?: ModerationAction
}

export interface ModerationAction {
  type: 'warning' | 'mute' | 'highlight' | 'summarize' | 'redirect'
  reason: string
  timestamp: number
}

export interface ConsensusResult {
  agreement: number        // 0-100%
  summary: string
  keyPoints: string[]
  dissenting: string[]
  actionItems: string[]
}

// ── ForumHost Interface ──────────────────────────────────────────────────────

export interface ForumHost {
  /**
   * Create a new discussion.
   */
  createDiscussion(
    topic: string,
    type: DiscussionType,
    participants?: Participant[]
  ): Promise<Discussion>

  /**
   * Add a message to the discussion.
   */
  addMessage(
    discussionId: string,
    participantId: string,
    content: string,
    replyTo?: string
  ): Promise<DiscussionMessage>

  /**
   * Moderate a message (auto or manual).
   */
  moderateMessage(
    discussionId: string,
    messageId: string,
    action: ModerationAction
  ): Promise<void>

  /**
   * Get discussion summary.
   */
  getSummary(discussionId: string): Promise<DiscussionSummary>

  /**
   * Build consensus from discussion.
   */
  buildConsensus(discussionId: string): Promise<ConsensusResult>

  /**
   * Get participant contributions.
   */
  getParticipantStats(discussionId: string): Promise<ParticipantStats[]>

  /**
   * Conclude the discussion.
   */
  concludeDiscussion(discussionId: string): Promise<Discussion>

  /**
   * Get active discussions.
   */
  getActiveDiscussions(): Promise<Discussion[]>
}

export interface DiscussionSummary {
  discussionId: string
  messageCount: number
  participantCount: number
  sentiment: MessageSentiment
  topTopics: string[]
  keyDecisions: string[]
  unresolved: string[]
}

export interface ParticipantStats {
  participant: Participant
  messageCount: number
  avgSentiment: number
  influenceScore: number
  topContributions: string[]
}

// ── ForumHost Implementation ─────────────────────────────────────────────────

export class LLMPoweredForumHost implements ForumHost {
  private discussions: Map<string, Discussion> = new Map()

  async createDiscussion(
    topic: string,
    type: DiscussionType,
    participants: Participant[] = []
  ): Promise<Discussion> {
    const discussion: Discussion = {
      id: this.generateId(),
      topic,
      type,
      participants,
      messages: [],
      status: 'active',
      startedAt: Date.now(),
    }

    this.discussions.set(discussion.id, discussion)
    
    log.info('Discussion created', { id: discussion.id, topic, type, participants: participants.length })
    
    return discussion
  }

  async addMessage(
    discussionId: string,
    participantId: string,
    content: string,
    replyTo?: string
  ): Promise<DiscussionMessage> {
    const discussion = this.discussions.get(discussionId)
    if (!discussion) throw new Error(`Discussion ${discussionId} not found`)
    if (discussion.status !== 'active') throw new Error('Discussion is not active')

    const sentiment = await this.analyzeSentiment(content)
    const tags = await this.extractTags(content)

    const message: DiscussionMessage = {
      id: this.generateId(),
      participantId,
      content,
      timestamp: Date.now(),
      sentiment,
      replyTo,
      tags,
    }

    discussion.messages.push(message)

    // Auto-moderate if needed
    if (sentiment === 'destructive') {
      await this.autoModerate(discussion, message)
    }

    log.info('Message added', { discussionId, participantId, sentiment })
    
    return message
  }

  async moderateMessage(
    discussionId: string,
    messageId: string,
    action: ModerationAction
  ): Promise<void> {
    const discussion = this.discussions.get(discussionId)
    if (!discussion) throw new Error(`Discussion ${discussionId} not found`)

    const message = discussion.messages.find(m => m.id === messageId)
    if (!message) throw new Error(`Message ${messageId} not found`)

    message.moderation = action
    
    log.info('Message moderated', { discussionId, messageId, action: action.type })
  }

  async getSummary(discussionId: string): Promise<DiscussionSummary> {
    const discussion = this.discussions.get(discussionId)
    if (!discussion) throw new Error(`Discussion ${discussionId} not found`)

    const messages = discussion.messages
    const participants = new Set(messages.map(m => m.participantId))
    
    // Calculate average sentiment
    const sentimentScores: number[] = messages.map(m => {
      switch (m.sentiment) {
        case 'positive': return 1
        case 'constructive': return 0.5
        case 'neutral': return 0
        case 'destructive': return -1
        case 'negative': return -0.5
        default: return 0
      }
    })
    const avgSentiment = sentimentScores.reduce((a: number, b: number) => a + b, 0) / sentimentScores.length
    
    let overallSentiment: MessageSentiment = 'neutral'
    if (avgSentiment > 0.2) overallSentiment = 'positive'
    else if (avgSentiment < -0.2) overallSentiment = 'negative'

    // Extract top topics from tags
    const tagCounts = new Map<string, number>()
    for (const msg of messages) {
      for (const tag of msg.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
    const topTopics = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag)

    return {
      discussionId,
      messageCount: messages.length,
      participantCount: participants.size,
      sentiment: overallSentiment,
      topTopics,
      keyDecisions: [], // Would use LLM to extract
      unresolved: [],   // Would use LLM to identify
    }
  }

  async buildConsensus(discussionId: string): Promise<ConsensusResult> {
    const discussion = this.discussions.get(discussionId)
    if (!discussion) throw new Error(`Discussion ${discussionId} not found`)

    // In production, use LLM to synthesize consensus
    const summary = await this.getSummary(discussionId)

    const consensus: ConsensusResult = {
      agreement: this.calculateAgreement(discussion),
      summary: `Discussion on "${discussion.topic}" with ${summary.messageCount} messages from ${summary.participantCount} participants.`,
      keyPoints: summary.topTopics,
      dissenting: [],
      actionItems: [],
    }

    discussion.consensus = consensus
    
    log.info('Consensus built', { discussionId, agreement: consensus.agreement })
    
    return consensus
  }

  async getParticipantStats(discussionId: string): Promise<ParticipantStats[]> {
    const discussion = this.discussions.get(discussionId)
    if (!discussion) throw new Error(`Discussion ${discussionId} not found`)

    const stats: ParticipantStats[] = []
    
    for (const participant of discussion.participants) {
      const messages = discussion.messages.filter(m => m.participantId === participant.id)
      
      stats.push({
        participant,
        messageCount: messages.length,
        avgSentiment: this.calculateAvgSentiment(messages),
        influenceScore: this.calculateInfluence(messages, discussion.messages),
        topContributions: messages.slice(0, 3).map(m => m.content.substring(0, 100)),
      })
    }

    return stats.sort((a, b) => b.influenceScore - a.influenceScore)
  }

  async concludeDiscussion(discussionId: string): Promise<Discussion> {
    const discussion = this.discussions.get(discussionId)
    if (!discussion) throw new Error(`Discussion ${discussionId} not found`)

    await this.buildConsensus(discussionId)
    discussion.status = 'concluded'
    discussion.endedAt = Date.now()

    log.info('Discussion concluded', { discussionId })
    
    return discussion
  }

  async getActiveDiscussions(): Promise<Discussion[]> {
    return Array.from(this.discussions.values())
      .filter(d => d.status === 'active')
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private async analyzeSentiment(content: string): Promise<MessageSentiment> {
    // Simple heuristic-based sentiment analysis
    const lower = content.toLowerCase()
    
    const positiveWords = ['agree', 'good', 'great', 'excellent', 'support', 'helpful']
    const negativeWords = ['disagree', 'bad', 'wrong', 'terrible', 'oppose', 'harmful']
    const constructiveWords = ['suggest', 'improve', 'consider', 'alternative', 'proposal']
    
    const posCount = positiveWords.filter(w => lower.includes(w)).length
    const negCount = negativeWords.filter(w => lower.includes(w)).length
    const conCount = constructiveWords.filter(w => lower.includes(w)).length
    
    if (conCount > 0 && conCount >= posCount) return 'constructive'
    if (posCount > negCount) return 'positive'
    if (negCount > posCount) return 'negative'
    if (negCount > 2) return 'destructive'
    return 'neutral'
  }

  private async extractTags(content: string): Promise<string[]> {
    // Simple keyword extraction for tags
    const words = content.split(/\s+/)
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with'])
    
    const tags = words
      .filter(w => w.length > 3 && !stopWords.has(w.toLowerCase()))
      .map(w => w.toLowerCase())
      .slice(0, 5)
    
    return tags
  }

  private async autoModerate(discussion: Discussion, message: DiscussionMessage): Promise<void> {
    // Auto-moderate destructive messages
    await this.moderateMessage(discussion.id, message.id, {
      type: 'warning',
      reason: 'Message contains potentially destructive content',
      timestamp: Date.now(),
    })
  }

  private calculateAgreement(discussion: Discussion): number {
    const sentiments = discussion.messages.map(m => {
      switch (m.sentiment) {
        case 'positive': case 'constructive': return 1
        case 'neutral': return 0
        case 'negative': case 'destructive': return -1
        default: return 0
      }
    })
    
    const avg = sentiments.reduce((a: number, b: number) => a + b, 0) / sentiments.length
    return Math.round((avg + 1) * 50) // Convert -1..1 to 0..100
  }

  private calculateAvgSentiment(messages: DiscussionMessage[]): number {
    const scores: number[] = messages.map(m => {
      switch (m.sentiment) {
        case 'positive': return 1
        case 'constructive': return 0.5
        case 'neutral': return 0
        case 'destructive': return -1
        case 'negative': return -0.5
        default: return 0
      }
    })
    return scores.reduce((a: number, b: number) => a + b, 0) / scores.length
  }

  private calculateInfluence(messages: DiscussionMessage[], allMessages: DiscussionMessage[]): number {
    // Calculate influence based on replies received and sentiment
    const messageIds = new Set(messages.map(m => m.id))
    const repliesReceived = allMessages.filter(m => m.replyTo && messageIds.has(m.replyTo)).length
    const avgSentiment = this.calculateAvgSentiment(messages)
    
    return (repliesReceived * 0.3 + messages.length * 0.2 + (avgSentiment + 1) * 0.5)
  }

  private generateId(): string {
    return `disc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }
}
