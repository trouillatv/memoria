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
