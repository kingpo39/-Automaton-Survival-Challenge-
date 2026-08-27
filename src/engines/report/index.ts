/**
 * engines/report/index.ts
 * 
 * REPORT ENGINE — HTML/PDF/Markdown Rendering
 * 
 * Provides rendering from Intermediate Representation (IR) schema
 * to multiple output formats: HTML, PDF, Markdown.
 * 
 * Core principle: IR ONCE, RENDER MANY
 * Write content in IR, render to any format.
 */

import { createLogger } from '../../observability/logger.js'

const log = createLogger('engine:report')

// ── IR Schema Types ──────────────────────────────────────────────────────────

export type IRNodeType = 
  | 'document' | 'section' | 'paragraph' | 'heading' | 'list'
  | 'table' | 'code' | 'quote' | 'image' | 'link' | 'emphasis'
  | 'strong' | 'inline_code' | 'horizontal_rule' | 'page_break'

export interface IRNode {
  type: IRNodeType
  content?: string
  children?: IRNode[]
  attributes?: Record<string, unknown>
  metadata?: IRMetadata
}

export interface IRMetadata {
  id?: string
  className?: string
  language?: string
  caption?: string
  alt?: string
  href?: string
  level?: number // for headings
  ordered?: boolean // for lists
  rows?: string[][] // for tables
  rowsHeader?: boolean // for tables
}

export interface IRDocument {
  version: string
  title: string
  author: string
  created: number
  modified: number
  root: IRNode
  toc?: IRNode
  metadata: Record<string, unknown>
}

// ── Output Formats ───────────────────────────────────────────────────────────

export type OutputFormat = 'html' | 'pdf' | 'markdown' | 'json'

export interface RenderOptions {
  format: OutputFormat
  template?: string
  css?: string
  pageSize?: 'A4' | 'Letter' | 'Legal'
  margins?: { top: number; right: number; bottom: number; left: number }
  includeToc?: boolean
  includeMetadata?: boolean
  minify?: boolean
}

export interface RenderResult {
  content: string
  format: OutputFormat
  size: number
  renderTimeMs: number
}

// ── ReportEngine Interface ───────────────────────────────────────────────────

export interface ReportEngine {
  /**
   * Parse text/markdown into IR.
   */
  parseToIR(content: string, sourceFormat?: 'markdown' | 'html' | 'text'): IRDocument

  /**
   * Render IR to specified format.
   */
  render(doc: IRDocument, options: RenderOptions): Promise<RenderResult>

  /**
   * Render directly from text input.
   */
  renderFromText(
    content: string,
    options: RenderOptions,
    title?: string
  ): Promise<RenderResult>

  /**
   * Convert between formats.
   */
  convert(content: string, from: OutputFormat, to: OutputFormat): Promise<string>

  /**
   * Validate IR document structure.
   */
  validate(doc: IRDocument): ValidationResult

  /**
   * Merge multiple IR documents.
   */
  merge(documents: IRDocument[], title?: string): IRDocument

  /**
   * Create table of contents from IR.
   */
  generateTOC(doc: IRDocument): IRNode

  /**
   * Extract text content from IR (for search/indexing).
   */
  extractText(doc: IRDocument): string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

export interface ValidationError {
  path: string
  message: string
  severity: 'error' | 'warning'
}

// ── ReportEngine Implementation ──────────────────────────────────────────────

export class StandardReportEngine implements ReportEngine {
  
  parseToIR(content: string, sourceFormat: 'markdown' | 'html' | 'text' = 'markdown'): IRDocument {
    const root = this.parseContent(content, sourceFormat)
    
    return {
      version: '1.0',
      title: this.extractTitle(root) ?? 'Untitled',
      author: 'Conway Automaton',
      created: Date.now(),
      modified: Date.now(),
      root,
      toc: this.generateTOC({ version: '1.0', title: '', author: '', created: 0, modified: 0, root, metadata: {} }),
      metadata: {},
    }
  }

  async render(doc: IRDocument, options: RenderOptions): Promise<RenderResult> {
    const startTime = Date.now()
    let content: string

    switch (options.format) {
      case 'html':
        content = this.renderToHTML(doc, options)
        break
      case 'markdown':
        content = this.renderToMarkdown(doc)
        break
      case 'json':
        content = JSON.stringify(doc, null, 2)
        break
      case 'pdf':
        content = await this.renderToPDF(doc, options)
        break
      default:
        throw new Error(`Unsupported format: ${options.format}`)
    }

    return {
      content,
      format: options.format,
      size: content.length,
      renderTimeMs: Date.now() - startTime,
    }
  }

