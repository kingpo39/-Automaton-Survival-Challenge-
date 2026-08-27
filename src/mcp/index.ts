/**
 * src/mcp/index.ts
 *
 * Unified MCP tool registry.
 * Exposes web research, GitHub, and documentation tools to the agent.
 *
 * Architecture:
 *   Original plan: MCP servers via stdio (Playwright, GitHub, Filesystem)
 *   Reality on 8GB: Too heavy — Chromium alone uses ~500MB RAM
 *   Solution: Lightweight in-process tools with the same API surface
 *
 * Tool categories:
 *   - web_research: Fetch URLs, search DuckDuckGo, research topics
 *   - github: Search repos, read files, get commits
 *   - docs: Context7 documentation lookup
 */

export { fetchWebpage, webSearch, researchTopic, scrapeWebpage } from './web-research.js'
export type { WebResearchResult } from './web-research.js'
export { searchRepos, getFile, searchCode, getCommits, getReadme } from './github.js'
export type { GitHubRepo, GitHubFile, GitHubSearchResult } from './github.js'
export { resolveLibrary, lookupDocs } from './docs-lookup.js'
export type { DocLookupResult } from './docs-lookup.js'

import { researchTopic, webSearch, fetchWebpage } from './web-research.js'
import { searchRepos, getFile, searchCode, getCommits } from './github.js'
import { lookupDocs } from './docs-lookup.js'
import { createLogger } from '../observability/logger.js'

const log = createLogger('mcp:tools')

/**
 * Tool definitions for the agent's system prompt.
 * These are injected alongside the existing tools.
 */
export const MCP_TOOL_DEFINITIONS = [
  {
    name: 'web_search',
    description: 'Search the web for current information. Returns titles, URLs, and snippets from DuckDuckGo.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results (default 8)', default: 8 },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_webpage',
    description: 'Fetch a URL and extract readable text, links, and tables. Use for detailed page content.',
    parameters: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'research_topic',
    description: 'Deep research: search the web and fetch top results for comprehensive topic coverage.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Research topic' },
        fetchTop: { type: 'number', description: 'Number of pages to fetch (default 3)', default: 3 },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_search_repos',
    description: 'Search GitHub repositories. Returns name, description, stars, and language.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_read_file',
    description: 'Read a file from a GitHub repository.',
    parameters: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'File path in repo' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'github_search_code',
    description: 'Search code across all public GitHub repositories.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Code search query (e.g., "language:typescript react useEffect")' },
        limit: { type: 'number', description: 'Max results (default 5)', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_get_commits',
    description: 'Get recent commits for a GitHub repository.',
    parameters: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        limit: { type: 'number', description: 'Max commits (default 10)', default: 10 },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'lookup_docs',
    description: 'Look up documentation for a library or framework via Context7. Returns relevant docs for a specific topic.',
    parameters: {
      type: 'object' as const,
      properties: {
        library: { type: 'string', description: 'Library or framework name (e.g., "react", "express", "prisma")' },
        topic: { type: 'string', description: 'What to look up (e.g., "useEffect cleanup", "middleware")' },
      },
      required: ['library', 'topic'],
    },
  },
]

/**
 * Execute an MCP tool by name.
 * Returns the result as a string for the agent.
 */
export async function executeMcpTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  log.info('MCP tool call', { name, args })

  try {
    switch (name) {
      case 'web_search': {
        const results = await webSearch(
          args.query as string,
          (args.maxResults as number) || 8,
        )
        return JSON.stringify(results, null, 2)
      }

      case 'fetch_webpage': {
        const page = await fetchWebpage(args.url as string)
        return JSON.stringify({
          title: page.title,
          text: page.text.slice(0, 5000),
          links: page.links.slice(0, 20),
        }, null, 2)
      }

      case 'research_topic': {
        const result = await researchTopic(
          args.query as string,
          (args.fetchTop as number) || 3,
        )
        return JSON.stringify({
          query: result.query,
          searchResults: result.searchResults,
          fetchedContent: result.fetchedPages.map(p => ({
            title: p.title,
            url: p.url,
            text: p.text.slice(0, 3000),
          })),
        }, null, 2)
      }

      case 'github_search_repos': {
        const repos = await searchRepos(
          args.query as string,
          (args.limit as number) || 5,
        )
        return JSON.stringify(repos, null, 2)
      }

      case 'github_read_file': {
        const file = await getFile(
          args.owner as string,
          args.repo as string,
          args.path as string,
        )
        return JSON.stringify({
          path: file.path,
          content: file.content.slice(0, 10000),
          size: file.size,
        }, null, 2)
      }

      case 'github_search_code': {
        const results = await searchCode(
          args.query as string,
          (args.limit as number) || 5,
        )
        return JSON.stringify(results, null, 2)
      }

      case 'github_get_commits': {
        const commits = await getCommits(
          args.owner as string,
          args.repo as string,
          (args.limit as number) || 10,
        )
        return JSON.stringify(commits, null, 2)
      }

      case 'lookup_docs': {
        const docs = await lookupDocs(
          args.library as string,
          args.topic as string,
        )
        if (!docs) return 'Documentation not found for this library/topic.'
        return JSON.stringify({
          library: docs.library,
          topic: docs.topic,
          content: docs.content.slice(0, 8000),
          source: docs.source,
        }, null, 2)
      }

      default:
        return `Unknown MCP tool: ${name}`
    }
  } catch (e: any) {
    const msg = `MCP tool error (${name}): ${e.message}`
    log.error(msg, { error: e.message })
    return msg
  }
}
