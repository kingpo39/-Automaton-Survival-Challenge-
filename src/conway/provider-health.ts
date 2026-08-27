/**
 * Conway Automaton — Provider Health Check
 * Detects which inference providers are online and measures latency.
 */

import { createLogger } from '../observability/logger.js';

const log = createLogger('conway:provider-health');

export interface ProviderStatus {
  name: string;
  baseUrl: string;
  available: boolean;
  latencyMs: number;
  models: string[];
  error?: string;
}

export interface HealthCheckResult {
  providers: ProviderStatus[];
  primaryAvailable: boolean;
  fallbackAvailable: number;
  recommendedModel: string;
}

/**
 * Check health of a provider endpoint.
 */
async function checkProvider(
  name: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs = 5000,
): Promise<ProviderStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    const response = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return {
        name,
        baseUrl,
        available: false,
        latencyMs: Date.now() - start,
        models: [],
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json() as {
      data: Array<{ id: string }>;
    };

    const models = (data.data ?? []).map(m => m.id);

    return {
      name,
      baseUrl,
      available: true,
      latencyMs: Date.now() - start,
      models,
    };
  } catch (err) {
    return {
      name,
      baseUrl,
      available: false,
      latencyMs: Date.now() - start,
      models: [],
      error: String(err).slice(0, 100),
    };
  }
}

/**
 * Check all configured providers and return health status.
 */
export async function checkAllProviders(config: {
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  omniApiKey?: string;
  omniBaseUrl?: string;
}): Promise<HealthCheckResult> {
  const checks: ProviderStatus[] = [];

  // Primary provider (LM Studio / OpenAI-compatible)
  if (config.openaiBaseUrl) {
    checks.push(await checkProvider('primary', config.openaiBaseUrl, config.openaiApiKey ?? ''));
  }

  // OmniRoute fallback
  if (config.omniBaseUrl && config.omniApiKey && config.omniBaseUrl !== config.openaiBaseUrl) {
    checks.push(await checkProvider('omni', config.omniBaseUrl, config.omniApiKey));
  }

  const primaryAvailable = checks[0]?.available ?? false;
  const fallbackAvailable = checks.filter((c, i) => i > 0 && c.available).length;

  // Recommend best free model
  const allModels = checks.flatMap(c => c.models);
  const recommendedModel = allModels.includes('auto/coding:free')
    ? 'auto/coding:free'
    : allModels.includes('auto/fast')
      ? 'auto/fast'
      : allModels[0] ?? 'unknown';

  return {
    providers: checks,
    primaryAvailable,
    fallbackAvailable,
    recommendedModel,
  };
}

/**
 * Test inference on a provider with a simple request.
 */
export async function testInference(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs = 15000,
): Promise<{ success: boolean; latencyMs: number; content?: string; error?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say exactly: HELLO' }],
        max_tokens: 10,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: `HTTP ${response.status}`,
      };
    }

    const rawText = await response.text();

    // Handle SSE
    let data;
    if (rawText.startsWith('data:')) {
      const lines = rawText.split('\n').filter(l => l.startsWith('data: '));
      const lastLine = lines[lines.length - 1];
      const jsonStr = lastLine?.replace('data: ', '');
      data = JSON.parse(jsonStr!);
    } else {
      data = JSON.parse(rawText);
    }

    const content = data.choices?.[0]?.message?.content ?? '';
    return {
      success: true,
      latencyMs: Date.now() - start,
      content: content.trim(),
    };
  } catch (err) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      error: String(err).slice(0, 100),
    };
  }
}
