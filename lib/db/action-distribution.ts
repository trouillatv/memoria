// lib/db/action-distribution.ts
//
// Distribution d'actions à une entreprise via lien/QR (migration 148).
// Le PV produit des actions ; on confie à UNE entreprise SA liste, qu'elle
// coche (Fait / Impossible + commentaire + photo + signature). Le retour
// remonte dans la mémoire du chantier → le MOE cible ses visites.
//
// Patron : identique à intervention-tokens.ts (même doctrine).
//   - token = permission, pas identité ;
//   - recipient_label = l'entreprise, jamais un salarié (anti-pointage) ;
//   - périmètre strict : l'externe ne touche QUE les actions du lot ;
//   - admin client partout (RLS service_role pour ces tables).

import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ActionDistribution {
  id: string
  token: string
  site_id: string
  report_id: string | null
  recipient_label: string
  company_id: string | null
  note: string | null
  created_by: string | null
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  submitted_at: string | null
  submitted_by_name: string | null
  signature_data_url: string | null
}

export type DeclaredStatus = 'pending' | 'done' | 'blocked'

export interface DistributionActionItem {
  action_id: string
  title: string
  body: string | null
  corps_etat: string | null
  due_date: string | null
  /** Demande de preuve : « fait » exige une photo. Doctrine « montre-moi ». */
  requires_proof_photo: boolean
  declared_status: DeclaredStatus
  declared_comment: string | null
  declared_photo_path: string | null
  declared_at: string | null
}

export interface DistributionData {
  siteName: string
  siteAddress: string | null
  items: DistributionActionItem[]
}

export type DistributionResult =
  | null
  | { state: 'revoked' }
  | { state: 'expired' }
  | { state: 'active'; distribution: ActionDistribution; data: DistributionData }

// ── Read ──────────────────────────────────────────────────────────────────

/**
 * Résout un token public vers son lot d'actions.
 *  - null                  → token inexistant
 *  - { state: 'revoked' }  → révoqué
 *  - { state: 'expired' }  → expiré
 *  - { state: 'active', … } → actif (entreprise + ses actions scopées)
 */
export async function getDistributionByToken(token: string): Promise<DistributionResult> {
  const supabase = createAdminClient()

  const { data: dist } = await supabase
    .from('action_distributions')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (!dist) return null
  const d = dist as ActionDistribution
  if (d.revoked_at) return { state: 'revoked' }
  if (d.expires_at && new Date(d.expires_at) < new Date()) return { state: 'expired' }

  const { data: site } = await supabase
    .from('sites')
    .select('name, address')
    .eq('id', d.site_id)
    .maybeSingle()

  // Le périmètre = les actions du lot, enrichies du libellé de l'action.
  const { data: itemRows } = await supabase
    .from('action_distribution_items')
    .select('action_id, requires_proof_photo, declared_status, declared_comment, declared_photo_path, declared_at')
    .eq('distribution_id', d.id)
  const items = (itemRows ?? []) as Array<{
    action_id: string
    requires_proof_photo: boolean
    declared_status: DeclaredStatus
    declared_comment: string | null
    declared_photo_path: string | null
    declared_at: string | null
  }>

  const actionIds = items.map((r) => r.action_id)
  const actionById = new Map<string, { title: string; body: string | null; corps_etat: string | null; due_date: string | null }>()
  if (actionIds.length > 0) {
    const { data: actionRows } = await supabase
      .from('site_actions')
      .select('id, title, body, corps_etat, due_date')
      .in('id', actionIds)
    for (const a of (actionRows ?? []) as Array<{ id: string; title: string; body: string | null; corps_etat: string | null; due_date: string | null }>) {
      actionById.set(a.id, { title: a.title, body: a.body, corps_etat: a.corps_etat, due_date: a.due_date })
    }
  }

  const merged: DistributionActionItem[] = items.map((r) => {
    const a = actionById.get(r.action_id)
    return {
      action_id: r.action_id,
      title: a?.title ?? '—',
      body: a?.body ?? null,
      corps_etat: a?.corps_etat ?? null,
      due_date: a?.due_date ?? null,
      requires_proof_photo: r.requires_proof_photo,
      declared_status: r.declared_status,
      declared_comment: r.declared_comment,
      declared_photo_path: r.declared_photo_path,
      declared_at: r.declared_at,
    }
  })

  return {
    state: 'active',
    distribution: d,
    data: {
      siteName: (site as { name: string } | null)?.name ?? '—',
      siteAddress: (site as { address: string | null } | null)?.address ?? null,
      items: merged,
    },
  }
}

/** Lots d'actions d'une réunion (pour la fiche réunion / révocation). */
export async function listDistributionsForReport(reportId: string): Promise<ActionDistribution[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('action_distributions')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ActionDistribution[]
}

/** IDs des actions déjà confiées à un lot ACTIF (non révoqué) du site.
 *  Sert la règle « 0 ou 1 entreprise par action » côté sélecteur de partage. */
