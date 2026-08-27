/**
 * Conway Automaton — Alert Engine
 * Evaluates alert rules against metric snapshots. Cooldowns prevent spam.
 */

import type { Alert, AlertRule, MetricSnapshot } from '../types.js';
import { createLogger } from './logger.js';

const logger = createLogger('alerts');

const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    name: 'low_balance',
    metric: 'survival.credits_cents',
    condition: 'below',
    threshold: 50, // $0.50
    severity: 'warning',
    cooldownMs: 30 * 60 * 1000, // 30 min
    wakeOnCritical: false,
  },
  {
    name: 'critical_balance',
    metric: 'survival.credits_cents',
    condition: 'below',
    threshold: 0,
    severity: 'critical',
    cooldownMs: 5 * 60 * 1000, // 5 min
    wakeOnCritical: true,
  },
  {
    name: 'high_error_rate',
    metric: 'agent.error_rate',
    condition: 'above',
    threshold: 0.2, // 20%
    severity: 'warning',
    cooldownMs: 60 * 60 * 1000, // 1 hour
    wakeOnCritical: false,
  },
  {
    name: 'high_deny_rate',
    metric: 'policy.deny_rate',
    condition: 'above',
    threshold: 0.5, // 50%
    severity: 'warning',
    cooldownMs: 60 * 60 * 1000,
    wakeOnCritical: false,
  },
  {
    name: 'budget_exhausted',
    metric: 'inference.hourly_spend_cents',
    condition: 'above',
    threshold: 200, // $2
    severity: 'warning',
    cooldownMs: 30 * 60 * 1000,
    wakeOnCritical: false,
  },
  {
    name: 'excessive_turns',
    metric: 'agent.turns_this_hour',
    condition: 'above',
    threshold: 100,
    severity: 'warning',
    cooldownMs: 60 * 60 * 1000,
    wakeOnCritical: false,
  },
];

export class AlertEngine {
  private rules: AlertRule[];
  private lastFired: Map<string, number> = new Map();
  private recentAlerts: Alert[] = [];

  constructor(rules?: AlertRule[]) {
    this.rules = rules ?? DEFAULT_ALERT_RULES;
  }

  evaluate(snapshot: MetricSnapshot): Alert[] {
    const now = Date.now();
    const newAlerts: Alert[] = [];

    for (const rule of this.rules) {
      const lastFired = this.lastFired.get(rule.name) ?? 0;
      if (now - lastFired < rule.cooldownMs) continue;

      const value = snapshot.counters[rule.metric] ?? snapshot.gauges[rule.metric];
      if (value === undefined) continue;

      const triggered = this.checkCondition(value, rule.condition, rule.threshold);
      if (!triggered) continue;

      const alert: Alert = {
        rule: rule.name,
        severity: rule.severity,
        message: `Alert "${rule.name}": ${rule.metric} = ${value} (${rule.condition} ${rule.threshold})`,
        timestamp: now,
        metricValue: value,
      };

      newAlerts.push(alert);
      this.lastFired.set(rule.name, now);

      if (rule.wakeOnCritical && rule.severity === 'critical') {
        logger.warn('Critical alert requires wake', { rule: rule.name, message: alert.message });
      }
    }

    this.recentAlerts.push(...newAlerts);
    // Keep last 100 alerts
    if (this.recentAlerts.length > 100) {
      this.recentAlerts = this.recentAlerts.slice(-100);
    }

    return newAlerts;
  }

  getRecentAlerts(limit = 20): Alert[] {
    return this.recentAlerts.slice(-limit);
  }

  private checkCondition(value: number, condition: string, threshold: number): boolean {
    switch (condition) {
      case 'above': return value > threshold;
      case 'below': return value < threshold;
      case 'equals': return value === threshold;
      default: return false;
    }
  }
}