  async renderFromText(
    content: string,
    options: RenderOptions,
    title?: string
  ): Promise<RenderResult> {
    const doc = this.parseToIR(content)
    if (title) doc.title = title
    return this.render(doc, options)
  }

  async convert(content: string, from: OutputFormat, to: OutputFormat): Promise<string> {
    let doc: IRDocument
    
    if (from === 'json') {
      doc = JSON.parse(content)
    } else {
      doc = this.parseToIR(content, from === 'markdown' ? 'markdown' : 'text')
    }
    
    const result = await this.render(doc, { format: to })
    return result.content
  }

  validate(doc: IRDocument): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: string[] = []

    if (!doc.title) {
      errors.push({ path: 'title', message: 'Document must have a title', severity: 'error' })
    }

    if (!doc.root) {
      errors.push({ path: 'root', message: 'Document must have a root node', severity: 'error' })
    }

    this.validateNode(doc.root, '$', errors, warnings)

    return {
      valid: errors.filter(e => e.severity === 'error').length === 0,
      errors,
      warnings,
    }
  }

  merge(documents: IRDocument[], title?: string): IRDocument {
    const children: IRNode[] = []
    
    for (const doc of documents) {
      children.push(doc.root)
    }

    return {
      version: '1.0',
      title: title ?? 'Merged Document',
      author: 'Conway Automaton',
      created: Date.now(),
      modified: Date.now(),
      root: {
        type: 'document',
        children,
      },
      metadata: {},
    }
  }

  generateTOC(doc: IRDocument): IRNode {
    const tocItems: IRNode[] = []
    this.extractHeadings(doc.root, tocItems, 0)

    return {
      type: 'list',
      attributes: { ordered: true },
      children: tocItems,
    }
  }

  extractText(doc: IRDocument): string {
    return this.extractTextFromNode(doc.root)
  }

  // ── Private: Parsers ──────────────────────────────────────────────────

  private parseContent(content: string, format: string): IRNode {
    if (format === 'markdown') {
      return this.parseMarkdown(content)
    }
    // Default: treat as plain text
    return this.parsePlainText(content)
  }

  private parseMarkdown(content: string): IRNode {
    const lines = content.split('\n')
    const children: IRNode[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
      if (headingMatch) {
        children.push({
          type: 'heading',
          content: headingMatch[2],
          attributes: { level: headingMatch[1].length },
        })
        i++
        continue
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        children.push({ type: 'horizontal_rule' })
        i++
        continue
      }

      // Empty line
      if (line.trim() === '') {
        i++
        continue
      }

      // Paragraph (collect consecutive non-empty lines)
      const paraLines: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^#{1,6}\s/)) {
        paraLines.push(lines[i])
        i++
      }
      if (paraLines.length > 0) {
        children.push({
          type: 'paragraph',
          content: paraLines.join(' '),
        })
      }
    }

