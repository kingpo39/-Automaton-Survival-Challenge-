/**
 * engines/index.ts
 * 
 * Engine Crate Registry
 * 
 * All engines follow the trait/interface pattern:
 * - Define interface (trait)
 * - Provide implementation
 * - Register in this index
 */

// ── Insight Engine ───────────────────────────────────────────────────────────
export { LocalInsightEngine, SUPPORTED_LANGUAGES } from './insight/index.js'
export type { InsightEngine, SentimentResult, Keyword, TopicClassification, InsightResult, Entity, Language } from './insight/index.js'

// ── Media Engine ─────────────────────────────────────────────────────────────
export { MultiProviderMediaEngine } from './media/index.js'
export type { MediaEngine, SearchQuery, SearchResult, SearchResponse, WebContent, MediaType, SearchProvider } from './media/index.js'

// ── Forum Engine ─────────────────────────────────────────────────────────────
export { LLMPoweredForumHost } from './forum/index.js'
export type { ForumHost, Discussion, DiscussionMessage, DiscussionType, Participant, ConsensusResult, DiscussionSummary } from './forum/index.js'

// ── Report Engine ────────────────────────────────────────────────────────────
export { StandardReportEngine } from './report/index.js'
export type { ReportEngine, IRNode, IRDocument, OutputFormat, RenderOptions, RenderResult, ValidationResult } from './report/index.js'

// ── Spider (MindSpider) ─────────────────────────────────────────────────────
export { MindSpider } from './spider/index.js'
export type { Spider, CrawlRequest, CrawlResult, Post, Platform, TrendingTopic, PlatformStatus } from './spider/index.js'
