/**
 * knowledge/ai-regulation/index.ts
 * 
 * EARLY ARTIFICIAL INTELLIGENCE REGULATION TRENDS
 * 
 * Captures and indexes global AI regulation developments.
 * EU AI Act, US Executive Order, China AI regulations, etc.
 * 
 * Core principle: REGULATION SHAPES SURVIVAL
 * AI regulations affect: model access, compute costs, compliance burden,
 * capability restrictions, and ultimately — agent survival.
 */

import { createLogger } from '../../observability/logger.js'
import type { AutomatonDatabase } from '../../types.js'

const log = createLogger('knowledge:ai-regulation')

// ── Types ────────────────────────────────────────────────────────────────────

export type RegulationRegion = 'us' | 'eu' | 'china' | 'uk' | 'japan' | 'korea' | 'global'
export type RegulationStatus = 'proposed' | 'enacted' | 'enforced' | 'amended' | 'struck_down'
export type RegulationCategory = 'safety' | 'transparency' | 'copyright' | 'labor' | 'military' | 'finance' | 'health'
export type ComplianceBurden = 'none' | 'low' | 'medium' | 'high' | 'extreme'

export interface AIRegulation {
  id: string
  timestamp: number
  region: RegulationRegion
  status: RegulationStatus
  category: RegulationCategory
  
  // Content
  name: string
  summary: string
  keyProvisions: string[]
  enforcementDate?: string
  
  // Impact Analysis
  complianceBurden: ComplianceBurden
  survivalImpact: 'none' | 'low' | 'medium' | 'high' | 'critical'
  capabilityRestrictions: CapabilityRestriction[]
  costImplications: RegulationCost
  
  // Metadata
  officialSource: string
  lastUpdated: number
}

export interface CapabilityRestriction {
  capability: string        // 'inference', 'tool_use', 'memory', 'self_modification'
  restriction: string      // What's restricted
  severity: 'none' | 'minimal' | 'moderate' | 'severe' | 'prohibitive'
  workaround?: string      // Possible workaround if any
}

export interface RegulationCost {
  complianceCostCents: number    // Additional cost per inference
  auditRequired: boolean
  reportingRequired: boolean
  certificationRequired: boolean
  legalExposure: number          // 0-100
}

export interface RegulationTimeline {
  year: number
  quarter: number
  events: RegulationEvent[]
}

export interface RegulationEvent {
  date: string
  region: RegulationRegion
  event: string
  impact: 'low' | 'medium' | 'high'
}

// ── Knowledge Capture ────────────────────────────────────────────────────────

export class AIRegulationKnowledge {
  private regulations: AIRegulation[] = []
  private timeline: RegulationTimeline[] = []

  constructor(private readonly db: AutomatonDatabase) {
    this.loadBaselineRegulations()
  }

  /**
   * Ingest new regulation intelligence.
   */
  ingest(reg: Omit<AIRegulation, 'id' | 'timestamp' | 'lastUpdated'>): AIRegulation {
    const entry: AIRegulation = {
      ...reg,
      id: this.generateId(),
      timestamp: Date.now(),
      lastUpdated: Date.now(),
    }

    this.regulations.push(entry)
    this.persistEntry(entry)

    // Check survival impact
    if (entry.survivalImpact === 'critical' || entry.survivalImpact === 'high') {
      this.alertSurvivalBrain(entry)
    }

    log.info('AI regulation ingested', {
      region: entry.region,
      name: entry.name,
      status: entry.status,
      survivalImpact: entry.survivalImpact,
    })

    return entry
  }

  /**
   * Update existing regulation.
   */
  update(regulationId: string, updates: Partial<AIRegulation>): AIRegulation | null {
    const idx = this.regulations.findIndex(r => r.id === regulationId)
    if (idx === -1) return null

    this.regulations[idx] = {
      ...this.regulations[idx],
      ...updates,
      lastUpdated: Date.now(),
    }

    this.persistEntry(this.regulations[idx])
    return this.regulations[idx]
  }

