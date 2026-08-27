/**
 * report/index.ts
 * 
 * Report generation module.
 * 
 * Usage:
 *   import { ReportOrchestrator } from './report'
 *   
 *   const orchestrator = new ReportOrchestrator()
 *   const report = await orchestrator.generateReport('AI Safety')
 */

export { ReportOrchestrator } from './orchestrator.js'
export * from './types.js'

// Export nodes for advanced usage
export { ReportStructureNode } from './nodes/report-structure.js'
export { FirstSearchNode } from './nodes/first-search.js'
export { FirstSummaryNode } from './nodes/first-summary.js'
export { ReflectionNode } from './nodes/reflection.js'
export { ReflectionSummaryNode } from './nodes/reflection-summary.js'
export { ReportFormattingNode } from './nodes/report-formatting.js'
