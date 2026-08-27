/**
 * src/mcp/docs-lookup.ts
 *
 * Documentation lookup via GitHub repos.
 * Searches library README, docs folder, and relevant code files.
 *
 * Why not Context7? It's an MCP server (stdio transport), not a REST API.
 * GitHub API gives us the same docs with no additional dependencies.
 */

import { createLogger } from '../observability/logger.js'

const log = createLogger('mcp:docs')

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

export interface DocLookupResult {
  library: string
  topic: string
  content: string
  source: string
  retrievedAt: number
}

/**
 * Popular library → GitHub repo mapping.
 */
const LIBRARY_REPOS: Record<string, { owner: string; repo: string }> = {
  'react': { owner: 'facebook', repo: 'react' },
  'express': { owner: 'expressjs', repo: 'express' },
  'next': { owner: 'vercel', repo: 'next.js' },
  'vue': { owner: 'vuejs', repo: 'core' },
  'svelte': { owner: 'sveltejs', repo: 'svelte' },
  'angular': { owner: 'angular', repo: 'angular' },
  'prisma': { owner: 'prisma', repo: 'prisma' },
  'tailwind': { owner: 'tailwindlabs', repo: 'tailwindcss' },
  'typescript': { owner: 'microsoft', repo: 'TypeScript' },
  'node': { owner: 'nodejs', repo: 'node' },
  'ollama': { owner: 'ollama', repo: 'ollama' },
  'pytorch': { owner: 'pytorch', repo: 'pytorch' },
  'tensorflow': { owner: 'tensorflow', repo: 'tensorflow' },
  'fastapi': { owner: 'tiangolo', repo: 'fastapi' },
  'flask': { owner: 'pallets', repo: 'flask' },
  'django': { owner: 'django', repo: 'django' },
  'redis': { owner: 'redis', repo: 'redis' },
  'postgres': { owner: 'postgres', repo: 'postgres' },
  'sqlite': { owner: 'sqlite', repo: 'sqlite' },
}

/**
 * Resolve a library name to a GitHub repo.
 */
async function resolveLibrary(
  libraryName: string,
): Promise<{ owner: string; repo: string } | null> {
  const lower = libraryName.toLowerCase().trim()

  if (LIBRARY_REPOS[lower]) {
    return LIBRARY_REPOS[lower]
  }

  // Search GitHub
  try {
    const resp = await fetch(
      `${GITHUB_API}/search/repositories?q=${encodeURIComponent(libraryName)}&sort=stars&per_page=1`,
      { headers: headers() },
    )
    if (!resp.ok) return null
    const data = await resp.json() as any
    const repo = data.items?.[0]
    if (!repo) return null
    return { owner: repo.owner.login, repo: repo.name }
  } catch {
    return null
  }
}

/**
 * Search code within a repository for topic-related content.
 */
async function searchRepoCode(
  owner: string,
  repo: string,
  topic: string,
): Promise<string> {
  try {
    const query = `${topic} repo:${owner}/${repo}`
    const resp = await fetch(
      `${GITHUB_API}/search/code?q=${encodeURIComponent(query)}&per_page=3`,
      { headers: headers() },
    )
    if (!resp.ok) return ''
    const data = await resp.json() as any
    return (data.items || [])
      .map((item: any) => `${item.path} (${item.repository.full_name})`)
      .join('\n')
  } catch {
    return ''
  }
}

/**
 * Get file content from a repo.
 */
async function getFileContent(
  owner: string,
  repo: string,
  path: string,
): Promise<string> {
  try {
    const resp = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`,
      { headers: headers() },
    )
    if (!resp.ok) return ''
    const data = await resp.json() as any
    if (data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8').slice(0, 10_000)
    }
    return (data.content || '').slice(0, 10_000)
  } catch {
    return ''
  }
}

/**
 * Look up documentation for a library/topic.
 * Fetches README and searches for topic-related code.
 */
export async function lookupDocs(
  libraryName: string,
  topic: string,
): Promise<DocLookupResult | null> {
  log.info('Looking up docs', { libraryName, topic })

  const resolved = await resolveLibrary(libraryName)
  if (!resolved) {
    log.warn('Library not found', { libraryName })
    return null
  }

  const { owner, repo } = resolved
  const parts: string[] = []

  // 1. Get README
  const readme = await getFileContent(owner, repo, 'README.md')
  if (readme) {
    parts.push(`## README\n${readme.slice(0, 5000)}`)
  }

  // 2. Search for topic-related files
  const codeFiles = await searchRepoCode(owner, repo, topic)
  if (codeFiles) {
    parts.push(`\n## Relevant files\n${codeFiles}`)
  }

  // 3. Try common doc paths
  const docPaths = [
    'docs/README.md',
    'DOC.md',
    'USAGE.md',
    'API.md',
    'CHANGELOG.md',
  ]
  for (const docPath of docPaths) {
    const content = await getFileContent(owner, repo, docPath)
    if (content && content.toLowerCase().includes(topic.toLowerCase().slice(0, 10))) {
      parts.push(`\n## ${docPath}\n${content.slice(0, 3000)}`)
      break  // only add one doc file
    }
  }

  if (parts.length === 0) {
    return null
  }

  return {
    library: `${owner}/${repo}`,
    topic,
    content: parts.join('\n'),
    source: `https://github.com/${owner}/${repo}`,
    retrievedAt: Date.now(),
  }
}

export { resolveLibrary }
export type { }
