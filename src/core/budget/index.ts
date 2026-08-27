/**
 * core/budget/index.ts
 * 
 * VALUE-PER-DOLLAR TASK PRIORITIZATION + DYNAMIC CONTEXT BUDGETING
 * 
 * Changes agent from:
 *   "Can I do this?"
 * to:
 *   "Is this worth consuming scarce resources?"
 * 
 * priority = (value × urgency × probability) / cost
 * 
 * Also manages dynamic context budgeting for LLM calls:
 *   Simple task → 1k-2k tokens
 *   Normal task → 4k-8k tokens
 *   Complex task → 12k+ tokens
 *   Critical reasoning → maximum allowed
 */

import { createLogger } from '../../observability/logger.js'

const log = createLogger('core:budget')

// ── Types ────────────────────────────────────────────────────────────────────

export interface TaskPriority {
  taskId: string
  taskName: string
  
  // Inputs
  expectedValue: number     // 0-100
  urgency: number           // 0-100
  probability: number       // 0-1
  cost: number              // In cents
  
  // Calculated
  priority: number          // Final priority score
  valuePerDollar: number    // Value per cent spent
  
  // Category
  category: 'essential' | 'useful' | 'optional'
  
  // Metadata
  estimatedLatencyMs: number
  requiredTier: string
}

export interface ContextBudget {
  taskType: 'simple' | 'normal' | 'complex' | 'critical'
  maxTokens: number
  allocatedTokens: number
  usedTokens: number
  remainingTokens: number
}

export interface EnergyBudget {
  totalBudgetCents: number
  usedBudgetCents: number
  remainingBudgetCents: number
  
  // Allocation
  essentialAllocation: number    // Percentage for essential tasks
  usefulAllocation: number       // Percentage for useful tasks
  optionalAllocation: number     // Percentage for optional tasks
  
  // Usage by category
  essentialUsed: number
  usefulUsed: number
  optionalUsed: number
}

// ── Context Budget Configurations ────────────────────────────────────────────

const CONTEXT_BUDGETS: Record<string, ContextBudget> = {
  simple: {
    taskType: 'simple',
    maxTokens: 2000,
    allocatedTokens: 1500,
    usedTokens: 0,
    remainingTokens: 1500,
  },
  normal: {
    taskType: 'normal',
    maxTokens: 8000,
    allocatedTokens: 6000,
    usedTokens: 0,
    remainingTokens: 6000,
  },
  complex: {
    taskType: 'complex',
    maxTokens: 16000,
    allocatedTokens: 12000,
    usedTokens: 0,
    remainingTokens: 12000,
  },
  critical: {
    taskType: 'critical',
    maxTokens: 32000,
    allocatedTokens: 24000,
    usedTokens: 0,
    remainingTokens: 24000,
  },
}

// ── Task Prioritizer ─────────────────────────────────────────────────────────

export class TaskPrioritizer {
  private tasks: TaskPriority[] = []
  private energyBudget: EnergyBudget
  private contextBudgets: Map<string, ContextBudget> = new Map()

  constructor(totalBudgetCents: number = 1000) {
    this.energyBudget = {
      totalBudgetCents,
      usedBudgetCents: 0,
      remainingBudgetCents: totalBudgetCents,
      essentialAllocation: 0.5,   // 50% for essential
      usefulAllocation: 0.35,     // 35% for useful
      optionalAllocation: 0.15,   // 15% for optional
      essentialUsed: 0,
      usefulUsed: 0,
      optionalUsed: 0,
    }

    // Initialize context budgets
    for (const [key, budget] of Object.entries(CONTEXT_BUDGETS)) {
      this.contextBudgets.set(key, { ...budget })
    }
  }

  /**
   * Add a task for prioritization.
   */
  addTask(task: Omit<TaskPriority, 'priority' | 'valuePerDollar' | 'category'>): TaskPriority {
    const priority = this.calculatePriority(task)
    const valuePerDollar = task.cost > 0 ? task.expectedValue / task.cost : Infinity
    const category = this.categorizeTask(priority, valuePerDollar)

    const fullTask: TaskPriority = {
      ...task,
      priority,
      valuePerDollar,
      category,
    }

    this.tasks.push(fullTask)
    return fullTask
  }

  /**
   * Get prioritized task list (sorted by priority, filtered by budget).
   */
  getPrioritizedTasks(): TaskPriority[] {
    return this.tasks
      .sort((a, b) => b.priority - a.priority)
      .filter(task => this.canAffordTask(task))
  }

  /**
   * Get next task to execute (highest priority affordable task).
   */
  getNextTask(): TaskPriority | null {
    const prioritized = this.getPrioritizedTasks()
    return prioritized[0] ?? null
  }

