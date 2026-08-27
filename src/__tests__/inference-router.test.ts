/**
 * Inference Router Tests
 * Tests model selection, budget tracking, and routing matrix.
 */

import { describe, it, expect } from 'vitest';
import { InferenceRouter, InferenceBudgetTracker } from '../inference/router.js';
import { detectTaskType } from '../inference/types.js';
import { createMockInferenceClient } from './mocks.js';

describe('Inference Router', () => {
  it('should route to available model', async () => {
    const client = createMockInferenceClient({ content: 'Hello' });
    const router = new InferenceRouter(client);
    const response = await router.route(
      { messages: [{ role: 'user', content: 'Hi' }], model: 'gpt-5.2' },
      'normal',
    );
    expect(response.content).toBe('Hello');
    expect(response.model).toBeDefined();
  });

  it('should fallback when primary model fails', async () => {
    const client = createMockInferenceClient({
      failWith: new Error('Model unavailable'),
    });
    const router = new InferenceRouter(client, undefined, ['gpt-4o-mini']);
    // All models will fail with this mock, should throw
    await expect(
      router.route({ messages: [{ role: 'user', content: 'Hi' }] }, 'normal'),
    ).rejects.toThrow('All models exhausted');
  });
});

describe('Inference Budget Tracker', () => {
  it('should allow affordable requests', () => {
    const tracker = new InferenceBudgetTracker();
    expect(tracker.canAfford('gpt-5.2', 0.001)).toBe(true);
  });

  it('should record costs', () => {
    const tracker = new InferenceBudgetTracker();
    tracker.recordCost('gpt-5.2', 0.01);
    // Should still be affordable after one small cost
    expect(tracker.canAfford('gpt-5.2', 0.001)).toBe(true);
  });
});

describe('Task Type Detection', () => {
  it('should detect coding tasks', () => {
    const type = detectTaskType([{ role: 'user', content: 'Please implement a function' }]);
    expect(type).toBe('coding');
  });

  it('should detect creative tasks', () => {
    const type = detectTaskType([{ role: 'user', content: 'Write me a story' }]);
    expect(type).toBe('creative');
  });

  it('should detect analysis tasks', () => {
    const type = detectTaskType([{ role: 'user', content: 'Think about this problem' }]);
    expect(type).toBe('analysis');
  });

  it('should default to general', () => {
    const type = detectTaskType([{ role: 'user', content: 'Hello world' }]);
    expect(type).toBe('general');
  });
});
