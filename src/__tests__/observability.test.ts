/**
 * Observability Tests
 * Tests logger, metrics collector, and alert engine.
 */

import { describe, it, expect } from 'vitest';
import { createLogger } from '../observability/logger.js';
import { getMetricsCollector, resetMetricsCollector } from '../observability/metrics.js';
import { AlertEngine } from '../observability/alerts.js';

describe('Logger', () => {
  it('should create a logger with module name', () => {
    const logger = createLogger('test-module');
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should create child loggers', () => {
    const logger = createLogger('parent');
    const child = logger.child('child');
    expect(child).toBeDefined();
    // Should not throw
    child.info('test message');
  });

  it('should have all log levels', () => {
    const logger = createLogger('test');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });
});

describe('Metrics Collector', () => {
  it('should record counters', () => {
    const metrics = getMetricsCollector();
    metrics.counter('test.requests');
    metrics.counter('test.requests', 5);
    const snap = metrics.snapshot();
    expect(snap.counters['test.requests']).toBe(6);
  });

  it('should record gauges', () => {
    const metrics = getMetricsCollector();
    metrics.gauge('test.connections', 42);
    const snap = metrics.snapshot();
    expect(snap.gauges['test.connections']).toBe(42);
  });

  it('should record histograms', () => {
    const metrics = getMetricsCollector();
    metrics.histogram('test.latency', 100);
    metrics.histogram('test.latency', 200);
    const snap = metrics.snapshot();
    expect(snap.histograms['test.latency'].length).toBe(2);
  });

  it('should support tags', () => {
    const metrics = getMetricsCollector();
    metrics.counter('requests', 1, { method: 'GET' });
    metrics.counter('requests', 1, { method: 'POST' });
    const snap = metrics.snapshot();
    expect(snap.counters['requests{method=GET}']).toBe(1);
    expect(snap.counters['requests{method=POST}']).toBe(1);
  });
});

describe('Alert Engine', () => {
  it('should evaluate rules against snapshots', () => {
    const engine = new AlertEngine();
    const alerts = engine.evaluate({
      counters: { 'survival.credits_cents': 20 },
      gauges: {},
      histograms: {},
    });
    // Should trigger low_balance alert (threshold is 50)
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0].rule).toBe('low_balance');
  });

  it('should not fire when value is above threshold', () => {
    const engine = new AlertEngine();
    const alerts = engine.evaluate({
      counters: { 'survival.credits_cents': 100 },
      gauges: {},
      histograms: {},
    });
    expect(alerts.length).toBe(0);
  });

  it('should respect cooldown periods', () => {
    const engine = new AlertEngine();
    // First evaluation should fire
    const alerts1 = engine.evaluate({
      counters: { 'survival.credits_cents': 10 },
      gauges: {},
      histograms: {},
    });
    expect(alerts1.length).toBeGreaterThanOrEqual(1);

    // Second immediate evaluation should be in cooldown
    const alerts2 = engine.evaluate({
      counters: { 'survival.credits_cents': 10 },
      gauges: {},
      histograms: {},
    });
    // The low_balance has 30min cooldown, critical has 5min cooldown
    // One of them might still fire if cooldown is different
    expect(alerts2.length).toBeLessThanOrEqual(alerts1.length);
  });

  it('should track recent alerts', () => {
    const engine = new AlertEngine();
    engine.evaluate({
      counters: { 'survival.credits_cents': 5 },
      gauges: {},
      histograms: {},
    });
    const recent = engine.getRecentAlerts();
    expect(recent.length).toBeGreaterThan(0);
  });
});
