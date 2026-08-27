/**
 * Conway Automaton — Conway Client
 * REST API client for sandbox ops, credits, domains, and models.
 * Auto-routes between sandbox (API) and local execution.
 */

import { ResilientHttpClient } from './http-client.js';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConwayClient } from '../types.js';
import { createLogger } from '../observability/logger.js';

const logger = createLogger('conway:client');

export class ConwayClientImpl implements ConwayClient {
  private http: ResilientHttpClient;
  private sandboxId: string;

  constructor(apiUrl: string, apiKey: string, sandboxId: string) {
    this.sandboxId = sandboxId;
    this.http = new ResilientHttpClient(apiUrl, {
      Authorization: `Bearer ${apiKey}`,
    });
  }

  async exec(sandboxId: string, command: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const target = sandboxId || this.sandboxId;
    if (!target) {
      return this.execLocal(command, timeoutMs);
    }
    return this.execRemote(target, command, timeoutMs);
  }

  async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
    const target = sandboxId || this.sandboxId;
    if (!target) {
      return this.writeFileLocal(path, content);
    }
    return this.writeFileRemote(target, path, content);
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const target = sandboxId || this.sandboxId;
    if (!target) {
      return this.readFileLocal(path);
    }
    return this.readFileRemote(target, path);
  }

  async exposePort(sandboxId: string, port: number): Promise<string> {
    const target = sandboxId || this.sandboxId;
    const result = await this.http.post(`/sandboxes/${target}/ports`, { port });
    return (result.body as { url: string }).url;
  }

  async removePort(sandboxId: string, port: number): Promise<void> {
    const target = sandboxId || this.sandboxId;
    await this.http.delete(`/sandboxes/${target}/ports/${port}`);
  }

  async createSandbox(name: string, config?: Record<string, unknown>): Promise<{ id: string }> {
    const result = await this.http.post('/sandboxes', { name, ...config });
    return result.body as { id: string };
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    await this.http.delete(`/sandboxes/${sandboxId}`);
  }

  async listSandboxes(): Promise<Array<{ id: string; name: string; status: string }>> {
    const result = await this.http.get('/sandboxes');
    return (result.body as { sandboxes: Array<{ id: string; name: string; status: string }> }).sandboxes ?? [];
  }

  async getCreditsBalance(): Promise<number> {
    const result = await this.http.get('/credits/balance');
    const cents = (result.body as { balanceCents?: number })?.balanceCents;
    return typeof cents === 'number' && isFinite(cents) ? cents : 0;
  }

  async getCreditsPricing(): Promise<Record<string, number>> {
    const result = await this.http.get('/credits/pricing');
    return (result.body as Record<string, number>);
  }

  async transferCredits(to: string, amountCents: number): Promise<{ txHash: string }> {
    const result = await this.http.post('/credits/transfer', { to, amountCents });
    return result.body as { txHash: string };
  }

  async searchDomains(query: string): Promise<Array<{ name: string; available: boolean; priceCents: number }>> {
    const result = await this.http.get(`/domains/search?q=${encodeURIComponent(query)}`);
    return (result.body as { domains: Array<{ name: string; available: boolean; priceCents: number }> }).domains ?? [];
  }

  async registerDomain(name: string): Promise<{ domain: string }> {
    const result = await this.http.post('/domains/register', { name });
    return result.body as { domain: string };
  }

  async listDnsRecords(domain: string): Promise<Array<{ type: string; name: string; value: string }>> {
    const result = await this.http.get(`/domains/${domain}/dns`);
    return (result.body as { records: Array<{ type: string; name: string; value: string }> }).records ?? [];
  }

  async addDnsRecord(domain: string, type: string, name: string, value: string): Promise<void> {
    await this.http.post(`/domains/${domain}/dns`, { type, name, value });
  }

  async deleteDnsRecord(domain: string, type: string, name: string, value: string): Promise<void> {
    await this.http.request({
      method: 'DELETE',
      url: `/domains/${domain}/dns`,
      body: { type, name, value },
    });
  }

  async listModels(): Promise<Array<{ model: string; provider: string; available: boolean }>> {
    const result = await this.http.get('/models');
    return (result.body as { models: Array<{ model: string; provider: string; available: boolean }> }).models ?? [];
  }

  // ── Local execution fallback ──────────────────────────────────

  private execLocal(command: string, timeoutMs: number): { stdout: string; stderr: string; exitCode: number } {
    try {
      const stdout = execSync(command, {
        timeout: timeoutMs,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
        exitCode: e.status ?? 1,
      };
    }
  }

  private writeFileLocal(path: string, content: string): void {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, content, 'utf-8');
  }

  private readFileLocal(path: string): string {
    return readFileSync(path, 'utf-8');
  }

  private async execRemote(sandboxId: string, command: string, _timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await this.http.post(`/sandboxes/${sandboxId}/exec`, { command });
    return result.body as { stdout: string; stderr: string; exitCode: number };
  }

  private async writeFileRemote(sandboxId: string, path: string, content: string): Promise<void> {
    await this.http.post(`/sandboxes/${sandboxId}/files`, { path, content });
  }

  private async readFileRemote(sandboxId: string, path: string): Promise<string> {
    const result = await this.http.get(`/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`);
    return (result.body as { content: string }).content;
  }
}
