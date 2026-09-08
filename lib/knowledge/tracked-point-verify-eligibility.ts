// POINT VERIFY MIGRATION (mandat Vincent, point 2 — Policy 4) — quels Points le panier mobile
// "Vérifier" doit-il proposer pour un chantier donné. Site-scopé via loadTrackedPointReadModel,
// aucune nouvelle traversée : réutilise le read-model existant (mêmes garanties que
// tracked-point-search.ts, dont ce module reprend le pattern).
//
// Policy 4 (aucun score, aucun LLM) :
//   - status !== 'active' (merged/retired) → exclu
//   - derivedState === 'resolved' → exclu (pas d'écran "historique/résolus" dans ce lot)
//   - identityStatus === 'CONFLICTED' → exclu par défaut dans ce lot
//   - identityStatus === 'CONFIRMED' → inclus
//   - identityStatus === 'PROVISIONAL' → inclus seulement si derivedState ∈ {open, reopened, conflict}
//     (PROVISIONAL + unknown reste exclu : trop faible pour proposer une vérification terrain)
//
// Tri déterministe (mandat point 7, aucun score inventé) :
//   1) Points déjà rattachés à un canonical_business_object (cboIds non vide)
//   2) reopened / conflict
//   3) open
//   4) confirmed + unknown
// Le rattachement "watchlist/attention" cité au mandat n'a aucune clé Point aujourd'hui
// (visit_watchlist_item ne référence ni canonical_subject_id ni tracked_point_id) : plutôt que
// d'inventer un matching flou, ce tri ne couvre que le signal réellement disponible (CBO).

import { loadTrackedPointReadModel, type PointReadModelEntry } from './tracked-point-read-model'

export type VerifyEligiblePoint = {
  pointId: string
  label: string
  subjectId: string | null
  derivedState: PointReadModelEntry['derivedState']
  identityStatus: PointReadModelEntry['identityStatus']
  isCboLinked: boolean
}

function isEligibleForVerify(p: PointReadModelEntry): boolean {
  if (p.status !== 'active') return false
  if (p.derivedState === 'resolved') return false
  if (p.identityStatus === 'CONFLICTED') return false
  if (p.identityStatus === 'CONFIRMED') return true
  if (p.identityStatus === 'PROVISIONAL') {
    return p.derivedState === 'open' || p.derivedState === 'reopened' || p.derivedState === 'conflict'
  }
  return false
}

function verifyTier(p: PointReadModelEntry): number {
  if (p.cboIds.length > 0) return 0
  if (p.derivedState === 'reopened' || p.derivedState === 'conflict') return 1
  if (p.derivedState === 'open') return 2
  return 3
}

export async function listVerifyEligiblePointsForSite(siteId: string): Promise<VerifyEligiblePoint[]> {
  const { points } = await loadTrackedPointReadModel(siteId)
  const eligible = points.filter(isEligibleForVerify)

  eligible.sort((a, b) => {
    const tierDelta = verifyTier(a) - verifyTier(b)
    if (tierDelta !== 0) return tierDelta
    return a.label.localeCompare(b.label)
  })

  return eligible.map((p) => ({
    pointId: p.id,
    label: p.label,
    subjectId: p.ownerCanonicalSubjectId,
    derivedState: p.derivedState,
    identityStatus: p.identityStatus,
    isCboLinked: p.cboIds.length > 0,
  }))
}
