// lib/db/intervention-tokens.ts
//
// Helpers pour intervention_tokens — liens sécurisés contextualisés vers
// une intervention précise. Philosophie : même patron que /h/[token].
//
// Doctrine :
//   - token = permission, pas identité
//   - jamais d'accès chantier complet — scope intervention uniquement
//   - admin client partout (RLS désactivé pour ces tables)

import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// ── Types ──────────────────────────────────────────────────────────────────

export interface InterventionToken {
  id: string
  token: string
  intervention_id: string
  permissions: string[]
  expires_at: string | null
  created_by: string | null
  created_at: string
  note: string | null
  recipient_label: string | null
  accessed_at: string | null
  access_count: number
  validated_at: string | null
  validated_by_name: string | null
  validation_comment: string | null
  revoked_at: string | null
  revoked_by: string | null
  // Preuve d'exécution externe (migration 105)
  signature_data_url: string | null
  signed_at: string | null
}

export interface InterventionTokenData {
  id: string
  status: string
  slot: string | null
  scheduled_for: string | null
  notes: string | null
  missionName: string
  siteName: string
  siteAddress: string | null
  checklistItems: Array<{
    id: string
    label: string
    position: number
    required: boolean
    done: boolean
  }>
}

export type InterventionTokenResult =
  | null
  | { state: 'revoked' }
  | { state: 'expired' }
  | { state: 'active'; token: InterventionToken; intervention: InterventionTokenData }

// ── Read ──────────────────────────────────────────────────────────────────

/**
 * Résout un token public vers son intervention.
 *
 * Retourne :
 *  - null           → token inexistant
 *  - { state: 'revoked' }  → révoqué
 *  - { state: 'expired' }  → expiré
 *  - { state: 'active', token, intervention } → actif
 */
export async function getInterventionByToken(
  token: string,
): Promise<InterventionTokenResult> {
  const supabase = createAdminClient()

  const { data: tok } = await supabase
    .from('intervention_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()

  if (!tok) return null
  if (tok.revoked_at) return { state: 'revoked' }
  if (tok.expires_at && new Date(tok.expires_at) < new Date()) return { state: 'expired' }

  const pickOne = <T>(v: T | T[] | null): T | null => {
    if (v === null) return null
    return Array.isArray(v) ? v[0] ?? null : v
  }

  const { data: intv } = await supabase
    .from('interventions')
    .select(
      `id, status, slot, scheduled_for, notes,
       mission:missions!inner(name, site:sites!inner(id, name, address))`,
    )
    .eq('id', tok.intervention_id)
    .maybeSingle()

  if (!intv) return null

  type MissionRow = { name: string; site: { id: string; name: string; address: string | null } | { id: string; name: string; address: string | null }[] | null }
  const mission = pickOne(intv.mission as MissionRow | MissionRow[] | null)
  const site = pickOne(mission?.site ?? null)

  const { data: checklistRows } = await supabase
    .from('intervention_checklist_items')
    .select('id, label, position, required, done')
    .eq('intervention_id', tok.intervention_id)
    .order('position', { ascending: true })

  return {
    state: 'active',
    token: tok as InterventionToken,
    intervention: {
      id: intv.id as string,
      status: intv.status as string,
      slot: intv.slot as string | null,
      scheduled_for: intv.scheduled_for as string | null,
      notes: intv.notes as string | null,
      missionName: mission?.name ?? '—',
      siteName: site?.name ?? '—',
      siteAddress: site?.address ?? null,
      checklistItems: ((checklistRows ?? []) as Array<{
        id: string; label: string; position: number; required: boolean; done: boolean
      }>).map((r) => ({
        id: r.id,
        label: r.label,
        position: r.position,
        required: r.required,
        done: r.done,
      })),
    },
  }
}

/** Liste les tokens actifs (non révoqués, non expirés) d'une intervention. */
export async function listTokensForIntervention(
  interventionId: string,
): Promise<InterventionToken[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_tokens')
    .select('*')
    .eq('intervention_id', interventionId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as InterventionToken[]
}

// ── Write ─────────────────────────────────────────────────────────────────

export async function createInterventionToken(input: {
  interventionId: string
  createdBy: string
  permissions?: string[]
  expiresAt?: string | null
  note?: string | null
  recipientLabel?: string | null
}): Promise<InterventionToken> {
  const supabase = createAdminClient()
  const token = crypto.randomBytes(24).toString('base64url')

  const { data, error } = await supabase
    .from('intervention_tokens')
    .insert({
      token,
      intervention_id: input.interventionId,
      permissions: input.permissions ?? ['read', 'comment', 'validate'],
      expires_at: input.expiresAt ?? null,
      created_by: input.createdBy,
      note: input.note ?? null,
      recipient_label: input.recipientLabel ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as InterventionToken
}

/** Tous les tokens d'une intervention (y compris révoqués), triés par date de création desc. */
export async function listAllTokensForIntervention(
  interventionId: string,
): Promise<InterventionToken[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_tokens')
    .select('*')
    .eq('intervention_id', interventionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as InterventionToken[]
}

/** Photos déposées par des intervenants externes (via /i/[token]), groupées
 *  par token. Sert la vue « Activités externes » de la fiche intervention. */
export async function listExternalPhotosByIntervention(
  interventionId: string,
): Promise<Array<{ id: string; storage_path: string; external_token_id: string }>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_photos')
    .select('id, storage_path, external_token_id')
    .eq('intervention_id', interventionId)
    .not('external_token_id', 'is', null)
    .order('taken_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Array<{ id: string; storage_path: string; external_token_id: string }>
}

/** Tokens validés pour une intervention — source des "Confirmations externes" dans la fiche. */
export async function listTokenValidationsForIntervention(
  interventionId: string,
): Promise<Array<{
  id: string
  recipient_label: string | null
  validated_at: string
  validated_by_name: string | null
  validation_comment: string | null
}>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('intervention_tokens')
    .select('id, recipient_label, validated_at, validated_by_name, validation_comment')
    .eq('intervention_id', interventionId)
    .not('validated_at', 'is', null)
    .order('validated_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Array<{
    id: string
    recipient_label: string | null
    validated_at: string
    validated_by_name: string | null
    validation_comment: string | null
  }>
}

/** Audit silencieux — appel non bloquant depuis la page publique. */
export async function recordInterventionTokenAccess(token: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.rpc('record_intervention_token_access', { p_token: token })
}

export async function validateInterventionToken(input: {
  tokenId: string
  validatedByName: string
  validationComment: string | null
}): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('intervention_tokens')
    .update({
      validated_at: new Date().toISOString(),
      validated_by_name: input.validatedByName,
      validation_comment: input.validationComment,
    })
    .eq('id', input.tokenId)
  if (error) throw error
}

export async function revokeInterventionToken(
  tokenId: string,
  revokedBy: string,
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('intervention_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy })
    .eq('id', tokenId)
  if (error) throw error
}
