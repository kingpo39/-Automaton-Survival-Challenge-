/**
 * report/nodes/reflection-summary.ts
 * 
 * THE MERGER.
 * 
 * Merges new findings from reflection into existing section content.
 * Ensures coherent integration of additional information.
 * 
 * Core principle: MERGE, DON'T REPLACE.
 * Build upon existing content rather than starting over.
 */

import { createLogger } from '../../observability/logger.js'
import type { GraphNode, ReportState, NodeResult, SearchSource } from '../types.js'

const log = createLogger('report:reflection-summary')

export class ReflectionSummaryNode implements GraphNode {
  type = 'ReflectionSummary' as const

  async execute(state: ReportState): Promise<NodeResult> {
    const section = state.sections[state.currentSectionIndex]
    
    if (!section) {
      return {
        success: false,
        nextNode: 'ReportFormatting',
        message: 'No section to merge findings into',
      }
    }

    if (section.status !== 'reflecting' || !section.reflection) {
      return {
        success: false,
        nextNode: 'Reflection',
        message: `Section status is ${section.status}, expected 'reflecting' with reflection`,
      }
    }

    log.info('Merging reflection findings', { 
      sectionId: section.id, 
      gaps: section.reflection.gaps.length,
      followUpQuery: section.reflection.followUpQuery,
    })

    try {
      // Search for additional sources based on follow-up query
      const additionalSources = await this.searchFollowUp(
        section.reflection.followUpQuery,
        state,
      )
      
      // Merge content
      const mergedContent = await this.mergeContent(
        section.content,
        additionalSources,
        section.reflection.gaps,
        state,
      )
      
      // Update section
      section.content = mergedContent
      section.sources.push(...additionalSources)
      section.status = 'summarizing' // Ready for another reflection cycle
      section.reflection = undefined

      // Update metadata
      state.metadata.totalSearches++
      state.metadata.totalSources += additionalSources.length

      return {
        success: true,
        nextNode: 'Reflection',
        message: `Merged ${additionalSources.length} new sources, content now ${mergedContent.length} chars`,
      }
    } catch (err) {
      log.error('Merge failed', { error: String(err), sectionId: section.id })
      return {
        success: false,
        nextNode: 'Reflection',
        message: `Merge failed: ${err}`,
      }
    }
  }

  private async searchFollowUp(query: string, state: ReportState): Promise<SearchSource[]> {
    // In production, this would use the search tools
    // For now, return mock sources
    
    log.debug('Executing follow-up search', { query })
    
    // Simulate search delay
    await new Promise(resolve => setTimeout(resolve, 100))
    
    return [
      {
        url: `https://example.com/followup/${encodeURIComponent(query)}`,
        title: `Follow-up: ${query}`,
        snippet: `Additional information about: ${query}. This content addresses the gaps identified in the reflection phase.`,
        relevanceScore: 0.7 + Math.random() * 0.3,
      },
    ]
  }

  private async mergeContent(
    existingContent: string,
    newSources: SearchSource[],
    gaps: string[],
    state: ReportState,
  ): Promise<string> {
    // In production, this would use LLM to merge content
    // For now, append new findings
    
    const parts: string[] = [existingContent]
    
    // Add additional findings section
    parts.push('\n### Additional Findings\n')
    
    for (const source of newSources) {
      parts.push(`- **${source.title}**: ${source.snippet}\n`)
    }
    
    // Address gaps
    if (gaps.length > 0) {
      parts.push('\n### Addressed Gaps\n')
      for (const gap of gaps) {
        parts.push(`- Addressed: ${gap}`)
      }
    }
    
    return parts.join('\n')
  }
}
