// A5 — getContractMemory : fait documentaire factuel & sobre.
//
// Tripwire structurel pur : phrase factuelle uniquement, visibility_level
// respecté (role threadé, défaut null = aucun détail), zéro IA, zéro
// score/%/risque. Source réelle = document_links (listDocumentsForTarget).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const src = readFileSync(join(ROOT, 'lib/db/contracts.ts'), 'utf-8')

// Bloc A5 isolé via marqueur stable (pas d'extraction regex fragile).
const a5Start = src.indexOf('// A5 — fait documentaire')
const a5End = src.indexOf('return facts', a5Start)
const block = a5Start >= 0 && a5End > a5Start ? src.slice(a5Start, a5End) : ''

describe('A5 — fait documentaire dans getContractMemory', () => {
  it('bloc A5 présent (marqueur)', () => {
    expect(block.length).toBeGreaterThan(0)
  })

  it('signature adaptée proprement : role optionnel défaut null', () => {
    expect(
      /getContractMemory\([\s\S]*?role:\s*UserRole\s*\|\s*null\s*=\s*null/.test(src),
    ).toBe(true)
  })

  it("source réelle = document_links (listDocumentsForTarget('contract'))", () => {
    expect(src.includes("listDocumentsForTarget('contract', contractId)")).toBe(true)
  })

  it('visibility_level respecté : filtre canViewDocument(role, …)', () => {
    expect(/canViewDocument\(\s*role,\s*d\.visibility_level\s*\)/.test(block)).toBe(true)
  })

  it('aucun détail si rien de visible (fait sous garde visibleDocs.length > 0)', () => {
    expect(/visibleDocs\.length\s*>\s*0/.test(block)).toBe(true)
  })

  it('phrase factuelle attendue (« N document(s) rattaché(s) à ce contrat »)', () => {
    expect(block).toContain('rattaché')
    expect(block).toContain('à ce contrat :')
  })

  it('types distincts triés (déterministe) et plafonnés', () => {
    expect(/new Set\(visibleDocs\.map\(\(d\)\s*=>\s*d\.document_type\)\)/.test(block)).toBe(true)
    expect(/\.sort\(\)/.test(block)).toBe(true)
    expect(/\.slice\(0,\s*6\)/.test(block)).toBe(true)
  })

  it('zéro score / % / risque / jugement dans le fait A5 (code, hors commentaires)', () => {
    // On vise le CODE/le fait produit, pas les commentaires (qui citent
    // légitimement « score »/« risque » comme interdits).
    const code = block
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    expect(/%|\bscore\b|\brisque\b|tension|criticit|classement|productivit/i.test(code)).toBe(false)
  })

  it('contracts.ts : aucun import IA/orchestrator/recall', () => {
    const head = src.slice(0, 600)
    expect(
      /services\/ai\/|buildDocumentContext|embed-knowledge-chunks|@\/lib\/documents\/analyze|find_similar|@anthropic-ai|@google\/genai/.test(head),
    ).toBe(false)
  })
})
