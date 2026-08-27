/**
 * knowledge/index.ts
 * 
 * Knowledge Module — Captures Intelligence for Survival
 * 
 * All knowledge feeds into the survival brain:
 * - Chip competition → inference cost & availability
 * - AI regulations → compliance burden & capability restrictions
 * - Market trends → funding opportunities & threats
 * - Geopolitics → risk assessment & tier adjustments
 */

export { ChipCompetitionKnowledge } from './chips/index.js'
export type { 
  ChipIntelligence, ChipCategory, CompetitionPhase, ChipBaseline, 
  ChipLandscapeSummary, ChipSurvivalImplications, CostImplication 
} from './chips/index.js'

export { AIRegulationKnowledge } from './ai-regulation/index.js'
export type { 
  AIRegulation, RegulationStatus, RegulationCategory, ComplianceBurden,
  CapabilityRestriction, RegulationCost, RegulationLandscapeSummary, 
  RegulationSurvivalImplications, RegulationDeadline
} from './ai-regulation/index.js'
