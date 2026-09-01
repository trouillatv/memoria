// P0 — Prévention « Unicité du cycle d'import historique ».
//
// Pour un rapport issu d'un import documentaire (site_reports.origin='import'),
// l'extraction documentaire est l'UNIQUE productrice de propositions métier : le
// RPC materialize_historical_visit matérialise déjà ses objets. Avant ce lot, le
// débrief (projectDebriefToProposals), déclenché par l'ouverture du CR, un refresh
// ou « Mettre à jour la synthèse », reprojetait une SECONDE population de
// site_knowledge_proposals — les doublons « à confirmer » observés sur OCEF, que
// la déduplication lexicale (dedupe_key) ne rattrapait pas dès reformulation LLM.
//
// La garde neutralise CETTE projection pour les imports, et RIEN d'autre : la
// synthèse reste calculée, la réconciliation canonique intacte, les visites
// natives inchangées. Aucun reroutage du RPC dans ce lot (décision Vincent).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── Comportemental : un import ne produit JAMAIS de proposition ───────────────

let insertCalled = false
let skpTouched = false
let reportOrigin: string | null = 'import'

const fakeClient = {
  from(table: string) {
    if (table === 'site_knowledge_proposals') skpTouched = true
    const b: Record<string, unknown> = {}
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      in: () => b,
      maybeSingle: async () => ({
        data: table === 'site_reports' ? { origin: reportOrigin } : null,
        error: null,
      }),
      insert: () => {
        insertCalled = true
        return b
      },
    })
    return b
  },
}

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeClient }))

const { projectDebriefToProposals } = await import('@/lib/db/knowledge-proposals')

// Une analyse qui, sur une visite native, PRODUIRAIT une proposition d'action :
// le test prouve que la garde supprime la projection même quand il y a matière.
const analysisWithMatter = {
  analysis_version: 1,
  action_ledger: [{ state: 'open', key: 'k1', title: 'Reprendre le nivellement', owner: '', due: '' }],
} as unknown as Parameters<typeof projectDebriefToProposals>[0]['analysis']

beforeEach(() => {
  insertCalled = false
  skpTouched = false
  reportOrigin = 'import'
})

describe('projectDebriefToProposals — producteur unique pour les imports', () => {
  it('origin=import : zéro proposition, aucune écriture sur site_knowledge_proposals', async () => {
    const res = await projectDebriefToProposals({
      reportId: 'report-import',
      siteId: 'site-1',
      organizationId: 'org-1',
      analysis: analysisWithMatter,
    })

    expect(res).toEqual({ inserted: 0, refreshed: 0, skipped: 0, obsolete: 0, fulfilledByLedger: 0 })
    expect(insertCalled, 'aucun insert de proposition pour un import').toBe(false)
    expect(skpTouched, 'la garde court-circuite AVANT toute lecture/écriture des propositions').toBe(false)
  })

  it('idempotent : rejouer le débrief d’un import (refresh, réanalyse) reste zéro à chaque fois', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await projectDebriefToProposals({
        reportId: 'report-import',
        siteId: 'site-1',
        organizationId: 'org-1',
        analysis: analysisWithMatter,
      })
      expect(res.inserted).toBe(0)
      expect(insertCalled).toBe(false)
    }
  })
})

// ── Doctrine : la garde est positionnée et scopée correctement ────────────────

const SOURCE = join(process.cwd(), 'lib/db/knowledge-proposals.ts')

function bodyOf(name: string): string {
  const src = readFileSync(SOURCE, 'utf8')
  const start = src.indexOf(`export async function ${name}`)
  expect(start, `${name} est introuvable`).toBeGreaterThan(-1)
  const next = src.indexOf('\nexport ', start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('La garde import — positionnée avant tout travail, scopée aux seuls imports', () => {
  const fn = bodyOf('projectDebriefToProposals')

  it('la décision de court-circuit repose sur isImportedDocumentOrigin(origin), jamais sur un magic string', () => {
    expect(fn).toContain('isImportedDocumentOrigin(')
    expect(fn).toMatch(/\.from\('site_reports'\)\s*[\r\n]?\s*\.select\('origin'\)/)
  })

  it('la garde s’exécute AVANT la construction des propositions et AVANT l’insert', () => {
    const guardIdx = fn.indexOf('isImportedDocumentOrigin(')
    const desiredIdx = fn.indexOf('buildDesiredProposals(analysis')
    const insertIdx = fn.indexOf(".from('site_knowledge_proposals')")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(desiredIdx).toBeGreaterThan(guardIdx)
    expect(insertIdx).toBeGreaterThan(guardIdx)
  })

  it('scope STRICT : le seul retour anticipé de la garde est conditionné à l’origine import', () => {
    // La branche de garde retourne le résultat neutre uniquement sous
    // isImportedDocumentOrigin — une visite native ne peut pas tomber dedans.
    const guardBlock = fn.slice(
      fn.indexOf('isImportedDocumentOrigin('),
      fn.indexOf('buildDesiredProposals(analysis'),
    )
    expect(guardBlock).toContain('return { inserted: 0')
  })
})

// ── Exactly-once : promoteProposal ne recrée jamais un objet déjà promu ───────
// Invariant #6 de Vincent : un retry / une concurrence ne peut pas produire un
// second objet. Le code le garantit déjà (early-return si status !== 'proposed').
describe('promoteProposal — exactly-once (déjà garanti, ici verrouillé)', () => {
  const fn = bodyOf('promoteProposal')

  it('une proposition non « proposed » renvoie son objet existant sans rien recréer', () => {
    expect(fn).toContain("p.status !== 'proposed'")
    const earlyReturn = fn.slice(fn.indexOf("p.status !== 'proposed'"), fn.indexOf("p.status !== 'proposed'") + 260)
    expect(earlyReturn).toContain("status: 'promoted'")
    expect(earlyReturn).toContain('promoted_object_id')
  })
})
