// lib/db/proof-dossier.ts
//
// S3 — Dossier de preuve (VUE consolidée, pas de PDF). Montre la valeur du QR :
// pour chaque action déclarée par une entreprise, on assemble la chaîne complète
//   demande → entreprise → déclaration → commentaire → photo → signature → validation MOE
// à partir de la donnée DÉJÀ captée (mig 148). Aucune nouvelle table.
//
// Doctrine : la déclaration de l'entreprise et la validation du MOE restent DEUX
// vérités distinctes (la déclaration ne vaut pas validation terrain).

import { createAdminClient } from '@/lib/supabase/admin'

export interface ProofDossier {
  actionId: string
  actionTitle: string
  corpsEtat: string | null
  /** Demande de preuve posée à la création (photo requise pour clôturer). */
  requestedPhoto: boolean
  // — Entreprise + déclaration —
  recipientLabel: string
  declaredStatus: 'done' | 'blocked'
  declaredComment: string | null
  declaredPhotoPath: string | null
  declaredAt: string | null
  // — Signature (niveau lot) —
  submittedByName: string | null
  signatureDataUrl: string | null
  // — Validation MOE (statut interne, garde la main) —
  moeValidated: boolean
  moeValidatedAt: string | null
  moeComment: string | null
}

/** Dossiers de preuve d'un chantier : une entrée par action déclarée par une
 *  entreprise (la plus récente déclaration d'abord). */
export async function listSiteProofDossiers(siteId: string): Promise<ProofDossier[]> {
  const supabase = createAdminClient()

  const { data: dists } = await supabase
    .from('action_distributions')
    .select('id, recipient_label, submitted_by_name, submitted_at, signature_data_url')
    .eq('site_id', siteId)
  const distrows = (dists ?? []) as Array<{
    id: string; recipient_label: string; submitted_by_name: string | null
    submitted_at: string | null; signature_data_url: string | null
  }>
  if (distrows.length === 0) return []
  const distById = new Map(distrows.map((d) => [d.id, d]))

  const { data: items } = await supabase
    .from('action_distribution_items')
    .select('distribution_id, action_id, requires_proof_photo, declared_status, declared_comment, declared_photo_path, declared_at')
    .in('distribution_id', [...distById.keys()])
    .neq('declared_status', 'pending')
  const itemrows = (items ?? []) as Array<{
    distribution_id: string; action_id: string; requires_proof_photo: boolean
    declared_status: 'done' | 'blocked'; declared_comment: string | null
    declared_photo_path: string | null; declared_at: string | null
  }>
  if (itemrows.length === 0) return []

  const actionIds = [...new Set(itemrows.map((i) => i.action_id))]
  const { data: actions } = await supabase
    .from('site_actions')
    .select('id, title, corps_etat, status, done_at, completed_comment')
    .in('id', actionIds)
  const actionById = new Map(
    ((actions ?? []) as Array<{ id: string; title: string; corps_etat: string | null; status: string; done_at: string | null; completed_comment: string | null }>)
      .map((a) => [a.id, a]),
  )

  const dossiers: ProofDossier[] = itemrows.map((it) => {
    const dist = distById.get(it.distribution_id)
    const action = actionById.get(it.action_id)
    return {
      actionId: it.action_id,
      actionTitle: action?.title ?? '—',
      corpsEtat: action?.corps_etat ?? null,
      requestedPhoto: it.requires_proof_photo,
      recipientLabel: dist?.recipient_label ?? '—',
      declaredStatus: it.declared_status,
      declaredComment: it.declared_comment,
      declaredPhotoPath: it.declared_photo_path,
      declaredAt: it.declared_at,
      submittedByName: dist?.submitted_by_name ?? null,
      signatureDataUrl: dist?.signature_data_url ?? null,
      moeValidated: action?.status === 'done',
      moeValidatedAt: action?.done_at ?? null,
      moeComment: action?.completed_comment ?? null,
    }
  })

  return dossiers.sort((a, b) => (b.declaredAt ?? '').localeCompare(a.declaredAt ?? ''))
}
