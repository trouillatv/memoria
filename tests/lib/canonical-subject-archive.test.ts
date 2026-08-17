import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canReactivate } from '@/lib/db/canonical-subject-resolve'

function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

const ARCHIVE_SRC = 'lib/db/canonical-subject-archive.ts'
const RESOLVE_SRC = 'lib/db/canonical-subject-resolve.ts'
const DEBRIEF_SRC = 'lib/visits/debrief-analysis.ts'

// ── canReactivate — invariant pur ─────────────────────────────────────────────

describe('canReactivate — invariant statut', () => {
  it('auto_archived → réactivable', () => {
    expect(canReactivate('auto_archived')).toBe(true)
  })

  it('merged → jamais réactivé', () => {
    expect(canReactivate('merged')).toBe(false)
  })

  it('split → jamais réactivé', () => {
    expect(canReactivate('split')).toBe(false)
  })

  it('active → pas de réactivation (déjà actif)', () => {
    expect(canReactivate('active')).toBe(false)
  })

  it('chaîne vide ou inconnu → pas réactivable', () => {
    expect(canReactivate('')).toBe(false)
    expect(canReactivate('deleted')).toBe(false)
    expect(canReactivate('rejected')).toBe(false)
  })
})

// ── Doctrine : archivage automatique ─────────────────────────────────────────

describe('canonical-subject-archive — Lot 2 doctrine', () => {
  it('sujets manual jamais archivés — ARCHIVABLE_SOURCES excl. manual', () => {
    const src = codeOf(ARCHIVE_SRC)
    expect(src).toContain("'auto_visit'")
    expect(src).toContain("'auto_meeting'")
    expect(src).toContain("'historical_pv'")
    // 'manual' doit être absent de l'ensemble des sources archivables
    expect(src).not.toMatch(/ARCHIVABLE_SOURCES\s*=\s*new Set\([^)]*'manual'/)
  })

  it('sujet avec objet métier actif (non orphelin) est protégé', () => {
    const src = codeOf(ARCHIVE_SRC)
    // La garde doit vérifier orphaned_from_visit_at IS NULL sur les trois types
    expect(src).toContain('orphaned_from_visit_at')
    expect(src).toContain('withActiveObjects')
    expect(src).toContain("'site_action'")
    expect(src).toContain("'site_reserve'")
    expect(src).toContain("'site_decision'")
  })

  it('archivage conditionnel sur status=active — idempotent', () => {
    const src = codeOf(ARCHIVE_SRC)
    expect(src).toContain("eq('status', 'active')")
    expect(src).toContain("update({ status: 'auto_archived' })")
  })

  it('réactivation conduite sur status=auto_archived uniquement — jamais merged', () => {
    const src = codeOf(RESOLVE_SRC)
    // La réactivation ne doit toucher que les auto_archived
    expect(src).toContain("eq('status', 'auto_archived')")
    expect(src).toContain("update({ status: 'active' })")
    // Le résolveur cherche active ET auto_archived, pas merged
    expect(src).toContain("'auto_archived'")
    expect(src).not.toContain("'merged'")
  })

  it('le résolveur récupère active + auto_archived en une requête, mais résout active en priorité (P4-D1.1)', () => {
    const src = codeOf(RESOLVE_SRC)
    // Une seule requête DB : in('status', ['active', 'auto_archived'])
    expect(src).toContain("in('status', ['active', 'auto_archived'])")
    // Les deux pools sont ensuite séparés avant résolution — jamais fusionnés
    expect(src).toContain("s.status === 'active'")
    expect(src).toContain("s.status === 'auto_archived'")
    // Le pool actif est résolu avant tout repli sur le pool archivé
    const activeCallIdx = src.indexOf('matchCanonicalSubjects(queryText, activeSubjects)')
    const archivedCallIdx = src.indexOf('matchCanonicalSubjects(queryText, archivedSubjects)')
    expect(activeCallIdx).toBeGreaterThan(0)
    expect(archivedCallIdx).toBeGreaterThan(activeCallIdx)
    // Mêmes seuils Jaccard pour les deux pools — un seul jeu de passes, appelé deux fois
    const JACCARD_THRESHOLD_COUNT = (src.match(/JACCARD_THRESHOLD/g) ?? []).length
    expect(JACCARD_THRESHOLD_COUNT).toBeLessThanOrEqual(4) // défini 1 fois, utilisé au plus 3
  })

  it('un sujet actif ne collisionne plus avec un sujet auto_archived du même libellé (P4-D1.1)', () => {
    const src = codeOf(RESOLVE_SRC)
    // Le pool archivé n'est consulté qu'en repli sur not_found du pool actif —
    // jamais fusionné avec le pool actif dans un seul passage de passes.
    expect(src).toContain("if (activeResult.kind !== 'not_found') return activeResult")
  })

  it('autoArchiveOrphanedSubjects est appelé dans le pipeline debrief après réconciliation', () => {
    const src = codeOf(DEBRIEF_SRC)
    const archiveIdx = src.indexOf('autoArchiveOrphanedSubjects')
    const reconcileIdx = src.indexOf('reconcileSourceToCanonicalSubjects')
    expect(archiveIdx, 'autoArchiveOrphanedSubjects introuvable dans debrief-analysis').toBeGreaterThan(0)
    expect(archiveIdx, 'archivage doit suivre la réconciliation').toBeGreaterThan(reconcileIdx)
  })
})
