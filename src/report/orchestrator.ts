/**
 * report/orchestrator.ts
 * 
 * THE CONDUCTOR.
 * 
 * Orchestrates the report generation graph.
 * Manages state transitions between nodes.
 * Ensures proper execution order and error handling.
 * 
 * Core principle: FLOW CONTROL.
 * The orchestrator ensures nodes execute in the correct order.
 */

import { createLogger } from '../observability/logger.js'
import { ReportStructureNode } from './nodes/report-structure.js'
import { FirstSearchNode } from './nodes/first-search.js'
import { FirstSummaryNode } from './nodes/first-summary.js'
import { ReflectionNode } from './nodes/reflection.js'
import { ReflectionSummaryNode } from './nodes/reflection-summary.js'
import { ReportFormattingNode } from './nodes/report-formatting.js'
import type { ReportState, GraphNode, NodeType, NodeResult, SurvivalTier } from './types.js'
import { createInitialReportState } from './types.js'

const log = createLogger('report:orchestrator')

export class ReportOrchestrator {
  private nodes: Map<NodeType, GraphNode>
  private maxIterations = 100 // Safety limit

  constructor() {
    this.nodes = new Map<NodeType, GraphNode>([
      ['ReportStructure', new ReportStructureNode()],
      ['FirstSearch', new FirstSearchNode()],
      ['FirstSummary', new FirstSummaryNode()],
      ['Reflection', new ReflectionNode()],
      ['ReflectionSummary', new ReflectionSummaryNode()],
      ['ReportFormatting', new ReportFormattingNode()],
    ])
  }

  /**
   * Generate a report for the given topic.
   * This is the main entry point.
   */
  async generateReport(
    topic: string,
    options?: {
      tier?: SurvivalTier
      maxSections?: number
      maxReflections?: number
    },
  ): Promise<string> {
    const state = createInitialReportState(
      topic,
      options?.tier,
      options?.maxSections,
      options?.maxReflections,
    )

    log.info('Starting report generation', { topic, maxSections: state.maxSections })

    try {
      const result = await this.runGraph(state)
      
      if (!result.success) {
        throw new Error(result.message)
      }

      if (!state.finalReport) {
        throw new Error('Report generation completed but no final report produced')
      }

      log.info('Report generation complete', { 
        wordCount: state.finalReport.split(/\s+/).length,
        sections: state.sections.length,
        duration: Date.now() - state.metadata.startedAt,
      })

      return state.finalReport
    } catch (err) {
      log.error('Report generation failed', { error: String(err), topic })
      throw err
    }
  }

  /**
   * Run the graph until completion or error.
   */
  private async runGraph(state: ReportState): Promise<NodeResult> {
    let iterations = 0

    while (state.currentNode !== 'complete' && iterations < this.maxIterations) {
      iterations++
      
      log.debug('Executing node', { 
        node: state.currentNode, 
        iteration: iterations,
        sectionIndex: state.currentSectionIndex,
      })

      const node = this.nodes.get(state.currentNode)
      if (!node) {
        return {
          success: false,
          nextNode: 'ReportFormatting',
          message: `Unknown node: ${state.currentNode}`,
        }
      }

      const result = await node.execute(state)
      
      log.debug('Node completed', { 
        node: state.currentNode,
        success: result.success,
        nextNode: result.nextNode,
      })

      if (!result.success) {
        return result
      }

      // Update state based on result
      this.updateState(state, result)
    }

    if (iterations >= this.maxIterations) {
      return {
        success: false,
        nextNode: 'ReportFormatting',
        message: `Max iterations (${this.maxIterations}) reached`,
      }
    }

    return {
      success: true,
      nextNode: 'complete',
      message: 'Report generation complete',
    }
  }

  private updateState(state: ReportState, result: NodeResult): void {
    // Update current node
    state.currentNode = result.nextNode

    // Handle section transitions
    if (result.nextNode === 'FirstSearch' && result.success) {
      // Move to next section if we're completing a section
      if (state.currentNode === 'ReportFormatting') {
        // Don't increment, we're done with sections
      } else {
        // Check if we need to move to next section
        const currentSection = state.sections[state.currentSectionIndex]
        if (currentSection?.status === 'complete') {
          state.currentSectionIndex++
          state.currentReflectionCount = 0
        }
      }
    }

    // Mark section as complete when formatting
    if (result.nextNode === 'ReportFormatting') {
      for (const section of state.sections) {
        if (section.status !== 'complete') {
          section.status = 'complete'
        }
      }
    }

    // Update metadata
    state.metadata.totalSections = state.sections.length
  }

  /**
   * Get the current state (for debugging/monitoring).
   */
  getState(): ReportState | null {
    // In production, this would return the current state
    return null
  }
}
