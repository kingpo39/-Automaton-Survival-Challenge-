/**
 * Conway Automaton — Metrics Collector
 * Counters (monotonic), gauges (point-in-time), histograms (percentile buckets).
 */

import type { MetricsCollector, MetricSnapshot } from '../types.js';
import { createLogger } from './logger.js';

const logger = createLogger('metrics');

class MetricsCollectorImpl implements MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  counter(name: string, value = 1, tags?: Record<string, string>): void {
    const key = this.keyWithTags(name, tags);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.keyWithTags(name, tags);
    this.gauges.set(key, value);
  }

  histogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.keyWithTags(name, tags);
    const values = this.histograms.get(key) ?? [];
    values.push(value);
    // Keep last 1000 values to prevent unbounded growth
    if (values.length > 1000) {
      values.splice(0, values.length - 1000);
    }
    this.histograms.set(key, values);
  }

  snapshot(): MetricSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([k, v]) => [k, [...v]])
      ),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  private keyWithTags(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) return name;
    const sortedTags = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${name}{${sortedTags}}`;
  }
}

let singleton: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!singleton) {
    singleton = new MetricsCollectorImpl();
  }
  return singleton;
}

// For testing
export function resetMetricsCollector(): void {
  singleton = null;
}
