/**
 * report/nodes/first-search.ts
 * 
 * THE EXPLORER.
 * 
 * Selects search tool + generates queries for the current section.
 * Executes searches and collects sources.
 * 
 * Core principle: SEARCH BEFORE SUMMARIZE.
 * Gather information before attempting to synthesize.
 */

import { createLogger } from '../../observability/logger.js'
import type { GraphNode, ReportState, NodeResult, SearchSource } from '../types.js'

const log = createLogger('report:first-search')

export class FirstSearchNode implements GraphNode {
  type = 'FirstSearch' as const

  async execute(state: ReportState): Promise<NodeResult> {
    const section = state.sections[state.currentSectionIndex]
    
    if (!section) {
      return {
        success: false,
        nextNode: 'ReportFormatting',
        message: 'No section to search for',
      }
    }

    log.info('Searching for section', { sectionId: section.id, queries: section.searchQueries })

    try {
      const sources = await this.performSearch(section.searchQueries, state)
      
      // Update section with sources
      section.sources = sources
      section.status = 'searching'
      
      state.metadata.totalSearches++
      state.metadata.totalSources += sources.length

      return {
        success: true,
        nextNode: 'FirstSummary',
        message: `Found ${sources.length} sources for "${section.title}"`,
      }
    } catch (err) {
      log.error('Search failed', { error: String(err), sectionId: section.id })
      return {
        success: false,
        nextNode: 'FirstSearch',
        message: `Search failed: ${err}`,
      }
    }
  }

  private async performSearch(queries: string[], state: ReportState): Promise<SearchSource[]> {
    // In production, this would call actual search APIs
    // For now, return mock sources based on the query
    
    const allSources: SearchSource[] = []
    
    for (const query of queries) {
      const sources = await this.searchSingle(query, state)
      allSources.push(...sources)
    }
    
    // Deduplicate by URL
    const uniqueSources = this.deduplicateSources(allSources)
    
    // Sort by relevance
    return uniqueSources.sort((a, b) => b.relevanceScore - a.relevanceScore)
  }

  private async searchSingle(query: string, state: ReportState): Promise<SearchSource[]> {
    // Mock implementation - in production, call search APIs
    // This would integrate with the search tools from agent/tools
    
    log.debug('Executing search query', { query })
    
    // Simulate search delay
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Return mock results
    return [
      {
        url: `https://example.com/${encodeURIComponent(query)}`,
        title: `Search results for: ${query}`,
        snippet: `This is a mock search result for the query "${query}". In production, this would be actual search results from the search API.`,
        relevanceScore: 0.8 + Math.random() * 0.2,
      },
    ]
  }

  private deduplicateSources(sources: SearchSource[]): SearchSource[] {
    const seen = new Set<string>()
    return sources.filter(source => {
      if (seen.has(source.url)) {
        return false
      }
      seen.add(source.url)
      return true
    })
  }
}
