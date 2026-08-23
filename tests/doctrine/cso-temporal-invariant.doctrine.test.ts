import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── INVARIANT TEMPOREL DES canonical_subject_occurrence ──────────────────────
//
// Propriété fondamentale de l'histoire MemorIA :
//
//   L'histoire représente QUAND les choses se sont produites,
//   pas quand MemorIA les a apprises ou quand quelqu'un a corrigé le CR.
//
// Scénario de référence (8 cas) :
//   1. Visite du 20/07 analysée → occurrences créées à effective_date=20/07
//   2. Visites ultérieures 10/08 et 11/08
//   3. Le 12/08, modification du CR du 20/07
//   4. Ajout d'une information → appartient au 20/07, pas au 12/08
//   5. Modification d'une information → ancienne preuve remplacée/superseded
//   6. Suppression → ancienne preuve ne participe plus à l'état
//   7. Aucune fausse occurrence créée au 12/08
//   8. Évolution recalculée sur la nouvelle histoire
//
// Ce test vérifie les garde-fous statiques (lecture de code).
// Les cas 1-8 sont validés par l'implémentation de reconcileConfirmedOccurrences.

const RECONCILE = 'lib/db/visit-impact-reconcile.ts'
const LIFE = 'lib/db/canonical-subject-life.ts'
const SOURCE_RECONCILE = 'lib/db/canonical-subject-source-reconcile.ts'

function src(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
}

describe('Invariant temporel — effective_date ≠ date de modification', () => {
  const reconcileSrc = src(RECONCILE)
  const lifeSrc = src(LIFE)

  it('reconcileConfirmedOccurrences ne met jamais à jour effective_date', () => {
    // effective_date = date métier de la visite. Toute écriture de effective_date
    // dans la réconciliation créerait une fausse évolution à la date de correction.
    const afterFn = reconcileSrc.slice(reconcileSrc.indexOf('reconcileConfirmedOccurrences'))
    expect(afterFn).not.toContain("'effective_date'")
    expect(afterFn).not.toContain('"effective_date"')
  })

  it('reconcileConfirmedOccurrences est exportée et appelée depuis reconcileObsoleteProposals', () => {
    expect(reconcileSrc).toContain('export async function reconcileConfirmedOccurrences')
    expect(reconcileSrc).toContain('await reconcileConfirmedOccurrences(')
  })

  it("reconcileConfirmedOccurrences filtre par source_ref_id pour trouver les remplaçants du MÊME rapport", () => {
    // Sans ce filtre, on risquerait de fusionner une occurrence d'un autre rapport,
    // ce qui déplacerait un fait vers une date erronée.
    const afterFn = reconcileSrc.slice(reconcileSrc.indexOf('reconcileConfirmedOccurrences'))
    expect(afterFn).toContain("'source_ref_id'")
    expect(afterFn).toContain('reportId')
  })

  it("la suppression du doublon observed est gardée par validation_status='observed'", () => {
    // Si la garde est absente, on risque de supprimer une occurrence confirmed
    // qui aurait été rerattachée par une autre branche de la logique.
    const deleteBlock = reconcileSrc.slice(reconcileSrc.indexOf('Suppression du doublon'))
    expect(deleteBlock).toContain("'observed'")
  })

  it("la mise à 'source_superseded' est idempotente — filtre sur 'confirmed'", () => {
    // Sans ce filtre, un deuxième passage marquerait une occurrence déjà source_superseded
    // ou une observed différente, cassant l'idempotence.
    const ssBlock = reconcileSrc.slice(reconcileSrc.indexOf("source_superseded"))
    expect(ssBlock).toContain("'confirmed'")
  })

  it("les requêtes d'évolution excluent 'source_superseded' dans canonical-subject-life", () => {
    // Les occurrences source_superseded ne doivent jamais apparaître dans les timelines
    // d'évolution — elles représentent des preuves dont la source a été corrigée.
    const matches = [...lifeSrc.matchAll(/neq\('validation_status'/g)]
    expect(matches, 'Toutes les requêtes doivent utiliser .not(\'validation_status\', \'in\', ...) pour exclure rejected ET source_superseded').toHaveLength(0)
  })

  it("les requêtes d'évolution utilisent le NOT IN sur les deux statuts exclus", () => {
    const notInPattern = /not\('validation_status',\s*'in',\s*'\("rejected","source_superseded"\)'\)/g
    const notInCount = [...lifeSrc.matchAll(notInPattern)].length
    expect(notInCount, 'Au moins 4 requêtes dans canonical-subject-life doivent exclure les deux statuts').toBeGreaterThanOrEqual(4)
  })

  it("'source_superseded' est un statut connu dans la migration de schéma", () => {
    const migrationSrc = src('supabase/migrations/312_cso_temporal_reconciliation.sql')
    expect(migrationSrc).toContain('source_superseded')
    expect(migrationSrc).toContain('updated_at')
  })
})

// ── Le même invariant, côté CRÉATION ─────────────────────────────────────────
//
// Les tests ci-dessus gardent le chemin UPDATE (visit-impact-reconcile).
// Ils ne voyaient donc pas le chemin INSERT, où l'audit PRODUCT-DEAD-BRIDGES
// a mesuré 42/84 occurrences terrain mal datées : un unique site d'écriture
// sur six recalculait `new Date()` au lieu de réutiliser `occEffectiveDate`,
// déjà calculé depuis started_at/created_at du rapport.
//
// La garde porte sur la propriété, pas sur la ligne : TOUTE écriture de
// effective_date dans reconcileSourceToCanonicalSubjects doit être la constante
// partagée. Une nouvelle branche d'écriture qui recalculerait la date échoue ici.

describe('Invariant temporel — effective_date à la CRÉATION des occurrences', () => {
  const srcReconcile = src(SOURCE_RECONCILE)
  const FN = 'export async function reconcileSourceToCanonicalSubjects'
  const body = srcReconcile.slice(srcReconcile.indexOf(FN))

  it('occEffectiveDate dérive du rapport, pas de la date du jour', () => {
    expect(body).toMatch(/const occEffectiveDate = \(rm\?\.started_at \?\? rm\?\.created_at/)
  })

  it('tous les sites d’écriture de effective_date utilisent occEffectiveDate', () => {
    const writes = [...body.matchAll(/effective_date:\s*([^,\n]+)/g)].map((m) => m[1].trim())
    expect(writes.length, 'au moins un site d’écriture doit exister').toBeGreaterThanOrEqual(5)
    const deviants = writes.filter((v) => v !== 'occEffectiveDate')
    expect(deviants, `effective_date doit toujours valoir occEffectiveDate — trouvé : ${deviants.join(' | ')}`).toEqual([])
  })

  it('aucun effective_date n’est calculé depuis new Date() dans le fichier', () => {
    const inline = [...srcReconcile.matchAll(/effective_date:\s*new Date\(/g)]
    expect(inline, 'une occurrence datée du jour de l’analyse fabrique une fausse évolution').toHaveLength(0)
  })
})
