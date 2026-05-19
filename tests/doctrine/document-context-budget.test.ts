// Phase 4b — garde-fou « context budget » (discipline coût IA, opposable).
//
// But : le recall documentaire est CIBLÉ et BORNÉ. Jamais « 7 agents × 20
// docs × 10k tokens », jamais un document/collection entier injecté, jamais
// de relecture live. Unitaire pur (budget) + tripwires structurels.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// Helpers PURS importés du module sans `server-only` (testables hors
// runtime). document-context.ts les re-exporte pour le code serveur.
import {
  estimateTokens,
  clampChunksToBudget,
  toPromptBlock,
  MAX_RETRIEVED_CHUNKS,
  MAX_CONTEXT_TOKENS,
  type DocChunk,
} from '@/lib/ai/document-budget'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const chunk = (id: string, len: number): DocChunk => ({
  sourceId: id,
  text: 'x'.repeat(len),
  similarity: 0.9,
})

describe('Constantes de budget — petites et opposables', () => {
  it('MAX_RETRIEVED_CHUNKS borné (≤ 8)', () => {
    expect(MAX_RETRIEVED_CHUNKS).toBeGreaterThan(0)
    expect(MAX_RETRIEVED_CHUNKS).toBeLessThanOrEqual(8)
  })
  it('MAX_CONTEXT_TOKENS borné (≤ 2000)', () => {
    expect(MAX_CONTEXT_TOKENS).toBeGreaterThan(0)
    expect(MAX_CONTEXT_TOKENS).toBeLessThanOrEqual(2000)
  })
})

describe('clampChunksToBudget — jamais au-dessus du plafond', () => {
  it('ne dépasse JAMAIS maxTokens', () => {
    const chunks = Array.from({ length: 50 }, (_, i) => chunk(`d${i}`, 1000))
    const { kept, truncated } = clampChunksToBudget(chunks, 1200)
    const total = kept.reduce((s, c) => s + estimateTokens(c.text), 0)
    expect(total).toBeLessThanOrEqual(1200)
    expect(truncated).toBe(true)
    expect(kept.length).toBeLessThan(chunks.length)
  })
  it('garde tout si sous le budget, non tronqué', () => {
    const chunks = [chunk('a', 40), chunk('b', 40)]
    const { kept, truncated } = clampChunksToBudget(chunks, MAX_CONTEXT_TOKENS)
    expect(kept).toHaveLength(2)
    expect(truncated).toBe(false)
  })
  it('déterministe + ordre de pertinence préservé', () => {
    // 400 char ⇒ 100 tokens/chunk. Budget 150 ⇒ seul 'a' entre (100),
    // 'b' (200) dépasse → tronqué.
    const chunks = [chunk('a', 400), chunk('b', 400), chunk('c', 400)]
    const r1 = clampChunksToBudget(chunks, 150)
    const r2 = clampChunksToBudget(chunks, 150)
    expect(r1).toEqual(r2)
    expect(r1.kept.map((c) => c.sourceId)).toEqual(['a'])
    expect(r1.truncated).toBe(true)
  })
  it('toPromptBlock vide si aucun chunk (pas d’injection à blanc)', () => {
    expect(toPromptBlock([], false)).toBe('')
  })
  it('toPromptBlock porte la source (relisible /documents/<id>)', () => {
    const b = toPromptBlock([chunk('doc-42', 20)], false)
    expect(b).toContain('[doc:doc-42]')
    expect(b).toContain('/documents/<id>')
  })
})

describe('Tripwires structurels — recall borné, jamais un dump', () => {
  const ctx = read('lib/ai/document-context.ts')

  it('RPC limitée au domaine document + p_limit = MAX_RETRIEVED_CHUNKS', () => {
    expect(ctx).toContain("p_source_domains: ['document']")
    expect(ctx).toMatch(/p_limit:\s*MAX_RETRIEVED_CHUNKS/)
  })
  it('filtre la visibilité au recall (pas seulement UI)', () => {
    expect(ctx).toMatch(/canViewDocument\(/)
  })
  it('aucune lecture d’un document entier / collection entière', () => {
    expect(/extracted_text/.test(ctx)).toBe(false)
    expect(/listDocumentsByCollection|listDocumentsForTarget/.test(ctx)).toBe(false)
  })

  it('chat.ts : documentContext optionnel + slice défensif', () => {
    const chat = read('services/ai/chat.ts')
    expect(/documentContext\?\s*:\s*string/.test(chat)).toBe(true)
    expect(/input\.documentContext\b[\s\S]*?\.slice\(0,\s*\d+\)/.test(chat)).toBe(true)
  })

  it('atelier : recall calculé UNE fois (hors boucle agents), gardé provider', () => {
    const at = read('app/(dashboard)/tenders/[id]/atelier-actions.ts')
    // buildDocumentContext n'apparaît QUE dans le helper fetchDocumentContext.
    const occurrences = at.split('buildDocumentContext').length - 1
    expect(occurrences).toBe(2) // import + 1 appel dans le helper
    expect(at).toMatch(/getActiveProvider\(\)\s*===\s*null/)
    // fetchDocumentContext est dans le Promise.all (1×/message), pas dans
    // la boucle parsed.data.agent_names.map.
    expect(at).toMatch(/fetchDocumentContext\(parsed\.data\.message,\s*role\)/)
  })
})
