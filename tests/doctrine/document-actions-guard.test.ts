// Tripwires structurels sur app/(dashboard)/documents/actions.ts :
//  - relaunchDocumentAnalysisAction (Réanalyser)
//  - deleteDocumentAction (Supprimer + nettoyage dérivés IA)
//
// Couverture doctrinale :
//  - auth manager+ obligatoire ;
//  - audit log avec action sémantique (analysis_relaunched, soft_deleted) ;
//  - relaunch : idempotence (refuse si en cours) + reset status + fire-and-forget ;
//  - delete : appel softDeleteDocument (qui nettoie chunks + résonances).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

const actions = read('app/(dashboard)/documents/actions.ts')
const dbDoc = read('lib/db/documents.ts')

describe('Document actions — Réanalyser', () => {
  it('action exportée', () => {
    expect(/export async function relaunchDocumentAnalysisAction/.test(actions)).toBe(true)
  })
  it('auth manager+ obligatoire (requireManagerOrAdmin)', () => {
    const block = extractBlock(actions, 'relaunchDocumentAnalysisAction')
    expect(/requireManagerOrAdmin\(\)/.test(block)).toBe(true)
  })
  it('idempotence : refuse si en cours (pending/extracting/ocr/chunking)', () => {
    const block = extractBlock(actions, 'relaunchDocumentAnalysisAction')
    expect(/inFlight[\s\S]{0,200}?'pending'[\s\S]{0,80}?'extracting'[\s\S]{0,80}?'ocr'[\s\S]{0,80}?'chunking'/.test(block)).toBe(true)
    expect(/Analyse déjà en cours/.test(block)).toBe(true)
  })
  it('reset status à \'pending\' via updateDocumentAnalysisStatus', () => {
    const block = extractBlock(actions, 'relaunchDocumentAnalysisAction')
    expect(/updateDocumentAnalysisStatus\([^,]+,\s*'pending'\)/.test(block)).toBe(true)
  })
  it('audit log avec action analysis_relaunched', () => {
    const block = extractBlock(actions, 'relaunchDocumentAnalysisAction')
    expect(/action:\s*'analysis_relaunched'/.test(block)).toBe(true)
  })
  it('fire-and-forget via after() (jamais bloquant)', () => {
    const block = extractBlock(actions, 'relaunchDocumentAnalysisAction')
    expect(/after\(\(\)\s*=>\s*analyzeDocument/.test(block)).toBe(true)
  })
})

describe('Document actions — Supprimer', () => {
  it('action exportée', () => {
    expect(/export async function deleteDocumentAction/.test(actions)).toBe(true)
  })
  it('auth manager+ obligatoire', () => {
    const block = extractBlock(actions, 'deleteDocumentAction')
    expect(/requireManagerOrAdmin\(\)/.test(block)).toBe(true)
  })
  it('refuse un doc déjà supprimé (idempotence)', () => {
    const block = extractBlock(actions, 'deleteDocumentAction')
    expect(/doc\.deleted_at/.test(block)).toBe(true)
  })
  it('appelle softDeleteDocument (qui nettoie dérivés IA)', () => {
    const block = extractBlock(actions, 'deleteDocumentAction')
    expect(/softDeleteDocument\(/.test(block)).toBe(true)
  })
  it('audit log avec action soft_deleted', () => {
    const block = extractBlock(actions, 'deleteDocumentAction')
    expect(/action:\s*'soft_deleted'/.test(block)).toBe(true)
  })
  it('aucun hard-delete du fichier storage (pattern soft delete)', () => {
    const block = extractBlock(actions, 'deleteDocumentAction')
    expect(/storage\.from\(['"]documents['"]\)\.remove/.test(block)).toBe(false)
  })
})

describe('softDeleteDocument (lib/db/documents.ts) — nettoyage dérivés IA', () => {
  it('export présent', () => {
    expect(/export async function softDeleteDocument/.test(dbDoc)).toBe(true)
  })
  it('marque deleted_at sans hard delete du document', () => {
    const block = extractBlock(dbDoc, 'softDeleteDocument')
    expect(/update\(\{\s*deleted_at:/.test(block)).toBe(true)
    expect(/\.delete\(\)[\s\S]{0,80}?from\(['"]documents['"]\)/.test(block)).toBe(false)
  })
  it('DELETE hard des knowledge_chunks (anti-fuite recall)', () => {
    const block = extractBlock(dbDoc, 'softDeleteDocument')
    expect(/from\(['"]knowledge_chunks['"]\)[\s\S]{0,80}?\.delete\(\)/.test(block)).toBe(true)
    expect(/eq\(['"]source_domain['"],\s*['"]document['"]\)/.test(block)).toBe(true)
  })
  it('stale des résonances (B1+B2) où source[0].id = doc.id', () => {
    const block = extractBlock(dbDoc, 'softDeleteDocument')
    expect(/from\(['"]site_reading_candidates['"]\)/.test(block)).toBe(true)
    expect(/like\(['"]algorithm_version['"],\s*['"]b%_doc_%['"]\)/.test(block)).toBe(true)
    expect(/status:\s*['"]stale['"]/.test(block)).toBe(true)
    expect(/src\[0\]\?\.id\s*===\s*id/.test(block)).toBe(true)
  })
  it('aucun appel à storage.remove (fichier conservé)', () => {
    const block = extractBlock(dbDoc, 'softDeleteDocument')
    expect(/storage[\s\S]{0,40}\.remove/.test(block)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Helper : extraction grossière du corps d'une fonction nommée.
// ---------------------------------------------------------------------------
function extractBlock(src: string, name: string): string {
  const idx = src.indexOf(name)
  if (idx === -1) return ''
  // Recherche une borne robuste : prochaine déclaration `export` ou EOF.
  const tail = src.slice(idx)
  const next = tail.slice(name.length).search(/\nexport (async )?function /)
  return next === -1 ? tail : tail.slice(0, name.length + next)
}