export async function listDistributedActionIds(siteId: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data: dists } = await supabase
    .from('action_distributions')
    .select('id')
    .eq('site_id', siteId)
    .is('revoked_at', null)
  const ids = ((dists ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('action_distribution_items')
    .select('action_id')
    .in('distribution_id', ids)
  if (error) throw error
  return [...new Set(((data ?? []) as Array<{ action_id: string }>).map((r) => r.action_id))]
}

// ── Write ─────────────────────────────────────────────────────────────────

export async function createActionDistribution(input: {
  siteId: string
  reportId?: string | null
  recipientLabel: string
  companyId?: string | null
  note?: string | null
  createdBy: string
  expiresAt?: string | null
  /** Actions du lot + demande de preuve par action (photo requise pour clôturer). */
  actions: Array<{ actionId: string; requiresProofPhoto?: boolean }>
}): Promise<ActionDistribution> {
  const supabase = createAdminClient()
  const token = crypto.randomBytes(24).toString('base64url')

  const { data, error } = await supabase
    .from('action_distributions')
    .insert({
      token,
      site_id: input.siteId,
      report_id: input.reportId ?? null,
      recipient_label: input.recipientLabel,
      company_id: input.companyId ?? null,
      note: input.note ?? null,
      created_by: input.createdBy,
      expires_at: input.expiresAt ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  const dist = data as ActionDistribution

  // Dédup par action_id (garde la 1re demande de preuve rencontrée).
  const byId = new Map<string, boolean>()
  for (const a of input.actions) {
    if (!a.actionId || byId.has(a.actionId)) continue
    byId.set(a.actionId, a.requiresProofPhoto ?? true)
  }
  if (byId.size > 0) {
    const rows = [...byId].map(([action_id, requires_proof_photo]) => ({
      distribution_id: dist.id,
      action_id,
      requires_proof_photo,
    }))
    const { error: itemErr } = await supabase.from('action_distribution_items').insert(rows)
    if (itemErr) throw itemErr
  }
  return dist
}

/**
 * Enregistre la déclaration externe d'une entreprise (preuve, pas clôture).
 * Pour chaque action DU PÉRIMÈTRE répondue : écrit la ligne d'item (statut /
 * commentaire / photo) ET recopie la surcouche dénormalisée sur site_actions.
 * Le statut interne de l'action n'est jamais touché (le MOE garde la main).
 * Pose enfin la signature + l'identité sur la distribution.
 */
export async function submitDistributionDeclaration(input: {
  distributionId: string
  recipientLabel: string
  submittedByName: string
  signatureDataUrl: string
  declarations: Array<{
    actionId: string
    status: 'done' | 'blocked'
    comment?: string | null
    photoPath?: string | null
  }>
}): Promise<void> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // Périmètre autorisé : on ne retient QUE les actions réellement dans le lot.
  const { data: scopeRows } = await supabase
    .from('action_distribution_items')
    .select('action_id')
    .eq('distribution_id', input.distributionId)
  const allowed = new Set(((scopeRows ?? []) as Array<{ action_id: string }>).map((r) => r.action_id))

  for (const dec of input.declarations) {
    if (!allowed.has(dec.actionId)) continue // garde-fou : hors périmètre = ignoré
    const { error: itemErr } = await supabase
      .from('action_distribution_items')
      .update({
        declared_status: dec.status,
        declared_comment: dec.comment ?? null,
        declared_photo_path: dec.photoPath ?? null,
        declared_at: now,
      })
      .eq('distribution_id', input.distributionId)
      .eq('action_id', dec.actionId)
    if (itemErr) throw itemErr

    // Surcouche dénormalisée (surfaçage). N'altère jamais `status`.
    const { error: actErr } = await supabase
      .from('site_actions')
      .update({
        ext_status: dec.status,
        ext_comment: dec.comment ?? null,
        ext_photo_path: dec.photoPath ?? null,
        ext_at: now,
        ext_by: input.recipientLabel,
      })
      .eq('id', dec.actionId)
    if (actErr) throw actErr
  }

  const { error } = await supabase
    .from('action_distributions')
    .update({
      submitted_at: now,
      submitted_by_name: input.submittedByName,
      signature_data_url: input.signatureDataUrl,
    })
    .eq('id', input.distributionId)
  if (error) throw error
}

/** Audit silencieux — appel non bloquant depuis la page publique. */
export async function recordDistributionAccess(token: string): Promise<void> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('action_distributions')
    .select('id, access_count')
    .eq('token', token)
    .maybeSingle()
  const row = data as { id: string; access_count: number } | null
  if (!row) return
  await supabase
    .from('action_distributions')
    .update({ accessed_at: new Date().toISOString(), access_count: (row.access_count ?? 0) + 1 })
    .eq('id', row.id)
}

export async function revokeActionDistribution(distributionId: string, revokedBy: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('action_distributions')
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy })
    .eq('id', distributionId)
  if (error) throw error
}
