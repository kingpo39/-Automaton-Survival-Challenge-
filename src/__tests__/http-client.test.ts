/**
 * HTTP Client Tests
 * Tests retries, backoff, and circuit breaker behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { ResilientHttpClient } from '../conway/http-client.js';

describe('Resilient HTTP Client', () => {
  it('should make successful GET request', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'hello' }),
      headers: new Headers({ 'content-type': 'application/json' }),
    }) as any;

    const client = new ResilientHttpClient('https://api.test.com');
    const result = await client.get('/test');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: 'hello' });

    globalThis.fetch = originalFetch;
  });

  it('should make POST request with body', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: 1 }),
      headers: new Headers({ 'content-type': 'application/json' }),
    }) as any;
    globalThis.fetch = mockFetch;

    const client = new ResilientHttpClient('https://api.test.com');
    await client.post('/items', { name: 'test' });

    expect(mockFetch).toHaveBeenCalled();
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe('https://api.test.com/items');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ name: 'test' });

    globalThis.fetch = originalFetch;
  });

  it('should throw on circuit breaker open', async () => {
    const client = new ResilientHttpClient('https://api.test.com');

    // Trip circuit breaker by making 5 failed requests
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection failed')) as any;

    for (let i = 0; i < 5; i++) {
      try { await client.get('/test'); } catch { /* expected */ }
    }

    // Now circuit should be open
    await expect(client.get('/test')).rejects.toThrow('Circuit breaker open');

    globalThis.fetch = originalFetch;
  });
});
