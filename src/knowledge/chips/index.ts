/**
 * knowledge/chips/index.ts
 * 
 * GLOBAL CHIP COMPETITION ANALYSIS
 * 
 * Captures and indexes all knowledge about the global semiconductor
 * competition landscape — US, China, EU, Taiwan, Korea, Japan.
 * 
 * Core principle: KNOW THE BOARD
 * Understanding chip geopolitics informs survival strategy.
 * If chips are restricted, inference costs rise.
 * If trade wars escalate, survival tiers shift.
 */

import { createLogger } from '../../observability/logger.js'
import type { AutomatonDatabase } from '../../types.js'

const log = createLogger('knowledge:chips')

// ── Types ────────────────────────────────────────────────────────────────────

export type Region = 'us' | 'china' | 'eu' | 'taiwan' | 'korea' | 'japan' | 'india' | 'global'
export type ChipCategory = 'advanced' | 'mature' | 'packaging' | 'equipment' | 'materials' | 'design'
export type CompetitionPhase = 'supply' | 'restriction' | 'subsidy' | 'tariff' | 'alliance'

export interface ChipIntelligence {
  id: string
  timestamp: number
  region: Region
  category: ChipCategory
  phase: CompetitionPhase
  
  // Content
  headline: string
  summary: string
  details: string
  sources: string[]
  
  // Impact Analysis
  impactScore: number         // 0-100, impact on AI inference
  survivalImpact: 'none' | 'low' | 'medium' | 'high' | 'critical'
  costImplication: CostImplication
  
  // Entities
  companies: string[]         // TSMC, NVIDIA, ASML, SMIC, etc.
  policies: string[]          // CHIPS Act, export controls, etc.
  technologies: string[]      // 3nm, EUV, HBM, etc.
}

export interface CostImplication {
  inferenceCostChange: number   // -50% to +200%
  availabilityRisk: number      // 0-100
  timelineRisk: string          // 'immediate' | '6months' | '1year' | '3years'
  alternativeChips: string[]    // What we can use instead
}

export interface ChipBaseline {
  region: Region
  advancedNodeNm: number        // Current process node (3, 5, 7, etc.)
  annualRevenue: number         // In billions USD
  globalMarketShare: number     // Percentage
  keyStrengths: string[]
  keyWeaknesses: string[]
  exportControlExposure: number // 0-100
}

// ── Knowledge Capture ────────────────────────────────────────────────────────

export class ChipCompetitionKnowledge {
  private intelligence: ChipIntelligence[] = []
  private baselines: Map<Region, ChipBaseline> = new Map()

  constructor(private readonly db: AutomatonDatabase) {
    this.loadBaselines()
  }

  /**
   * Ingest new chip competition intelligence.
   */
  ingest(intel: Omit<ChipIntelligence, 'id' | 'timestamp'>): ChipIntelligence {
    const entry: ChipIntelligence = {
      ...intel,
      id: this.generateId(),
      timestamp: Date.now(),
    }

    this.intelligence.push(entry)
    this.persistEntry(entry)

    // Check survival impact
    if (entry.survivalImpact === 'critical' || entry.survivalImpact === 'high') {
      this.alertSurvivalBrain(entry)
    }

    log.info('Chip intelligence ingested', {
      region: entry.region,
      category: entry.category,
      survivalImpact: entry.survivalImpact,
    })

    return entry
  }