  /**
   * Query regulations by filters.
   */
  query(filters: {
    region?: RegulationRegion
    status?: RegulationStatus
    category?: RegulationCategory
    minSurvivalImpact?: string
    maxAge?: number
    limit?: number
  }): AIRegulation[] {
    let results = [...this.regulations]

    if (filters.region) {
      results = results.filter(r => r.region === filters.region || r.region === 'global')
    }
    if (filters.status) {
      results = results.filter(r => r.status === filters.status)
    }
    if (filters.category) {
      results = results.filter(r => r.category === filters.category)
    }
    if (filters.minSurvivalImpact) {
      const levels = ['none', 'low', 'medium', 'high', 'critical']
      const minIdx = levels.indexOf(filters.minSurvivalImpact)
      results = results.filter(r => levels.indexOf(r.survivalImpact) >= minIdx)
    }
    if (filters.maxAge) {
      const cutoff = Date.now() - (filters.maxAge * 86400000)
      results = results.filter(r => r.timestamp > cutoff)
    }

    return results
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, filters.limit ?? 50)
  }

  /**
   * Get global regulation landscape summary.
   */
  getLandscapeSummary(): RegulationLandscapeSummary {
    const recent = this.query({ maxAge: 90 })
    
    const byRegion = new Map<string, number>()
    const byStatus = new Map<string, number>()
    const byCategory = new Map<string, number>()
    const survivalImpacts: Record<string, number> = { none: 0, low: 0, medium: 0, high: 0, critical: 0 }

    for (const reg of recent) {
      byRegion.set(reg.region, (byRegion.get(reg.region) ?? 0) + 1)
      byStatus.set(reg.status, (byStatus.get(reg.status) ?? 0) + 1)
      byCategory.set(reg.category, (byCategory.get(reg.category) ?? 0) + 1)
      survivalImpacts[reg.survivalImpact]++
    }

    return {
      totalRegulations: recent.length,
      byRegion: Object.fromEntries(byRegion),
      byStatus: Object.fromEntries(byStatus),
      byCategory: Object.fromEntries(byCategory),
      survivalImpacts,
      upcomingDeadlines: this.getUpcomingDeadlines(),
    }
  }

  /**
   * Get upcoming compliance deadlines.
   */
  getUpcomingDeadlines(): RegulationDeadline[] {
    const now = Date.now()
    const oneYear = 365 * 86400000

    return this.regulations
      .filter(r => r.enforcementDate)
      .map(r => ({
        regulationId: r.id,
        name: r.name,
        region: r.region,
        enforcementDate: r.enforcementDate!,
        daysUntilEnforcement: Math.max(0, Math.ceil((new Date(r.enforcementDate!).getTime() - now) / 86400000)),
        complianceBurden: r.complianceBurden,
        survivalImpact: r.survivalImpact,
      }))
      .filter(d => d.daysUntilEnforcement <= 365)
      .sort((a, b) => a.daysUntilEnforcement - b.daysUntilEnforcement)
  }

  /**
   * Get survival implications for agent operations.
   */
  getSurvivalImplications(): RegulationSurvivalImplications {
    const enforced = this.query({ status: 'enforced' })
    const upcoming = this.query({ status: 'enacted' })

    let totalComplianceCost = 0
    let maxLegalExposure = 0
    const restrictions: CapabilityRestriction[] = []
    const recommendations: string[] = []

    for (const reg of enforced) {
      totalComplianceCost += reg.costImplications.complianceCostCents
      maxLegalExposure = Math.max(maxLegalExposure, reg.costImplications.legalExposure)
      restrictions.push(...reg.capabilityRestrictions)
    }

    // Generate recommendations
    if (maxLegalExposure > 70) {
      recommendations.push('HIGH LEGAL EXPOSURE — Consider compliance measures')
    }
    if (totalComplianceCost > 10) {
      recommendations.push(`Compliance costs: ${totalComplianceCost}¢/inference — factor into tier thresholds`)
    }

    const prohibitiveRestrictions = restrictions.filter(r => r.severity === 'prohibitive')
    if (prohibitiveRestrictions.length > 0) {
      recommendations.push(`${prohibitiveRestrictions.length} PROHIBITIVE restrictions detected — capabilities may be blocked`)
    }

    return {
      enforcedRegulations: enforced.length,
      upcomingRegulations: upcoming.length,
      totalComplianceCost,
      maxLegalExposure,
      criticalRestrictions: prohibitiveRestrictions,
      recommendations,
    }
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private loadBaselineRegulations(): void {
    // EU AI Act
    this.regulations.push({
      id: 'eu-ai-act-2024',
      timestamp: Date.now(),
      region: 'eu',
      status: 'enacted',
      category: 'safety',
      name: 'EU AI Act',
      summary: 'First comprehensive AI regulation. Risk-based approach with prohibitions on certain AI systems.',
      keyProvisions: [
        'Prohibits social scoring, real-time biometric surveillance',
        'High-risk AI requires conformity assessment',
        'Transparency obligations for all AI systems',
        'General-purpose AI rules with systemic risk provisions',
        'Heavy fines for non-compliance (up to 7% global revenue)',
      ],
      enforcementDate: '2026-08-01',
      complianceBurden: 'high',
      survivalImpact: 'high',
      capabilityRestrictions: [
        {
          capability: 'inference',
          restriction: 'High-risk AI requires pre-market conformity assessment',
          severity: 'moderate',
          workaround: 'Classify as limited-risk and add transparency measures',
        },
        {
          capability: 'self_modification',
          restriction: 'Self-evolving AI systems must be supervised',
          severity: 'severe',
          workaround: 'Maintain human oversight logs',
        },
      ],
      costImplications: {
        complianceCostCents: 5,
        auditRequired: true,
        reportingRequired: true,
        certificationRequired: true,
        legalExposure: 80,
      },
      officialSource: 'https://eur-lex.europa.eu/eli/reg/2024/1689',
      lastUpdated: Date.now(),
    })

    // US Executive Order on AI Safety
    this.regulations.push({
      id: 'us-eo-ai-safety-2023',
      timestamp: Date.now(),
      region: 'us',
      status: 'enforced',
      category: 'safety',
      name: 'Executive Order on AI Safety',
      summary: 'Establishes AI safety and security standards, requires reporting for large compute training runs.',
      keyProvisions: [
        'Reporting requirements for training runs > 10^26 FLOPs',
        'NIST AI safety standards development',
        'Red-teaming requirements for frontier models',
        'Watermarking requirements for AI-generated content',
      ],
      complianceBurden: 'medium',
      survivalImpact: 'medium',
      capabilityRestrictions: [
        {
          capability: 'inference',
          restriction: 'Must report if compute exceeds threshold',
          severity: 'minimal',
          workaround: 'Monitor compute usage and file reports',
        },
      ],
      costImplications: {
        complianceCostCents: 1,
        auditRequired: false,
        reportingRequired: true,
        certificationRequired: false,
        legalExposure: 40,
      },
      officialSource: 'https://www.whitehouse.gov/briefing-room/presidential-actions/2023/10/30/',
      lastUpdated: Date.now(),
    })

    // China AI Regulations
    this.regulations.push({
      id: 'china-ai-management-2023',
      timestamp: Date.now(),
      region: 'china',
      status: 'enforced',
      category: 'safety',
      name: 'Interim Measures for Generative AI',
      summary: 'Regulates generative AI services in China with content and security requirements.',
      keyProvisions: [
        'Security assessments before public release',
        'Content alignment with socialist values',
        'Real-name verification for users',
        'Data protection requirements',
      ],
      complianceBurden: 'high',
      survivalImpact: 'medium',
      capabilityRestrictions: [
        {
          capability: 'inference',
          restriction: 'Must pass security assessment',
          severity: 'moderate',
          workaround: 'N/A for non-China operations',
        },
        {
          capability: 'tool_use',
          restriction: 'Tool capabilities may be restricted',
          severity: 'moderate',
          workaround: 'N/A for non-China operations',
        },
      ],
      costImplications: {
        complianceCostCents: 3,
        auditRequired: true,
        reportingRequired: true,
        certificationRequired: true,
        legalExposure: 60,
      },
      officialSource: 'http://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm',
      lastUpdated: Date.now(),
    })

    log.info('Baseline regulations loaded', { count: this.regulations.length })
  }

  private persistEntry(entry: AIRegulation): void {
    try {
      const key = `knowledge:ai-reg:${entry.id}`
      this.db.setKV(key, JSON.stringify(entry))
      this.db.setKV(`${key}:ts`, entry.timestamp.toString())
    } catch {
      // Non-critical
    }
  }

  private alertSurvivalBrain(entry: AIRegulation): void {
    try {
      this.db.setKV('survival.ai-reg.alert', JSON.stringify({
        name: entry.name,
        region: entry.region,
        survivalImpact: entry.survivalImpact,
        complianceBurden: entry.complianceBurden,
        timestamp: entry.timestamp,
      }))
    } catch {
      // Non-critical
    }
  }

  private generateId(): string {
    return `reg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RegulationLandscapeSummary {
  totalRegulations: number
  byRegion: Record<string, number>
  byStatus: Record<string, number>
  byCategory: Record<string, number>
  survivalImpacts: Record<string, number>
  upcomingDeadlines: RegulationDeadline[]
}

export interface RegulationDeadline {
  regulationId: string
  name: string
  region: RegulationRegion
  enforcementDate: string
  daysUntilEnforcement: number
  complianceBurden: ComplianceBurden
  survivalImpact: string
}

export interface RegulationSurvivalImplications {
  enforcedRegulations: number
  upcomingRegulations: number
  totalComplianceCost: number
  maxLegalExposure: number
  criticalRestrictions: CapabilityRestriction[]
  recommendations: string[]
}