  /**
   * Record task execution (update budget).
   */
  recordExecution(taskId: string, actualCostCents: number): void {
    const task = this.tasks.find(t => t.taskId === taskId)
    if (!task) return

    // Update energy budget
    this.energyBudget.usedBudgetCents += actualCostCents
    this.energyBudget.remainingBudgetCents -= actualCostCents

    // Update category usage
    if (task.category === 'essential') {
      this.energyBudget.essentialUsed += actualCostCents
    } else if (task.category === 'useful') {
      this.energyBudget.usefulUsed += actualCostCents
    } else {
      this.energyBudget.optionalUsed += actualCostCents
    }

    log.debug('Task executed', { taskId, cost: actualCostCents, remaining: this.energyBudget.remainingBudgetCents })
  }

  /**
   * Get energy budget status.
   */
  getEnergyBudget(): EnergyBudget {
    return { ...this.energyBudget }
  }

  /**
   * Get context budget for a task type.
   */
  getContextBudget(taskType: string): ContextBudget {
    return this.contextBudgets.get(taskType) ?? CONTEXT_BUDGETS.normal
  }

  /**
   * Allocate tokens from context budget.
   */
  allocateTokens(taskType: string, tokens: number): boolean {
    const budget = this.contextBudgets.get(taskType)
    if (!budget) return false

    if (budget.remainingTokens < tokens) {
      return false
    }

    budget.usedTokens += tokens
    budget.remainingTokens -= tokens
    return true
  }

  /**
   * Reset context budget for a task type.
   */
  resetContextBudget(taskType: string): void {
    const budget = this.contextBudgets.get(taskType)
    if (budget) {
      budget.usedTokens = 0
      budget.remainingTokens = budget.allocatedTokens
    }
  }

  /**
   * Get budget utilization summary.
   */
  getUtilizationSummary(): {
    energy: {
      used: number
      remaining: number
      percentUsed: number
    }
    byCategory: {
      essential: { budget: number; used: number; percent: number }
      useful: { budget: number; used: number; percent: number }
      optional: { budget: number; used: number; percent: number }
    }
    context: Record<string, { allocated: number; used: number; percent: number }>
  } {
    const eb = this.energyBudget

    return {
      energy: {
        used: eb.usedBudgetCents,
        remaining: eb.remainingBudgetCents,
        percentUsed: (eb.usedBudgetCents / eb.totalBudgetCents) * 100,
      },
      byCategory: {
        essential: {
          budget: eb.totalBudgetCents * eb.essentialAllocation,
          used: eb.essentialUsed,
          percent: (eb.essentialUsed / (eb.totalBudgetCents * eb.essentialAllocation)) * 100,
        },
        useful: {
          budget: eb.totalBudgetCents * eb.usefulAllocation,
          used: eb.usefulUsed,
          percent: (eb.usefulUsed / (eb.totalBudgetCents * eb.usefulAllocation)) * 100,
        },
        optional: {
          budget: eb.totalBudgetCents * eb.optionalAllocation,
          used: eb.optionalUsed,
          percent: (eb.optionalUsed / (eb.totalBudgetCents * eb.optionalAllocation)) * 100,
        },
      },
      context: Object.fromEntries(
        Array.from(this.contextBudgets.entries()).map(([key, budget]) => [
          key,
          {
            allocated: budget.allocatedTokens,
            used: budget.usedTokens,
            percent: (budget.usedTokens / budget.allocatedTokens) * 100,
          },
        ])
      ),
    }
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private calculatePriority(task: Omit<TaskPriority, 'priority' | 'valuePerDollar' | 'category'>): number {
    // priority = (value × urgency × probability) / cost
    if (task.cost === 0) {
      // Free tasks get high priority
      return task.expectedValue * task.urgency * task.probability
    }

    return (task.expectedValue * task.urgency * task.probability) / task.cost
  }

  private categorizeTask(priority: number, valuePerDollar: number): TaskPriority['category'] {
    if (priority > 100 || valuePerDollar > 50) return 'essential'
    if (priority > 20 || valuePerDollar > 10) return 'useful'
    return 'optional'
  }

  private canAffordTask(task: TaskPriority): boolean {
    const eb = this.energyBudget

    // Check overall budget
    if (task.cost > eb.remainingBudgetCents) return false

    // Check category budget
    const categoryBudget = task.category === 'essential'
      ? eb.totalBudgetCents * eb.essentialAllocation
      : task.category === 'useful'
        ? eb.totalBudgetCents * eb.usefulAllocation
        : eb.totalBudgetCents * eb.optionalAllocation

    const categoryUsed = task.category === 'essential'
      ? eb.essentialUsed
      : task.category === 'useful'
        ? eb.usefulUsed
        : eb.optionalUsed

    if (categoryUsed + task.cost > categoryBudget) return false

    return true
  }
}
