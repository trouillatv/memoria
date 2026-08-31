import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── D6 — convergence P0.5-Vérité pour « Activité récente » ──────────────────
//
// Avant : `preparationActivities` (site-brief-actions.ts) traitait tout report
// à origin non-null, y COMPRIS origin='import', comme une activité récente —
// un PV historique importé le 27/08 s'affichait « Visite terrain — 27 août »
// alors que son contenu réel datait de 2024/2025. Après : la construction
// converge vers les primitives partagées déjà utilisées par getSiteRecentActivity
// (isTerrainVisitOrigin/isImportedDocumentOrigin), via buildPreparationActivities.
//
// Ce fichier garde deux garanties que les tests comportementaux de
// buildPreparationActivities (tests/lib/visit-preparation.test.ts) ne couvrent
// pas : (4) les imports restent visibles dans leurs surfaces documentaires —
// on n'a pas touché au chargement des documents/proposals/occurrences pour
// « corriger » Activité récente — et (5) aucune écriture n'a été introduite
// dans le calcul (read-model pur).

const BRIEF = 'app/(dashboard)/sites/[id]/site-brief-actions.ts'
const briefSrc = readFileSync(join(process.cwd(), BRIEF), 'utf8')

const PREP = 'lib/knowledge/visit-preparation.ts'
const prepSrc = readFileSync(join(process.cwd(), PREP), 'utf8')

describe('D6 — Activité récente converge vers P0.5-Vérité', () => {
  it('preparationActivities est construit via la primitive partagée buildPreparationActivities', () => {
    expect(briefSrc).toMatch(/buildPreparationActivities\(/)
    expect(briefSrc).not.toMatch(/const isVisit = r\.origin != null/)
  })

  it('buildPreparationActivities exclut origin=import via les primitives P0.5, sans règle locale', () => {
    const fn = prepSrc.slice(
      prepSrc.indexOf('export function buildPreparationActivities'),
      prepSrc.indexOf('export function buildPreparationActivities') + 1200,
    )
    expect(fn).toMatch(/isImportedDocumentOrigin\(r\.origin\)/)
    expect(fn).toMatch(/isTerrainVisitOrigin\(r\.origin\)/)
  })

  it('buildPreparationActivities est un read-model pur : aucune écriture', () => {
    const fn = prepSrc.slice(
      prepSrc.indexOf('export function buildPreparationActivities'),
      prepSrc.indexOf('export function resolveVisitPreparationPhase'),
    )
    expect(fn).not.toMatch(/\.(update|insert|upsert|delete)\(/)
    expect(fn).not.toMatch(/createAdminClient|createClient/)
  })

  it('les surfaces documentaires (Documents/Chronologie) du brief restent chargées sans filtre origin', () => {
    // listDocumentsForTarget alimente le bloc `proofs` (Documents/Preuves) —
    // les PV historiques importés doivent y rester visibles, D6 ne touche pas
    // à ce chargement.
    expect(briefSrc).toMatch(/listDocumentsForTarget\('site', siteId\)/)
  })

  it("objets/propositions/occurrences (liveDebrief, proposals) restent chargés sans filtre origin ajouté", () => {
    // buildLiveDebrief et listProposalsBySite sont les sources d'objets suivis /
    // propositions / occurrences de ce brief — D6 ne les modifie pas.
    expect(briefSrc).toMatch(/buildLiveDebrief\(siteId, auth\.userId\)/)
    expect(briefSrc).toMatch(/listProposalsBySite\(siteId, \{ status: \['proposed'\] \}\)/)
  })
})
