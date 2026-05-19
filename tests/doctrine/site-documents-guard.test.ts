// A4 — section Documents page site (consommateur mince). Tripwire structurel
// pur : lecture document_links uniquement, visibility respectée, masquée si
// vide, zéro IA. + composant partagé présentationnel (anti-duplication).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const SITE = read('app/(dashboard)/sites/[id]/page.tsx')
const COMP = read('components/documents/LinkedDocumentsList.tsx')

const NO_AI =
  /buildDocumentContext|embed-knowledge-chunks|@\/lib\/documents\/analyze|services\/ai\/|find_similar|@anthropic-ai|@google\/genai|generateText/

describe('A4 — Documents page site', () => {
  it('lit les documents liés via listDocumentsForTarget(\'site\', …)', () => {
    expect(SITE.includes("listDocumentsForTarget('site', id)")).toBe(true)
  })

  it('filtre par visibility_level (canViewDocument) — aucun doc non autorisé', () => {
    expect(/canViewDocument\(user\.role,\s*d\.visibility_level\)/.test(SITE)).toBe(true)
  })

  it('masque la section si aucun document visible', () => {
    expect(/visibleSiteDocs\.length\s*>\s*0\s*&&/.test(SITE)).toBe(true)
  })

  it('lien « ouvrir » vers /documents/[id] (via composant partagé)', () => {
    expect(/href=\{`\/documents\/\$\{d\.id\}`\}/.test(COMP)).toBe(true)
  })

  it('zéro IA / recall / embedding (site page + composant)', () => {
    expect(NO_AI.test(SITE), 'import IA dans la page site').toBe(false)
    expect(NO_AI.test(COMP), 'import IA dans le composant').toBe(false)
  })

  it('composant partagé = présentationnel (aucun fetch de données)', () => {
    expect(/createAdminClient|createServerClient|await\s+supabase|\.from\(/.test(COMP)).toBe(false)
  })
})
