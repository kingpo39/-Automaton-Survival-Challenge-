/**
 * opinion/index.ts
 *
 * Opinion module — public opinion analysis for opinion-aware routing.
 */

export type {
  SentimentLabel,
  OpinionSource,
  OpinionSignal,
  KeywordMatch,
  OpinionEvent,
  WeiboTrending,
  TwitterFeed,
  RedditPost,
  OpinionConfig,
  OpinionState,
} from './types.js'

export { DEFAULT_OPINION_CONFIG } from './types.js'

export { OpinionEngine } from './engine.js'
