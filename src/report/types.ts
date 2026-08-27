/**
 * report/types.ts
 * 
 * Core types for the report generation graph.
 * 
 * The report workflow follows a graph-based architecture:
 *   ReportStructure → FirstSearch → FirstSummary → Reflection → ReflectionSummary → ReportFormatting
 * 
 * Each node is a pure function that takes state and returns updated state.
 * No side effects, no I/O in nodes themselves.
 */

import type { SurvivalTier } from '../types.js'

// Re-export SurvivalTier for convenience
export type { SurvivalTier }

// ── Section Types ────────────────────────────────────────────────────────────

export interface ReportSection {
  id: string
  title: string
  description: string
  content: string
  searchQueries: string[]
  sources: SearchSource[]
  status: 'pending' | 'searching' | 'summarizing' | 'reflecting' | 'complete'
  reflection?: ReflectionResult
}

export interface SearchSource {
  url: string
  title: string
  snippet: string
  relevanceScore: number
}

export interface ReflectionResult {
  gaps: string[]
  followUpQuery: string
  additionalSources: SearchSource[]
  summary: string
}

// ── Graph Node Types ────────────────────────────────────────────────────────

export type NodeType = 
  | 'ReportStructure'
  | 'FirstSearch'
  | 'FirstSummary'
  | 'Reflection'
  | 'ReflectionSummary'
  | 'ReportFormatting'
  | 'complete'

export interface NodeResult {
  success: boolean
  nextNode: NodeType
  message: string
}

// ── Report State ────────────────────────────────────────────────────────────

export interface ReportState {
  // Input
  topic: string
  tier: SurvivalTier
  maxSections: number
  maxReflections: number
  
  // Structure
  sections: ReportSection[]
  currentSectionIndex: number
  currentReflectionCount: number
  
  // Output
  finalReport?: string
  metadata: ReportMetadata
  
  // Status
  currentNode: NodeType
  error?: string
}

export interface ReportMetadata {
  startedAt: number
  completedAt?: number
  totalSections: number
  totalSearches: number
  totalReflections: number
  totalSources: number
  tokenUsage: TokenUsage
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ── Node Interfaces ─────────────────────────────────────────────────────────

export interface GraphNode {
  type: string
  execute(state: ReportState): Promise<NodeResult>
}

// ── Search Types ────────────────────────────────────────────────────────────

export interface SearchQuery {
  query: string
  maxResults: number
  minRelevanceScore: number
}

export interface SearchResult {
  sources: SearchSource[]
  query: string
  totalResults: number
}

// ── Summary Types ───────────────────────────────────────────────────────────

export interface SummaryRequest {
  section: ReportSection
  sources: SearchSource[]
  existingSummary?: string
}

export interface SummaryResult {
  summary: string
  keyPoints: string[]
  tokenUsage: TokenUsage
}

// ── Formatting Types ────────────────────────────────────────────────────────

export interface FormatRequest {
  topic: string
  sections: ReportSection[]
  metadata: ReportMetadata
}

export interface FormattedReport {
  markdown: string
  wordCount: number
  sectionCount: number
}

// ── Default State ───────────────────────────────────────────────────────────

export function createInitialReportState(
  topic: string,
  tier: SurvivalTier = 'normal',
  maxSections: number = 4,
  maxReflections: number = 2,
): ReportState {
  return {
    topic,
    tier,
    maxSections,
    maxReflections,
    sections: [],
    currentSectionIndex: 0,
    currentReflectionCount: 0,
    currentNode: 'ReportStructure',
    metadata: {
      startedAt: Date.now(),
      totalSections: 0,
      totalSearches: 0,
      totalReflections: 0,
      totalSources: 0,
      tokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    },
  }
}
