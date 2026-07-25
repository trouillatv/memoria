import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function extractCall(source: string, callPrefix: string): string {
  const start = source.indexOf(callPrefix)
  if (start < 0) return ''

  const openParen = source.indexOf('(', start)
  if (openParen < 0) return ''

  let depth = 0
  for (let i = openParen; i < source.length; i += 1) {
    const char = source[i]
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth === 0 && i > openParen) return source.slice(start, i + 1)
  }

  return ''
}

const READ_MODEL = 'lib/db/tender-engagement-provenance.ts'
const PURE_PROVENANCE = 'lib/tenders/engagement-provenance.ts'
const WRITE_PATH = 'app/(dashboard)/tenders/[id]/engagements-actions.ts'

describe('tender engagement provenance doctrine guards', () => {
  it('the audit read model never upgrades legacy source_ref.page into structured provenance', () => {
    const src = codeOf(READ_MODEL)

    expect(src).toContain('deriveEngagementProvenanceReadRow')
    expect(src, 'source_ref is historical context only, never the structured page source')
      .not.toMatch(/sourceRef\s*\?\.\s*page|sourceRef\s*\[\s*['"]page['"]\s*\]|source_ref\s*\?\.\s*page|source_ref\s*\[\s*['"]page['"]\s*\]/)
  })

  it('the audit read model never falls back to getTenderDocument or a latest-pdf lookup', () => {
    const src = codeOf(READ_MODEL)

    expect(src).not.toContain('getTenderDocument')
    expect(src).not.toContain('listTenderDocuments')
    expect(src, 'the audit read model must read persisted joins, not a latest-upload fallback')
      .not.toMatch(/order\(\s*['"]uploaded_at['"]\s*,\s*\{\s*ascending:\s*false\s*\}\s*\)/)
  })

  it('the write path persists only server-resolved provenance, not AI-provided document/page fields', () => {
    const src = codeOf(WRITE_PATH)
    const resolver = src.match(/const\s+(\w+)\s*=\s*createVerifiedEngagementProvenanceResolver\(/)
    const insertCall = extractCall(src, 'await bulkInsertEngagements(')

    expect(src).toContain('createVerifiedEngagementProvenanceResolver')
    expect(resolver, 'a server-side provenance resolver must be created in the write path').not.toBeNull()
    expect(insertCall, 'the bulk insertion payload must call the server-side provenance resolver')
      .toMatch(new RegExp(`${resolver?.[1]}\\s*\\(`))
    expect(src, 'structured provenance must not be copied directly from the extracted engagement payload')
      .not.toMatch(/tender_document_id\s*:\s*engagement\.|page_number\s*:\s*engagement\./)
  })

  it('the canonical document resolver stays exact and never picks the first fuzzy candidate', () => {
    const src = codeOf(PURE_PROVENANCE)

    expect(src).toContain('canonicalizeTenderFilename')
    expect(src).toContain('canonicalizeTenderFilename(document.filename) === canonicalReference')
    expect(src, 'no fuzzy filename matching or candidate ranking belongs in this tranche')
      .not.toMatch(/\.sort\(|localeCompare\(|startsWith\(|endsWith\(|levenshtein|similarity|fuzzy/i)
    expect(src, 'the resolver must not blindly select the first candidate')
      .not.toMatch(/return\s+matches\[(?:0|1)\]|return\s+matches\.at\(\s*0\s*\)|return\s+matches\.find\(/)
  })
})
