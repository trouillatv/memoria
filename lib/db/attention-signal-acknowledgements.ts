import 'server-only'

// Débrief D3 — persistance de l'acquittement ("Vu") d'un signal informationnel
// canonical (mig 373). Un ack ne représente jamais un statut métier : il ne
// modifie ni canonical_subject, ni Action/Échéance/Réserve, ni Planning.
//
// signal_key = canonicalSubjectId + ensemble trié des CanonicalSignal (cf.
// buildDebriefSignalKey, lib/knowledge/live-debrief.ts). org_id porté
// explicitement (cloisonnement tenant garanti par le contrat de données, pas
// seulement déduit de site_id).

import { createAdminClient } from '@/lib/supabase/admin'

async function getSiteOrganizationId(siteId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('sites').select('organization_id').eq('id', siteId).maybeSingle()
  return (data?.organization_id as string | undefined) ?? null
}

/**
 * Idempotent : un deuxième appel sur le même (site, user, signalKey) met à jour
 * `seen_at`, ne crée jamais une deuxième ligne (upsert sur l'unicité
 * organization_id+site_id+user_id+signal_key, mig 373).
 */
export async function markAttentionSignalSeen(input: {
  siteId: string
  userId: string
  signalKey: string
}): Promise<void> {
  const organizationId = await getSiteOrganizationId(input.siteId)
  if (!organizationId) return
  const admin = createAdminClient()
  await admin
    .from('attention_signal_acknowledgements')
    .upsert(
      {
        organization_id: organizationId,
        site_id: input.siteId,
        user_id: input.userId,
        signal_key: input.signalKey,
        seen_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,site_id,user_id,signal_key' },
    )
}

/**
 * Clés déjà vues par CET utilisateur sur CE chantier. `site_id` détermine un
 * `organization_id` unique (FK) : filtrer par site+user suffit à garantir le
 * cloisonnement tenant en lecture, sans colonne supplémentaire à joindre.
 */
export async function getAttentionSignalAcks(siteId: string, userId: string): Promise<Set<string>> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('attention_signal_acknowledgements')
    .select('signal_key')
    .eq('site_id', siteId)
    .eq('user_id', userId)
  return new Set(((data ?? []) as Array<{ signal_key: string }>).map((r) => r.signal_key))
}
