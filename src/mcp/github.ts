/**
 * src/mcp/github.ts
 *
 * GitHub integration via REST API.
 * Uses GitHub Free tier — no token needed for public repos.
 * Optional GITHUB_TOKEN for private repos and higher rate limits.
 *
 * Capabilities:
 *   - List/search repositories
 *   - Read file contents
 *   - Get repository info (stars, description, language)
 *   - Search code across GitHub
 *   - Get commit history
 */

import { createLogger } from '../observability/logger.js'

const log = createLogger('mcp:github')

const GITHUB_API = 'https://api.github.com'
const TOKEN = process.env.GITHUB_TOKEN || ''

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'automaton-mcp/1.0',
  }
  if (TOKEN) h['Authorization'] = `token ${TOKEN}`
  return h
}

export interface GitHubRepo {
  name: string
  fullName: string
  description: string
  stars: number
  language: string
  url: string
  updatedAt: string
}

export interface GitHubFile {
  path: string
  content: string
  size: number
  sha: string
}

export interface GitHubSearchResult {
  name: string
  path: string
  repository: string
  url: string
}

/**
 * Search for repositories.
 */
export async function searchRepos(
  query: string,
  limit = 5,
): Promise<GitHubRepo[]> {
  log.info('Searching repos', { query })

  const resp = await fetch(
    `${GITHUB_API}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${limit}`,
    { headers: headers() },
  )

  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${await resp.text()}`)
  const data = await resp.json() as any

  return (data.items || []).map((r: any) => ({
    name: r.name,
    fullName: r.full_name,
    description: r.description || '',
    stars: r.stargazers_count,
    language: r.language || '',
    url: r.html_url,
    updatedAt: r.updated_at,
  }))
}

/**
 * Get file contents from a repository.
 */
export async function getFile(
  owner: string,
  repo: string,
  path: string,
  branch = 'main',
): Promise<GitHubFile> {
  log.info('Fetching file', { owner, repo, path })

  const resp = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers: headers() },
  )

  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${await resp.text()}`)
  const data = await resp.json() as any

  const content = data.encoding === 'base64'
    ? Buffer.from(data.content, 'base64').toString('utf-8')
    : data.content || ''

  return {
    path: data.path,
    content: content.slice(0, 50_000),  // cap at 50KB
    size: data.size,
    sha: data.sha,
  }
}

/**
 * Search code across GitHub.
 */
export async function searchCode(
  query: string,
  limit = 5,
): Promise<GitHubSearchResult[]> {
  log.info('Searching code', { query })

  const resp = await fetch(
    `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`,
    { headers: headers() },
  )

  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${await resp.text()}`)
  const data = await resp.json() as any

  return (data.items || []).map((item: any) => ({
    name: item.name,
    path: item.path,
    repository: item.repository.full_name,
    url: item.html_url,
  }))
}

/**
 * Get recent commits for a repository.
 */
export async function getCommits(
  owner: string,
  repo: string,
  limit = 10,
): Promise<Array<{ sha: string; message: string; author: string; date: string }>> {
  log.info('Fetching commits', { owner, repo })

  const resp = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=${limit}`,
    { headers: headers() },
  )

  if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${await resp.text()}`)
  const data = await resp.json() as any

  return (data || []).map((c: any) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0].slice(0, 200),
    author: c.commit.author?.name || 'unknown',
    date: c.commit.author?.date || '',
  }))
}

/**
 * Get repository readme.
 */
export async function getReadme(
  owner: string,
  repo: string,
): Promise<string> {
  const file = await getFile(owner, repo, 'README.md')
  return file.content
}
