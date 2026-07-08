// A6 — sources [doc:id] du recall A3 persistées dans tender_analyses.
// Tripwire structurel pur : 0 IA/recall en plus, dérivé du docCtx A3,
// références seules, ids uniques, mock inchangé.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const orch = read('services/ai/orchestrator.ts')
const mig = read('supabase/migrations/074_tender_analyses_document_sources.sql')

describe('A6 — document_sources (réf. recall A3, zéro recall en plus)', () => {
  it('UN SEUL buildDocumentContext (aucun recall ajouté pour A6)', () => {
    expect((orch.match(/\bbuildDocumentContext\(/g) ?? []).length).toBe(1)
    // Un seul import dynamique de document-context.
    expect((orch.match(/import\('@\/lib\/ai\/document-context'\)/g) ?? []).length).toBe(1)
  })

  it('document_sources dérivé du docCtx A3 DÉJÀ calculé (docCtx.chunks)', () => {
    expect(/for \(const c of docCtx\.chunks\)/.test(orch)).toBe(true)
    expect(/documentSources\.push\(\{\s*id:\s*c\.sourceId,\s*type:\s*c\.documentType\s*\}\)/.test(orch)).toBe(true)
  })

  it('références SEULEMENT { id, type } — jamais texte/extracted_text/chunk', () => {
    // Le push ne contient que id + type ; aucun c.text / extracted_text.
    const block = orch.slice(orch.indexOf('const documentSources'), orch.indexOf('return {'))
    expect(/c\.text|extracted_text|chunk_text/.test(block)).toBe(false)
    // Type DB borné aux références.
    const types = read('types/db.ts')
    const ifaceM = types.match(/interface DbTenderAnalysisDocumentSource \{([\s\S]*?)\}/)
    expect(ifaceM, 'interface DbTenderAnalysisDocumentSource').toBeTruthy()
    expect(/text|content|extracted/i.test(ifaceM![1])).toBe(false)
  })

  it('ids uniques (déduplication par Set)', () => {
    expect(/seenDocIds = new Set<string>\(\)/.test(orch)).toBe(true)
    expect(/seenDocIds\.has\(c\.sourceId\)/.test(orch)).toBe(true)
  })

  it('mock inchangé : docCtx.chunks=[] hors recall → documentSources []', () => {
    // Le recall (et donc docCtx.chunks) ne se peuple QUE hors mock.
    expect(/provider\.name !== 'mock'/.test(orch)).toBe(true)
    expect(/chunks:\s*\[\]\s*\}/.test(orch)).toBe(true) // init vide
  })

  it('AnalyzeTenderResult expose documentSources + return le porte', () => {
    expect(/documentSources:\s*\{\s*id:\s*string;\s*type\?:\s*string\s*\}\[\]/.test(orch)).toBe(true)
    // CRLF-tolérant : `documentSources,` seul sur sa ligne dans le return.
    expect(/^\s*documentSources,\s*$/m.test(orch)).toBe(true)
  })

  it('migration 074 additive idempotente (ADD COLUMN IF NOT EXISTS jsonb)', () => {
    expect(/add column if not exists document_sources jsonb/i.test(mig)).toBe(true)
    expect(/drop |delete from|truncate/i.test(mig)).toBe(false) // non destructif
  })

  it('le point de passage UNIQUE (run-analysis) passe document_sources', () => {
    // Refactor post-A6 : les actions/routes délèguent toutes à
    // lib/tenders/run-analysis.ts — la garantie vit AU point de passage.
    expect(/document_sources:\s*result\.documentSources/.test(read('lib/tenders/run-analysis.ts'))).toBe(true)
  })

  it('aucun appelant insertTenderAnalysis hors run-analysis (pas de contournement)', () => {
    // Si un nouveau code insère une analyse sans passer par run-analysis, il
    // peut oublier document_sources → le recall A3 perd ses références.
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    const out = execSync('git grep -l "insertTenderAnalysis" -- app lib services', { cwd: ROOT }).toString()
    const files = out.split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/'))
    expect(files.sort()).toEqual(['lib/db/tenders.ts', 'lib/tenders/run-analysis.ts'])
  })
})
