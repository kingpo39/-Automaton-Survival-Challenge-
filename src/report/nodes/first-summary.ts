/**
 * report/nodes/first-summary.ts
 * 
 * THE SYNTHESIZER.
 * 
 * Creates initial section summary from gathered sources.
 * Distills information into concise, relevant content.
 * 
 * Core principle: SYNTHESIZE, DON'T COPY.
 * Combine multiple sources into coherent, original content.
 */

import { createLogger } from '../../observability/logger.js'
import type { GraphNode, ReportState, NodeResult, SearchSource } from '../types.js'

const log = createLogger('report:first-summary')

export class FirstSummaryNode implements GraphNode {
  type = 'FirstSummary' as const

  async execute(state: ReportState): Promise<NodeResult> {
    const section = state.sections[state.currentSectionIndex]
    
    if (!section) {
      return {
        success: false,
        nextNode: 'ReportFormatting',
        message: 'No section to summarize',
      }
    }

    if (section.sources.length === 0) {
      log.warn('No sources available for summarization', { sectionId: section.id })
      return {
        success: false,
        nextNode: 'FirstSearch',
        message: 'No sources found, need to search again',
      }
    }

    log.info('Summarizing section', { sectionId: section.id, sourceCount: section.sources.length })

    try {
      const summary = await this.createSummary(section, state)
      
      section.content = summary
      section.status = 'summarizing'

      return {
        success: true,
        nextNode: 'Reflection',
        message: `Created summary for "${section.title}" (${summary.length} chars)`,
      }
    } catch (err) {
      log.error('Summarization failed', { error: String(err), sectionId: section.id })
      return {
        success: false,
        nextNode: 'FirstSummary',
        message: `Summarization failed: ${err}`,
      }
    }
  }

  private async createSummary(
    section: { title: string; sources: SearchSource[]; description: string },
    state: ReportState,
  ): Promise<string> {
    // In production, this would use LLM to synthesize content
    // For now, create a structured summary from sources
    
    const topSources = section.sources.slice(0, 3) // Use top 3 sources
    
    const parts: string[] = []
    
    // Add section header
    parts.push(`## ${section.title}\n`)
    
    // Add description
    parts.push(`${section.description}\n`)
    
    // Synthesize source content
    parts.push('### Key Findings\n')
    
    for (const source of topSources) {
      parts.push(`- **${source.title}**: ${source.snippet}\n`)
    }
    
    // Add source references
    parts.push('\n### Sources\n')
    for (const source of topSources) {
      parts.push(`- [${source.title}](${source.url})`)
    }
    
    return parts.join('\n')
  }
}
