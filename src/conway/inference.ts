/**
 * Conway Automaton — Inference Client
 * Chat completion client with provider routing.
 */

import { ResilientHttpClient } from './http-client.js';
import type { InferenceClient, InferenceRequest, InferenceResponse, InferenceProvider } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('conway:inference');

export class InferenceClientImpl implements InferenceClient {
  private http: ResilientHttpClient;
  private defaultProvider: InferenceProvider;
  private openaiKey?: string;
  private anthropicKey?: string;

  constructor(
    conwayApiUrl: string,
    conwayApiKey: string,
    options?: { openaiApiKey?: string; anthropicApiKey?: string; defaultProvider?: InferenceProvider },
  ) {
    this.http = new ResilientHttpClient(conwayApiUrl, {
      Authorization: `Bearer ${conwayApiKey}`,
    });
    this.openaiKey = options?.openaiApiKey;
    this.anthropicKey = options?.anthropicApiKey;
    this.defaultProvider = options?.defaultProvider ?? 'conway';
  }

  async chatCompletion(request: InferenceRequest): Promise<InferenceResponse> {
    const startTime = Date.now();

    try {
      const result = await this.callViaConway(request);
      const latencyMs = Date.now() - startTime;

      return {
        ...result,
        latencyMs,
      };
    } catch (err) {
      logger.error('Inference call failed', { error: String(err), model: request.model });
      throw err;
    }
  }

  async chatCompletionStream(
    request: InferenceRequest,
    onToken: (token: string) => void,
  ): Promise<InferenceResponse> {
    // Conway API doesn't support streaming — fall back to non-streaming
    // and send the full response as a single token
    const result = await this.chatCompletion(request);
    if (result.content) onToken(result.content);
    return result;
  }

  private async callViaConway(request: InferenceRequest): Promise<Omit<InferenceResponse, 'latencyMs'>> {
    const result = await this.http.post('/inference/chat', {
      messages: request.messages,
      model: request.model,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      taskType: request.taskType,
    });

    const body = result.body as {
      content: string;
      toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      model: string;
      provider: string;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
      cost: number;
    };

    return {
      content: body.content ?? '',
      toolCalls: (body.toolCalls ?? []).map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      model: body.model ?? request.model ?? 'unknown',
      provider: (body.provider as InferenceProvider) ?? this.defaultProvider,
      usage: {
        promptTokens: body.usage?.promptTokens ?? 0,
        completionTokens: body.usage?.completionTokens ?? 0,
        totalTokens: body.usage?.totalTokens ?? 0,
      },
      cost: body.cost ?? 0,
    };
  }
}

/**
 * Local inference client that calls OpenAI/Anthropic directly.
 * Used when no Conway sandbox is available.
 */
export class LocalInferenceClient implements InferenceClient {
  private openaiKey?: string;
  private anthropicKey?: string;
  private openaiBaseUrl: string;
  private omniKey?: string;
  private omniBaseUrl?: string;
  private fallbackModel?: string;
  private fallbackProvider?: InferenceProvider;
  private fallbackBaseUrl?: string;
  private static lastRequestTime = 0;
  private static MIN_REQUEST_INTERVAL_MS = 20000;  // Pollinations: max 1 queued request per IP — 20s safe gap

  constructor(options?: {
    openaiApiKey?: string; anthropicApiKey?: string; openaiBaseUrl?: string;
    omniApiKey?: string; omniBaseUrl?: string;
    fallbackModel?: string; fallbackProvider?: InferenceProvider; fallbackBaseUrl?: string;
  }) {
    this.openaiKey = options?.openaiApiKey;
    this.anthropicKey = options?.anthropicApiKey;
    this.openaiBaseUrl = options?.openaiBaseUrl ?? 'https://api.openai.com';
    this.omniKey = options?.omniApiKey;
    this.omniBaseUrl = options?.omniBaseUrl;
    this.fallbackModel = options?.fallbackModel;
    this.fallbackProvider = options?.fallbackProvider;
    this.fallbackBaseUrl = options?.fallbackBaseUrl;
  }

