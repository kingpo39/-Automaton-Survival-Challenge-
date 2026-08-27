/**
 * Conway Automaton — Resilient HTTP Client
 * Retry with jittered backoff, circuit breaker (5 failures → 60s open),
 * idempotency key support, and SOCKS5/HTTP proxy support.
 *
 * Proxy resolution order:
 *   1. Constructor proxyUrl option
 *   2. ALL_PROXY env var
 *   3. HTTP_PROXY / HTTPS_PROXY env var (per protocol)
 *   4. Direct connection
 */

import { createLogger } from '../observability/logger.js';
import { resolveProxyFromEnv, createSocks5HttpsAgent, type ProxyConfig } from './proxy.js';
import type { Agent as HttpsAgent } from 'node:https';

const logger = createLogger('conway:http');

export interface HttpOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  idempotencyKey?: string;
}

export interface HttpResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_OPEN_MS = 60_000;
const BASE_DELAY_MS = 500;

export class ResilientHttpClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private circuit: CircuitState = { failures: 0, lastFailure: 0, open: false };
  private proxy: ProxyConfig | null;
  private socksAgent: HttpsAgent | null = null;

  constructor(baseUrl: string, headers: Record<string, string> = {}, options?: { proxyUrl?: string }) {
    this.baseUrl = baseUrl;
    this.headers = headers;

    // Resolve proxy: explicit option > env vars > direct
    const proxyUrl = options?.proxyUrl ?? resolveProxyFromEnv()?.url ?? null;
    this.proxy = proxyUrl ? resolveProxyFromEnv() : null;
    // If explicit proxyUrl provided, parse it
    if (options?.proxyUrl && !this.proxy) {
      try {
        const url = new URL(options.proxyUrl);
        this.proxy = {
          url: options.proxyUrl,
          type: url.protocol.startsWith('socks') ? 'socks5' : 'http',
          host: url.hostname,
          port: parseInt(url.port, 10) || (url.protocol.startsWith('socks') ? 1080 : 8080),
          username: url.username || undefined,
          password: url.password || undefined,
        };
      } catch { /* invalid URL, no proxy */ }
    }

    if (this.proxy?.type === 'socks5') {
      // Lazy agent creation — only when first request is made
      logger.info('SOCKS5 proxy configured', { proxy: this.proxy.url.replace(/:.+@/, ':***@') });
    } else if (this.proxy?.type === 'http') {
      logger.info('HTTP proxy configured', { proxy: this.proxy.url.replace(/:.+@/, ':***@') });
    }
  }

  /**
   * Get proxy status for diagnostics.
   */
  getProxyStatus(): { active: boolean; type: string; url: string } {
    if (this.proxy) {
      const type = this.proxy.type === 'socks5' ? 'SOCKS5' : 'HTTP';
      return { active: true, type, url: this.proxy.url };
    }
    return { active: false, type: 'direct', url: '' };
  }

  async request(options: HttpOptions): Promise<HttpResult> {
    // Check circuit breaker
    if (this.circuit.open) {
      const elapsed = Date.now() - this.circuit.lastFailure;
      if (elapsed < CIRCUIT_BREAKER_OPEN_MS) {
        throw new Error(`Circuit breaker open for ${Math.ceil((CIRCUIT_BREAKER_OPEN_MS - elapsed) / 1000)}s more`);
      }
      // Half-open: allow one request
      this.circuit.open = false;
    }

    const url = options.url.startsWith('http') ? options.url : `${this.baseUrl}${options.url}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
      ...options.headers,
    };

    if (options.idempotencyKey) {
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );

        // Build fetch options with proxy support
        const fetchOpts: RequestInit = {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        };

        // For SOCKS5, use http/https.request instead of fetch
        if (this.socksAgent) {
          const response = await this.proxyFetch(url, options.method, headers, options.body, controller.signal);
          clearTimeout(timeout);
          return response;
        }

        const response = await fetch(url, fetchOpts);

        clearTimeout(timeout);

        // Retry on 429 and 5xx
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : this.backoffDelay(attempt);

          logger.warn('Retrying request', {
            url,
            status: response.status,
            attempt,
            delayMs: delay,
          });

          if (attempt < DEFAULT_MAX_RETRIES) {
            await sleep(delay);
            continue;
          }
        }

        let body: unknown;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          body = await response.json();
        } else {
          body = await response.text();
        }

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });

        // Success — reset circuit breaker
        this.circuit.failures = 0;

        return { status: response.status, body, headers: responseHeaders };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < DEFAULT_MAX_RETRIES) {
          const delay = this.backoffDelay(attempt);
          logger.warn('Request error, retrying', { url, error: lastError.message, attempt, delayMs: delay });
          await sleep(delay);
        }
      }
    }

    // All retries exhausted — trip circuit breaker
    this.circuit.failures++;
    this.circuit.lastFailure = Date.now();
    if (this.circuit.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuit.open = true;
      logger.error('Circuit breaker tripped', { failures: this.circuit.failures });
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  async get(url: string, headers?: Record<string, string>): Promise<HttpResult> {
    return this.request({ method: 'GET', url, headers });
  }

  async post(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResult> {
    return this.request({ method: 'POST', url, body, headers });
  }

  async put(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResult> {
    return this.request({ method: 'PUT', url, body, headers });
  }

  async delete(url: string, headers?: Record<string, string>): Promise<HttpResult> {
    return this.request({ method: 'DELETE', url, headers });
  }

  /**
   * Fetch through SOCKS5 proxy using Node.js https module.
   */
  private proxyFetch(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<HttpResult> {
    // Lazy agent creation
    if (!this.socksAgent && this.proxy) {
      this.socksAgent = createSocks5HttpsAgent(this.proxy.host, this.proxy.port, {
        username: this.proxy.username,
        password: this.proxy.password,
      }) as unknown as HttpsAgent;
    }

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options: import('node:https').RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
        agent: this.socksAgent!,
      };

      const req = (urlObj.protocol === 'https:' ? require('node:https') : require('node:http')).request(
        options,
        (res: import('node:http').IncomingMessage) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', async () => {
            let parsedBody: unknown;
            try {
              parsedBody = JSON.parse(data);
            } catch {
              parsedBody = data;
            }
            const responseHeaders: Record<string, string> = {};
            if (res.headers) {
              for (const [k, v] of Object.entries(res.headers)) {
                if (v) responseHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
              }
            }
            resolve({ status: res.statusCode ?? 200, body: parsedBody, headers: responseHeaders });
          });
        },
      );

      req.on('error', reject);

      if (signal) {
        signal.addEventListener('abort', () => req.destroy(), { once: true });
      }

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  private backoffDelay(attempt: number): number {
    const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = exponential * 0.5 * Math.random();
    return Math.floor(exponential + jitter);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
