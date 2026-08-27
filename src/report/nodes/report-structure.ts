/**
 * report/nodes/report-structure.ts
 * 
 * THE ARCHITECT.
 * 
 * Plans the report outline (3-5 sections).
 * Analyzes the topic and creates a structured outline.
 * 
 * Core principle: STRUCTURE BEFORE CONTENT.
 * A well-planned outline leads to a coherent report.
 */

import { createLogger } from '../../observability/logger.js'
import type { GraphNode, ReportState, ReportSection, NodeResult } from '../types.js'

const log = createLogger('report:structure')

export class ReportStructureNode implements GraphNode {
  type = 'ReportStructure' as const

  async execute(state: ReportState): Promise<NodeResult> {
    log.info('Planning report structure', { topic: state.topic, maxSections: state.maxSections })

    try {
      const sections = this.planStructure(state)
      
      return {
        success: true,
        nextNode: 'FirstSearch',
        message: `Planned ${sections.length} sections for report`,
      }
    } catch (err) {
      log.error('Failed to plan structure', { error: String(err) })
      return {
        success: false,
        nextNode: 'ReportStructure',
        message: `Structure planning failed: ${err}`,
      }
    }
  }

  private planStructure(state: ReportState): ReportSection[] {
    const { topic, maxSections } = state
    
    // Generate section outlines based on topic
    const sections: ReportSection[] = []
    
    // Always include introduction
    sections.push(this.createSection('introduction', 'Introduction', `Overview of ${topic}`))
    
    // Add core sections based on topic analysis
    const coreSections = this.generateCoreSections(topic, maxSections - 2) // -2 for intro/conclusion
    sections.push(...coreSections)
    
    // Add conclusion
    sections.push(this.createSection('conclusion', 'Conclusion', `Summary and implications of ${topic}`))
    
    // Limit to maxSections
    return sections.slice(0, maxSections)
  }

  private createSection(id: string, title: string, description: string): ReportSection {
    return {
      id,
      title,
      description,
      content: '',
      searchQueries: [],
      sources: [],
      status: 'pending',
    }
  }

  private generateCoreSections(topic: string, count: number): ReportSection[] {
    // Template-based section generation
    // In production, this would use LLM to generate topic-specific sections
    const templates = [
      { id: 'background', title: 'Background', desc: `Historical context and background of ${topic}` },
      { id: 'current_state', title: 'Current State', desc: `Current developments and state of ${topic}` },
      { id: 'challenges', title: 'Challenges', desc: `Key challenges and obstacles in ${topic}` },
      { id: 'opportunities', title: 'Opportunities', desc: `Future opportunities and potential in ${topic}` },
      { id: 'technical', title: 'Technical Details', desc: `Technical aspects and implementation of ${topic}` },
      { id: 'impact', title: 'Impact', desc: `Impact and implications of ${topic}` },
      { id: 'case_studies', title: 'Case Studies', desc: `Real-world examples and case studies of ${topic}` },
      { id: 'future_outlook', title: 'Future Outlook', desc: `Predictions and future trends for ${topic}` },
    ]

    // Select top N sections based on topic relevance
    // Simple heuristic: use first N sections
    return templates.slice(0, count).map(t => ({
      ...this.createSection(t.id, t.title, t.desc),
      searchQueries: this.generateInitialQueries(topic, t.title),
    }))
  }

  private generateInitialQueries(topic: string, sectionTitle: string): string[] {
    // Generate search queries for the section
    // In production, this would use LLM for better query generation
    return [
      `${topic} ${sectionTitle.toLowerCase()} overview`,
      `${topic} ${sectionTitle.toLowerCase()} latest developments`,
    ]
  }
}
