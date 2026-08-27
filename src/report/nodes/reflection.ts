/**
 * report/nodes/reflection.ts
 * 
 * THE CRITIC.
 * 
 * Identifies gaps in the current summary and generates follow-up queries.
 * Ensures completeness and accuracy of information.
 * 
 * Core principle: REFLECT BEFORE ACCEPTING.
 * Always verify and improve before moving forward.
 */

import { createLogger } from '../../observability/logger.js'
import type { GraphNode, ReportState, NodeResult, ReflectionResult, SearchSource } from '../types.js'

const log = createLogger('report:reflection')

export class ReflectionNode implements GraphNode {
  type = 'Reflection' as const

  async execute(state: ReportState): Promise<NodeResult> {
    const section = state.sections[state.currentSectionIndex]
    
    if (!section) {
      return {
        success: false,
        nextNode: 'ReportFormatting',
        message: 'No section to reflect on',
      }
    }

    if (section.status !== 'summarizing') {
      return {
        success: false,
        nextNode: 'Reflection',
        message: `Section status is ${section.status}, expected 'summarizing'`,
      }
    }

    // Check reflection count
    if (state.currentReflectionCount >= state.maxReflections) {
      log.info('Max reflections reached, moving to next section', { 
        reflections: state.currentReflectionCount,
        max: state.maxReflections,
      })
      return {
        success: true,
        nextNode: 'ReportFormatting',
        message: `Max reflections (${state.maxReflections}) reached`,
      }
    }

    log.info('Reflecting on section', { sectionId: section.id, reflectionCount: state.currentReflectionCount })

    try {
      const reflection = await this.performReflection(section, state)
      
      section.reflection = reflection
      section.status = 'reflecting'
      state.currentReflectionCount++

      state.metadata.totalReflections++

      return {
        success: true,
        nextNode: 'ReflectionSummary',
        message: `Found ${reflection.gaps.length} gaps, generated follow-up query`,
      }
    } catch (err) {
      log.error('Reflection failed', { error: String(err), sectionId: section.id })
      return {
        success: false,
        nextNode: 'Reflection',
        message: `Reflection failed: ${err}`,
      }
    }
  }

  private async performReflection(
    section: { title: string; content: string; sources: SearchSource[] },
    state: ReportState,
  ): Promise<ReflectionResult> {
    // In production, this would use LLM to identify gaps
    // For now, use heuristic approach
    
    const gaps = this.identifyGaps(section, state)
    const followUpQuery = this.generateFollowUpQuery(section, gaps, state)
    
    return {
      gaps,
      followUpQuery,
      additionalSources: [],
      summary: this.generateReflectionSummary(gaps, followUpQuery),
    }
  }

  private identifyGaps(
    section: { title: string; content: string; sources: SearchSource[] },
    state: ReportState,
  ): string[] {
    const gaps: string[] = []
    
    // Check content length
    if (section.content.length < 200) {
      gaps.push('Content is too brief')
    }
    
    // Check source count
    if (section.sources.length < 2) {
      gaps.push('Insufficient sources')
    }
    
    // Check for common missing elements
    if (!section.content.includes('##')) {
      gaps.push('Missing structured sections')
    }
    
    // In production, this would use LLM to identify semantic gaps
    
    return gaps
  }

  private generateFollowUpQuery(
    section: { title: string; content: string },
    gaps: string[],
    state: ReportState,
  ): string {
    // Generate a query to address identified gaps
    const gapSummary = gaps[0] || 'additional information'
    return `${state.topic} ${section.title.toLowerCase()} ${gapSummary}`
  }

  private generateReflectionSummary(gaps: string[], followUpQuery: string): string {
    return `Identified ${gaps.length} gaps. Follow-up query: ${followUpQuery}`
  }
}
