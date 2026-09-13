import 'server-only'

// Points, Couche 1.1 « Mémoire de revue » (mig 405) — persistance de la DERNIÈRE VERSION revue
// d'un Point pour un utilisateur donné. Une revue ne représente jamais un statut métier : elle
// ne modifie ni tracked_point, ni son état dérivé, ni aucune Action/Échéance/Réserve.
//
// review_fingerprint est TOUJOURS calculé par computeTrackedPointReviewFingerprint
// (lib/knowledge/tracked-point-review.ts) — jamais fourni par l'appelant/le client. Pour une
// revue déclenchée par un geste métier, l'appelant doit invoquer `recordTrackedPointReview`
// UNIQUEMENT après le succès du geste, avec un fingerprint recalculé sur l'état POST-écriture.

import { createAdminClient } from '@/lib/supabase/admin'

async function getSiteOrganizationId(siteId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
  return (data?.organization_id as string | undefined) ?? null
}

export interface TrackedPointReviewRecord {
  fingerprint: string
  reviewedAt: string
}

/**
 * Dernière revue enregistrée par CET utilisateur sur CE chantier, indexée par tracked_point_id.
 * `site_id` détermine un `organization_id` unique (FK) : filtrer par site+user suffit à
 * garantir le cloisonnement tenant en lecture, sans colonne supplémentaire à joindre (même
 * convention que getAttentionSignalAcks, lib/db/attention-signal-acknowledgements.ts).
 */
export async function getTrackedPointReviews(siteId: string, userId: string): Promise<Map<string, TrackedPointReviewRecord>> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('tracked_point_reviews')
    .select('tracked_point_id, review_fingerprint, reviewed_at')
    .eq('site_id', siteId)
    .eq('user_id', userId)
  const byPointId = new Map<string, TrackedPointReviewRecord>()
  for (const row of (data ?? []) as Array<{ tracked_point_id: string; review_fingerprint: string; reviewed_at: string }>) {
    byPointId.set(row.tracked_point_id, { fingerprint: row.review_fingerprint, reviewedAt: row.reviewed_at })
  }
  return byPointId
}

/**
 * Idempotent : un deuxième appel sur le même (site, user, trackedPointId) met à jour
 * `review_fingerprint`/`reviewed_at`, ne crée jamais une deuxième ligne (upsert sur l'unicité
 * organization_id+site_id+user_id+tracked_point_id, mig 405).
 */
export async function recordTrackedPointReview(input: {
  siteId: string
  userId: string
  trackedPointId: string
  reviewFingerprint: string
}): Promise<void> {
  const organizationId = await getSiteOrganizationId(input.siteId)
  if (!organizationId) return
  const admin = createAdminClient()
  await admin
    .from('tracked_point_reviews')
    .upsert(
      {
        organization_id: organizationId,
        site_id: input.siteId,
        user_id: input.userId,
        tracked_point_id: input.trackedPointId,
        review_fingerprint: input.reviewFingerprint,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,site_id,user_id,tracked_point_id' },
    )
}