  /**
   * Query intelligence by filters.
   */
  query(filters: {
    region?: Region
    category?: ChipCategory
    phase?: CompetitionPhase
    minImpactScore?: number
    maxAge?: number            // Max age in days
    limit?: number
  }): ChipIntelligence[] {
    let results = [...this.intelligence]

    if (filters.region) {
      results = results.filter(i => i.region === filters.region || i.region === 'global')
    }
    if (filters.category) {
      results = results.filter(i => i.category === filters.category)
    }
    if (filters.phase) {
      results = results.filter(i => i.phase === filters.phase)
    }
    if (filters.minImpactScore) {
      results = results.filter(i => i.impactScore >= filters.minImpactScore!)
    }
    if (filters.maxAge) {
      const cutoff = Date.now() - (filters.maxAge * 86400000)
      results = results.filter(i => i.timestamp > cutoff)
    }

    return results
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, filters.limit ?? 50)
  }

  /**
   * Get current competition landscape summary.
   */
  getLandscapeSummary(): ChipLandscapeSummary {
    const recent = this.query({ maxAge: 30, limit: 100 })
    
    const byRegion = new Map<Region, number>()
    const byCategory = new Map<ChipCategory, number>()
    const survivalImpacts: Record<string, number> = { none: 0, low: 0, medium: 0, high: 0, critical: 0 }

    for (const intel of recent) {
      byRegion.set(intel.region, (byRegion.get(intel.region) ?? 0) + 1)
      byCategory.set(intel.category, (byCategory.get(intel.category) ?? 0) + 1)
      survivalImpacts[intel.survivalImpact]++
    }

    return {
      totalIntelligence: recent.length,
      byRegion: Object.fromEntries(byRegion),
      byCategory: Object.fromEntries(byCategory),
      survivalImpacts,
      averageImpactScore: recent.reduce((sum, i) => sum + i.impactScore, 0) / Math.max(1, recent.length),
      baseline: this.getBaselineSummary(),
    }
  }

  /**
   * Get baseline chip capabilities by region.
   */
  getBaselineSummary(): Record<string, ChipBaseline | undefined> {
    return {
      us: this.baselines.get('us'),
      china: this.baselines.get('china'),
      eu: this.baselines.get('eu'),
      taiwan: this.baselines.get('taiwan'),
      korea: this.baselines.get('korea'),
      japan: this.baselines.get('japan'),
    }
  }

  /**
   * Get survival implications for AI inference costs.
   */
  getSurvivalImplications(): ChipSurvivalImplications {
    const critical = this.query({ minImpactScore: 70, maxAge: 7 })
    const recent = this.query({ maxAge: 30 })

    let totalCostChange = 0
    let avgAvailabilityRisk = 0

    for (const intel of critical) {
      totalCostChange += intel.costImplication.inferenceCostChange
      avgAvailabilityRisk += intel.costImplication.availabilityRisk
    }
    avgAvailabilityRisk = critical.length > 0 ? avgAvailabilityRisk / critical.length : 0

    return {
      criticalEvents: critical.length,
      estimatedCostChange: totalCostChange,
      availabilityRisk: avgAvailabilityRisk,
      timelineRisk: this.getOverallTimelineRisk(critical),
      recommendations: this.generateRecommendations(critical, recent),
    }
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private loadBaselines(): void {
    // US baseline
    this.baselines.set('us', {
      region: 'us',
      advancedNodeNm: 3,
      annualRevenue: 250,
      globalMarketShare: 12,
      keyStrengths: ['NVIDIA GPU dominance', 'AMD', 'Intel IDM', 'EDA tools (Synopsys, Cadence)'],
      keyWeaknesses: ['Manufacturing gap', 'Dependency on TSMC', 'CHIPS Act delays'],
      exportControlExposure: 80,
    })

    // China baseline
    this.baselines.set('china', {
      region: 'china',
      advancedNodeNm: 7,
      annualRevenue: 150,
      globalMarketShare: 8,
      keyStrengths: ['SMIC progress', 'Huawei HiSilicon', 'Massive subsidies', 'Domestic demand'],
      keyWeaknesses: ['EUV access blocked', 'Talent shortage', 'Software ecosystem'],
      exportControlExposure: 95,
    })

    // Taiwan baseline
    this.baselines.set('taiwan', {
      region: 'taiwan',
      advancedNodeNm: 3,
      annualRevenue: 100,
      globalMarketShare: 22,
      keyStrengths: ['TSMC leadership', 'Advanced packaging', 'Full ecosystem'],
      keyWeaknesses: ['Geopolitical risk', 'Natural disaster risk', 'Water supply'],
      exportControlExposure: 50,
    })

    // Korea baseline
    this.baselines.set('korea', {
      region: 'korea',
      advancedNodeNm: 3,
      annualRevenue: 120,
      globalMarketShare: 18,
      keyStrengths: ['Samsung Foundry', 'SK Hynix HBM', 'Memory leadership'],
      keyWeaknesses: ['Foundry yield challenges', 'Limited EUV capacity'],
      exportControlExposure: 60,
    })

    // EU baseline
    this.baselines.set('eu', {
      region: 'eu',
      advancedNodeNm: 7,
      annualRevenue: 60,
      globalMarketShare: 8,
      keyStrengths: ['ASML EUV monopoly', 'Infineon automotive', 'STMicro'],
      keyWeaknesses: ['No leading-edge fab', 'Fragmented market', 'Slow investment'],
      exportControlExposure: 40,
    })

    // Japan baseline
    this.baselines.set('japan', {
      region: 'japan',
      advancedNodeNm: 12,
      annualRevenue: 40,
      globalMarketShare: 9,
      keyStrengths: ['Rapidus ambition', 'Equipment/materials', 'TSMC fab partnership'],
      keyWeaknesses: ['Legacy nodes only', 'Small scale', 'Cost disadvantage'],
      exportControlExposure: 55,
    })
  }

  private persistEntry(entry: ChipIntelligence): void {
    try {
      const key = `knowledge:chips:${entry.id}`
      this.db.setKV(key, JSON.stringify(entry))
      this.db.setKV(`${key}:ts`, entry.timestamp.toString())
    } catch {
      // Non-critical
    }
  }

  private alertSurvivalBrain(entry: ChipIntelligence): void {
    // Capture as survival packet
    try {
      this.db.setKV('survival.chips.alert', JSON.stringify({
        headline: entry.headline,
        survivalImpact: entry.survivalImpact,
        costImplication: entry.costImplication.inferenceCostChange,
        timestamp: entry.timestamp,
      }))
    } catch {
      // Non-critical
    }
  }

  private getOverallTimelineRisk(critical: ChipIntelligence[]): string {
    for (const intel of critical) {
      if (intel.costImplication.timelineRisk === 'immediate') return 'immediate'
    }
    for (const intel of critical) {
      if (intel.costImplication.timelineRisk === '6months') return '6months'
    }
    return '1year'
  }

  private generateRecommendations(
    critical: ChipIntelligence[],
    recent: ChipIntelligence[]
  ): string[] {
    const recs: string[] = []

    if (critical.length > 3) {
      recs.push('Multiple critical chip events detected — consider increasing treasury reserve')
    }

    const costChanges = critical.map(i => i.costImplication.inferenceCostChange)
    const maxCostIncrease = Math.max(...costChanges, 0)
    if (maxCostIncrease > 50) {
      recs.push(`Potential ${maxCostIncrease}% inference cost increase — reduce model usage at critical tiers`)
    }

    const chinaEvents = recent.filter(i => i.region === 'china')
    if (chinaEvents.length > 5) {
      recs.push('Elevated China chip activity — monitor export control changes')
    }

    if (recs.length === 0) {
      recs.push('No immediate actions needed — continue monitoring')
    }

    return recs
  }

  private generateId(): string {
    return `chip_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChipLandscapeSummary {
  totalIntelligence: number
  byRegion: Record<string, number>
  byCategory: Record<string, number>
  survivalImpacts: Record<string, number>
  averageImpactScore: number
  baseline: Record<string, ChipBaseline | undefined>
}

export interface ChipSurvivalImplications {
  criticalEvents: number
  estimatedCostChange: number
  availabilityRisk: number
  timelineRisk: string
  recommendations: string[]
}
