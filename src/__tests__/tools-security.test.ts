/**
 * Tools Security Tests
 * Tests tool risk levels, tool execution, and tool definitions.
 */

import { describe, it, expect } from 'vitest';
import { getAllTools, getToolByName, executeTool } from '../agent/tools.js';
import { createMockDatabase, createMockConwayClient, createMockInferenceClient, createMockConfig, createMockState } from './mocks.js';
import type { ToolContext } from '../types.js';

function makeToolContext(): ToolContext {
  return {
    db: createMockDatabase(),
    config: createMockConfig(),
    state: createMockState(),
    conwayClient: createMockConwayClient(),
    inferenceClient: createMockInferenceClient(),
    logger: { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } },
  };
}

describe('Tool Registry', () => {
  it('should have 57 tools', () => {
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThanOrEqual(57);
  });

  it('should have tools in all 10 categories', () => {
    const tools = getAllTools();
    const categories = new Set(tools.map(t => t.category));
    expect(categories.size).toBe(10);
    expect(categories.has('vm')).toBe(true);
    expect(categories.has('conway')).toBe(true);
    expect(categories.has('self_mod')).toBe(true);
    expect(categories.has('survival')).toBe(true);
    expect(categories.has('financial')).toBe(true);
    expect(categories.has('skills')).toBe(true);
    expect(categories.has('git')).toBe(true);
    expect(categories.has('registry')).toBe(true);
    expect(categories.has('replication')).toBe(true);
    expect(categories.has('memory')).toBe(true);
  });

  it('should look up tools by name', () => {
    expect(getToolByName('exec')).toBeDefined();
    expect(getToolByName('write_file')).toBeDefined();
    expect(getToolByName('sleep')).toBeDefined();
    expect(getToolByName('nonexistent')).toBeUndefined();
  });

  it('each tool should have a risk level', () => {
    const tools = getAllTools();
    for (const tool of tools) {
      expect(['safe', 'caution', 'dangerous', 'forbidden']).toContain(tool.riskLevel);
    }
  });

  it('exec should be dangerous', () => {
    const tool = getToolByName('exec')!;
    expect(tool.riskLevel).toBe('dangerous');
  });

  it('check_credits should be safe', () => {
    const tool = getToolByName('check_credits')!;
    expect(tool.riskLevel).toBe('safe');
  });

  it('sleep should be safe', () => {
    const tool = getToolByName('sleep')!;
    expect(tool.riskLevel).toBe('safe');
  });
});

describe('Tool Execution', () => {
  it('should execute safe tools', async () => {
    const ctx = makeToolContext();
    const result = await executeTool('system_synopsis', {}, ctx);
    expect(result.success).toBe(true);
  });

  it('should return error for unknown tools', async () => {
    const ctx = makeToolContext();
    const result = await executeTool('nonexistent_tool', {}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown tool');
  });

  it('should execute check_credits', async () => {
    const ctx = makeToolContext();
    const result = await executeTool('check_credits', {}, ctx);
    expect(result.success).toBe(true);
  });

  it('should execute list_children', async () => {
    const ctx = makeToolContext();
    const result = await executeTool('list_children', {}, ctx);
    expect(result.success).toBe(true);
  });

  it('should execute remember_fact', async () => {
    const ctx = makeToolContext();
    const result = await executeTool('remember_fact', {
      category: 'test', key: 'k', value: 'v',
    }, ctx);
    expect(result.success).toBe(true);
  });
});

describe('Tool Prompt Generation', () => {
  it('should generate tool list for prompt', async () => {
    const { getToolsForPrompt } = await import('../agent/tools.js');
    const prompt = getToolsForPrompt();
    expect(prompt).toContain('exec');
    expect(prompt).toContain('sleep');
    expect(prompt).toContain('vm/');
  });
});