    return { type: 'document', children }
  }

  private parsePlainText(content: string): IRNode {
    const children = content.split('\n\n').map(para => ({
      type: 'paragraph' as IRNodeType,
      content: para.trim(),
    }))
    return { type: 'document', children }
  }

  // ── Private: Renderers ────────────────────────────────────────────────

  private renderToHTML(doc: IRDocument, options: RenderOptions): string {
    const sections: string[] = []

    if (options.includeMetadata !== false) {
      sections.push(`<meta name="author" content="${doc.author}">`)
      sections.push(`<meta name="created" content="${new Date(doc.created).toISOString()}">`)
    }

    if (options.includeToc !== false && doc.toc) {
      sections.push('<nav class="toc">')
      sections.push('<h2>Table of Contents</h2>')
      sections.push(this.renderNodeToHTML(doc.toc))
      sections.push('</nav>')
    }

    sections.push(this.renderNodeToHTML(doc.root))

    const css = options.css ?? this.getDefaultCSS()
    const minified = options.minify ? this.minifyHTML(sections.join('\n')) : sections.join('\n')

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${doc.title}</title>
  <style>${css}</style>
</head>
<body>
${minified}
</body>
</html>`
  }

  private renderNodeToHTML(node: IRNode): string {
    const tag = this.getHTMLTag(node.type)
    const attrs = this.buildHTMLAttributes(node.attributes)
    
    if (!tag) return node.content ?? ''

    const children = node.children?.map(child => this.renderNodeToHTML(child)).join('\n') ?? node.content ?? ''
    
    if (node.type === 'heading') {
      const level = (node.attributes?.level as number) ?? 1
      return `<h${level} ${attrs}>${children}</h${level}>`
    }

    if (node.type === 'list') {
      const tag = node.attributes?.ordered ? 'ol' : 'ul'
      return `<${tag} ${attrs}>${children}</${tag}>`
    }

    return `<${tag} ${attrs}>${children}</${tag}>`
  }

  private renderToMarkdown(doc: IRDocument): string {
    return this.renderNodeToMarkdown(doc.root)
  }

  private renderNodeToMarkdown(node: IRNode): string {
    switch (node.type) {
      case 'heading': {
        const level = (node.attributes?.level as number) ?? 1
        return `${'#'.repeat(level)} ${node.content}\n\n`
      }
      case 'paragraph':
        return `${node.content}\n\n`
      case 'list':
        return (node.children?.map((child, i) => 
          `${node.attributes?.ordered ? `${i + 1}.` : '-'} ${child.content}`
        ).join('\n') ?? '') + '\n\n'
      case 'code':
        return `\`\`\`${node.attributes?.language ?? ''}\n${node.content}\n\`\`\`\n\n`
      case 'quote':
        return `> ${node.content}\n\n`
      case 'horizontal_rule':
        return '---\n\n'
      default:
        return node.content ?? ''
    }
  }

  private async renderToPDF(_doc: IRDocument, _options: RenderOptions): Promise<string> {
    // In production, use a PDF library like puppeteer or pdfkit
    // For now, return HTML with PDF styles
    return '<!-- PDF rendering not implemented -->'
  }

  // ── Private: Helpers ──────────────────────────────────────────────────

  private getHTMLTag(type: IRNodeType): string | null {
    const tagMap: Record<IRNodeType, string> = {
      document: 'div',
      section: 'section',
      paragraph: 'p',
      heading: 'h1', // Will be overridden
      list: 'ul',    // Will be overridden
      table: 'table',
      code: 'pre',
      quote: 'blockquote',
      image: 'img',
      link: 'a',
      emphasis: 'em',
      strong: 'strong',
      inline_code: 'code',
      horizontal_rule: 'hr',
      page_break: 'div',
    }
    return tagMap[type] ?? 'div'
  }

  private buildHTMLAttributes(attrs?: Record<string, unknown>): string {
    if (!attrs) return ''
    return Object.entries(attrs)
      .filter(([key]) => !['level', 'ordered', 'rows', 'rowsHeader'].includes(key))
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ')
  }

  private extractTitle(node: IRNode): string | null {
    if (node.type === 'heading' && (node.attributes?.level as number) === 1) {
      return node.content ?? null
    }
    for (const child of node.children ?? []) {
      const title = this.extractTitle(child)
      if (title) return title
    }
    return null
  }

  private extractHeadings(node: IRNode, items: IRNode[], depth: number): void {
    if (node.type === 'heading') {
      items.push({
        type: 'paragraph',
        content: `${'  '.repeat(depth)}${node.content}`,
      })
    }
    for (const child of node.children ?? []) {
      this.extractHeadings(child, items, depth + 1)
    }
  }

  private extractTextFromNode(node: IRNode): string {
    const parts: string[] = []
    if (node.content) parts.push(node.content)
    for (const child of node.children ?? []) {
      parts.push(this.extractTextFromNode(child))
    }
    return parts.join(' ')
  }

  private validateNode(node: IRNode, path: string, errors: ValidationError[], warnings: string[]): void {
    if (!node.type) {
      errors.push({ path, message: 'Node must have a type', severity: 'error' })
    }
    for (const child of node.children ?? []) {
      this.validateNode(child, `${path}/${node.type}`, errors, warnings)
    }
  }

  private getDefaultCSS(): string {
    return `
      body { font-family: sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
      h1 { border-bottom: 2px solid #333; }
      h2 { border-bottom: 1px solid #666; }
      code { background: #f4f4f4; padding: 2px 4px; }
      pre { background: #f4f4f4; padding: 12px; overflow-x: auto; }
      blockquote { border-left: 4px solid #ccc; margin-left: 0; padding-left: 16px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 8px; }
      th { background: #f4f4f4; }
    `
  }

  private minifyHTML(html: string): string {
    return html
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim()
  }
}
