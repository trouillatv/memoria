'use server'

// Couche 1.1 « Mémoire de revue » (mandat Vincent, mig 405) — geste explicite
// « ✓ Revu, rien à faire ». Ne modifie jamais tracked_point ni son état dérivé : enregistre
// uniquement que CET utilisateur a examiné ce Point dans son état COURANT.
//
// Le fingerprint n'est JAMAIS fourni par le client : il est recalculé ici, côté serveur, en
// rechargeant l'état courant du Point via `loadSiteTrackedPointList` — la même voie de lecture
// que la file « À revoir », donc la même primitive pure `computeTrackedPointReviewFingerprint`
// (lib/knowledge/tracked-point-review.ts). Aucune 2e logique de calcul.

import { getCurrentUserWithProfile } from '@/lib/db/users'
import { requireOwned } from '@/lib/auth/ownership'
import { loadSiteTrackedPointList } from '@/lib/knowledge/tracked-point-list'
import { recordTrackedPointReview } from '@/lib/db/tracked-point-reviews'

async function requireSiteReadAccess(siteId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  const owned = await requireOwned(user.role, 'sites', siteId, user)
  if (!owned.allowed) return { ok: false, error: 'Accès refusé' }
  return { ok: true, userId: user.id }
}

export async function recordPointReviewedAction(
  siteId: string,
  pointId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireSiteReadAccess(siteId)
  if (!access.ok) return access

  const list = await loadSiteTrackedPointList(siteId, access.userId)
  const point = list.points.find((p) => p.id === pointId)
  if (!point) return { ok: false, error: 'Point introuvable sur ce chantier.' }
  if (point.reviewFingerprint === null) return { ok: false, error: 'Rien à revoir sur ce Point actuellement.' }

  await recordTrackedPointReview({
    siteId,
    userId: access.userId,
    trackedPointId: pointId,
    reviewFingerprint: point.reviewFingerprint,
  })
  return { ok: true }
}

// Revue implicite (mandat Vincent, mini-lot « geste métier = revue implicite ») : certains gestes
// métier prouvent que David vient d'examiner ce Point dans son état courant (marquer une Action
// traitée, rouvrir, modifier responsable/entreprise/échéance). On enregistre alors la revue avec
// le fingerprint recalculé APRÈS l'écriture métier — jamais celui d'avant (sinon le Point
// ressortirait instantanément dans « À revoir » alors que David vient de le traiter).
//
// Best-effort et silencieux : appelé APRÈS le succès du geste métier lui-même, dont le résultat ne
// doit jamais être conditionné à cette écriture secondaire. Si le Point n'a plus rien à revoir
// (fingerprint devenu null), il n'y a rien à enregistrer — ce n'est jamais une erreur.
export async function recordPointReviewedAfterGesture(siteId: string, pointId: string): Promise<void> {
  const access = await requireSiteReadAccess(siteId)
  if (!access.ok) return

  const list = await loadSiteTrackedPointList(siteId, access.userId)
  const point = list.points.find((p) => p.id === pointId)
  if (!point || point.reviewFingerprint === null) return

  await recordTrackedPointReview({
    siteId,
    userId: access.userId,
    trackedPointId: pointId,
    reviewFingerprint: point.reviewFingerprint,
  })
}
