// V5.1 Slice 4 — Helpers DB pour les capsules WhatsApp.
//
// Doctrine Vincent 2026-05-14 :
//   - Une capsule = un proof_share_token avec presentation_kind ∈
//     {monthly_capsule, incident_capsule} + payload spécifique.
//   - Aucune nouvelle table (cf. migration 050 minimale, ~10 lignes).
//   - Patrick reste expéditeur côté WhatsApp via wa.me — l'app ne fait JAMAIS
//     d'envoi automatique.
//
// Cf. plan V5.1.2 § Slice 4 + migrations 022 / 026 / 050.

import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ProofShareToken } from '@/lib/db/proof-share'

const TOKEN_BYTES = 24
const DEFAULT_CAPSULE_DURATION_DAYS = 30 // capsule mensuelle = horizon long
const MAX_DURATION_DAYS = 30

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function clampDuration(d: number | undefined): number {
  if (!d || d <= 0) return DEFAULT_CAPSULE_DURATION_DAYS
  return Math.min(MAX_DURATION_DAYS, Math.floor(d))
}

function expiresAtFromNow(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

// ============================================================================
// Capsule mensuelle
// ============================================================================

export interface CreateMonthlyCapsuleInput {
  contractId: string
  /** Format YYYY-MM. */
  reportMonth: string
  /** Photo unique sélectionnée par Patrick (1 photo seulement pour la capsule
   *  vs 1..12 pour le rapport mensuel legacy). */
  photoId: string
  /** Phrase descriptive figée — déjà générée par renderMonthlyCapsule. */
  dgNote: string
  durationDays?: number
  createdBy?: string | null
}

export async function createMonthlyCapsule(
  input: CreateMonthlyCapsuleInput,
): Promise<ProofShareToken> {
  const supabase = createAdminClient()
  const days = clampDuration(input.durationDays)

  const { data, error } = await supabase
    .from('proof_share_tokens')
    .insert({
      token: generateToken(),
      contract_id: input.contractId,
      report_month: input.reportMonth,
      selected_photo_ids: [input.photoId],
      dg_note: input.dgNote,
      presentation_kind: 'monthly_capsule',
      expires_at: expiresAtFromNow(days),
      include_identities: false,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ProofShareToken
}

// ============================================================================
// Capsule incident résolu
// ============================================================================

export interface CreateIncidentCapsuleInput {
  interventionId: string
  /** 1 ou 2 photos (avant/après ou seulement après). */
  photoIds: string[]
  /** Phrase descriptive figée — déjà générée par renderIncidentCapsule. */
  dgNote: string
  durationDays?: number
  createdBy?: string | null
}

export async function createIncidentCapsule(
  input: CreateIncidentCapsuleInput,
): Promise<ProofShareToken> {
  if (input.photoIds.length === 0 || input.photoIds.length > 2) {
    throw new Error('createIncidentCapsule: photoIds doit contenir 1 ou 2 photos')
  }
  const supabase = createAdminClient()
  const days = clampDuration(input.durationDays)

  const { data, error } = await supabase
    .from('proof_share_tokens')
    .insert({
      token: generateToken(),
      intervention_id: input.interventionId,
      selected_photo_ids: input.photoIds,
      dg_note: input.dgNote,
      presentation_kind: 'incident_capsule',
      expires_at: expiresAtFromNow(days),
      include_identities: false,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ProofShareToken
}

// ============================================================================
// Récupération côté page publique /c/[token]
// ============================================================================

export interface CapsulePublicView {
  token: ProofShareToken
  /** Signed URLs des photos sélectionnées (ordre préservé). */
  photoUrls: string[]
  /** Texte descriptif figé. */
  text: string
  /** Nom du tenant émetteur pour le footer "Émis par X". */
  tenantName: string
}

const PHOTO_BUCKET = 'intervention-photos'
const SIGNED_URL_EXPIRY = 3600 // 1h

/**
 * Récupère les données nécessaires au rendu de la page publique capsule.
 * Renvoie null si le token n'est pas une capsule (presentation_kind ≠
 * 'monthly_capsule' / 'incident_capsule'), si révoqué, ou expiré.
 */
export async function getCapsulePublicView(
  token: string,
): Promise<CapsulePublicView | null> {
  const supabase = createAdminClient()
  const { data: tokenRow, error } = await supabase
    .from('proof_share_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  if (!tokenRow) return null
  const t = tokenRow as ProofShareToken

  // Filtres : doit être une capsule active
  if (t.presentation_kind !== 'monthly_capsule' && t.presentation_kind !== 'incident_capsule') {
    return null
  }
  if (t.revoked_at) return null
  if (new Date(t.expires_at).getTime() < Date.now()) return null

  // Récupère les photos via storage_path
  const photoIds = t.selected_photo_ids ?? []
  let photoUrls: string[] = []
  if (photoIds.length > 0) {
    const { data: photos } = await supabase
      .from('intervention_photos')
      .select('id, storage_path')
      .in('id', photoIds)
    const byId = new Map((photos ?? []).map((p) => [p.id, p.storage_path]))
    // Préserve l'ordre choisi par Patrick (selected_photo_ids).
    const orderedPaths = photoIds.map((id) => byId.get(id)).filter((p): p is string => !!p)

    const signed = await Promise.all(
      orderedPaths.map(async (path) => {
        const { data: urlData } = await supabase.storage
          .from(PHOTO_BUCKET)
          .createSignedUrl(path, SIGNED_URL_EXPIRY)
        return urlData?.signedUrl ?? null
      }),
    )
    photoUrls = signed.filter((u): u is string => !!u)
  }

  // Tenant name — pour V5.1 mono-tenant pilote on hardcode "AGP" via un
  // setting environnement, mais l'architecture supporte multi-tenant plus
  // tard. Pour l'instant on lit l'env, fallback "Votre prestataire".
  const tenantName = process.env.NEXT_PUBLIC_TENANT_NAME ?? 'AGP'

  return {
    token: t,
    photoUrls,
    text: t.dg_note ?? '',
    tenantName,
  }
}