  /** Ensure minimum interval between requests to avoid Pollinations queue limit */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - LocalInferenceClient.lastRequestTime;
    if (elapsed < LocalInferenceClient.MIN_REQUEST_INTERVAL_MS) {
      const waitMs = LocalInferenceClient.MIN_REQUEST_INTERVAL_MS - elapsed;
      logger.debug(`Throttling inference request`, { waitMs });
      await new Promise(r => setTimeout(r, waitMs));
    }
    LocalInferenceClient.lastRequestTime = Date.now();
  }

  async chatCompletion(request: InferenceRequest): Promise<InferenceResponse> {
    const startTime = Date.now();
    const primaryProvider = this.selectProvider(request.model);

    await this.throttle();

    // Try primary provider — ONE attempt only.
    // The agent loop has its own retry with exponential backoff.
    // Multiple retries here would violate Pollinations' 1-request-per-IP queue.
    // NO fallback here — the agent loop handles retries with backoff.
    // Firing a second request fills Pollinations' 1-slot queue and blocks both.
    if (primaryProvider === 'anthropic' && this.anthropicKey) {
      const result = await this.callAnthropic(request);
      return { ...result, latencyMs: Date.now() - startTime };
    }
    // Default: OpenAI-compatible endpoint
    const result = await this.callOpenAI(request);
    return { ...result, latencyMs: Date.now() - startTime };
  }

  /**
   * Streaming chat completion — calls onToken for each generated token.
   * Returns the full response when done.
   */
  async chatCompletionStream(
    request: InferenceRequest,
    onToken: (token: string) => void,
  ): Promise<InferenceResponse> {
    const startTime = Date.now();
    await this.throttle();

    const baseUrl = this.openaiBaseUrl.replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.openaiKey && this.openaiKey !== '' && this.openaiKey !== 'anonymous') {
      headers['Authorization'] = `Bearer ${this.openaiKey}`
    }

    const bodyStr = JSON.stringify({
      model: request.model ?? 'gpt-4o',
      stream: true,
      messages: request.messages.map(m => ({
        role: m.role === 'system' ? 'user' : m.role,
        content: m.content,
      })),
      max_tokens: request.maxTokens,
      temperature: request.temperature,
    });

    const chatPath = baseUrl.endsWith('/openai') || baseUrl.endsWith('/openai/')
      ? '/chat/completions'
      : '/v1/chat/completions';
    const fullUrl = `${baseUrl}${chatPath}`;
    const timeoutMs = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') ? 300_000 : 30_000;

    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: { ...headers, 'User-Agent': 'Automaton/0.1 (Conway-AI)' },
      body: bodyStr,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Streaming API error: ${response.status} ${errorBody.slice(0, 200)}`);
    }

    // Read SSE stream
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''
    let promptTokens = 0
    let completionTokens = 0

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const chunk = JSON.parse(data)
            const delta = chunk.choices?.[0]?.delta
            if (delta?.content) {
              fullContent += delta.content
              onToken(delta.content)
            }
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens || 0
              completionTokens = chunk.usage.completion_tokens || 0
            }
          } catch {}
        }
      }
    }

    return {
      content: fullContent,
      toolCalls: [],
      model: request.model || 'unknown',
      provider: 'openai',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      cost: 0,
      latencyMs: Date.now() - startTime,
    }
  }

  private selectProvider(model?: string): InferenceProvider {
    if (model?.startsWith('claude')) return 'anthropic';
    return 'openai';
  }

  private async callOpenAI(request: InferenceRequest, baseUrlOverride?: string): Promise<Omit<InferenceResponse, 'latencyMs'>> {
    const baseUrl = (baseUrlOverride ?? this.openaiBaseUrl).replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    // Only send auth header if we have a real key (not empty or placeholder)
    if (this.openaiKey && this.openaiKey !== '' && this.openaiKey !== 'anonymous') {
      headers['Authorization'] = `Bearer ${this.openaiKey}`
    }
    const bodyStr = JSON.stringify({
        model: request.model ?? 'gpt-4o',
        stream: false,
        messages: request.messages.map(m => ({
          // Pollinations free tier rejects 'system' role → merge into user message
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content,
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
          ...(m.name ? { name: m.name } : {}),
        })),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      });
    // Build URL: baseUrl may already include /openai path segment
    const chatPath = baseUrl.endsWith('/openai') || baseUrl.endsWith('/openai/')
      ? '/chat/completions'   // e.g. text.pollinations.ai/openai/chat/completions
      : '/v1/chat/completions'; // standard OpenAI path
    const fullUrl = `${baseUrl}${chatPath}`;
    logger.debug(`callOpenAI: model=${request.model} url=${fullUrl} bodyLen=${bodyStr.length}`);
    // 300s timeout for local Ollama (CPU inference on 1.8B model can be very slow)
    const timeoutMs = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') ? 300_000 : 30_000;
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: { ...headers, 'User-Agent': 'Automaton/0.1 (Conway-AI)' },
      body: bodyStr,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`OpenAI API error: ${response.status} ${errorBody.slice(0, 200)}`);
    }

    const rawText = await response.text();

    // Handle SSE responses (OmniRoute sometimes returns SSE even with stream:false)
    let data;
    if (rawText.startsWith('data:')) {
      const lines = rawText.split('\n').filter(l => l.startsWith('data: '));
      const lastLine = lines[lines.length - 1];
      const jsonStr = lastLine?.replace('data: ', '');
      if (!jsonStr || jsonStr === '[DONE]') {
        throw new Error('SSE stream ended without content');
      }
      data = JSON.parse(jsonStr) as {
        choices: Array<{ message: { role: string; content: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
        model: string;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
    } else {
      data = JSON.parse(rawText) as {
        choices: Array<{ message: { role: string; content: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
        model: string;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };
    }

    if (!data.choices || data.choices.length === 0) {
      throw new Error(`No choices in response: ${rawText.slice(0, 300)}`);
    }

    const choice = data.choices[0];
    let toolCalls = (choice.message.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    // Fallback: parse tool calls from content text (Ollama local models output as text)
    if (toolCalls.length === 0 && choice.message.content) {
      const contentToolCalls = parseContentToolCalls(choice.message.content);
      if (contentToolCalls.length > 0) {
        toolCalls = contentToolCalls;
        logger.debug(`Parsed ${contentToolCalls.length} tool calls from content text`);
      }
    }

    return {
      // DeepSeek-r1 outputs in 'reasoning' field, leaving content empty
      content: choice.message.content || (choice.message as any).reasoning || '',
      toolCalls,
      model: data.model,
      provider: 'openai',
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      cost: 0, // Calculated externally
    };
  }

  private async callAnthropic(request: InferenceRequest): Promise<Omit<InferenceResponse, 'latencyMs'>> {
    // Anthropic Messages API
    const systemMsg = request.messages.find(m => m.role === 'system');
    const otherMsgs = request.messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model ?? 'claude-sonnet-4-20250514',
        max_tokens: request.maxTokens ?? 4096,
        system: systemMsg?.content,
        messages: otherMsgs.map(m => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textContent = data.content.find(c => c.type === 'text');

    return {
      content: textContent?.text ?? '',
      toolCalls: [],
      model: data.model,
      provider: 'anthropic',
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      cost: 0,
    };
  }
}

/**
 * Parse tool calls from content text.
 * Ollama local models (qwen2.5-coder, etc.) output tool calls as JSON lines in content:
 *   {"name": "tool_name", "arguments": {"arg": "val"}}
 * Also handles markdown code blocks wrapping JSON.
 */
function parseContentToolCalls(content: string): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

  // Try to find JSON objects that look like tool calls
  // Match patterns: {"name": ..., "arguments": ...} or {"function": ..., "arguments": ...}
  const jsonPattern = /\{[\s]*"name"[\s]*:[\s]*"([^"]+)"[\s]*,[\s]*"arguments"[\s]*:\s*(\{[^}]*\})[\s]*\}/g;
  let match;
  let idx = 0;

  while ((match = jsonPattern.exec(content)) !== null) {
    try {
      const name = match[1];
      const args = JSON.parse(match[2]);
      toolCalls.push({
        id: `local-${idx++}`,
        name,
        arguments: args,
      });
    } catch {
      // Skip malformed JSON
    }
  }

  return toolCalls;
}
