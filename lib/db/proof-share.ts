// Slice B.3 — Helpers DB pour proof_share_tokens.
//
// Doctrine impérative :
//   - Token URL-safe, généré server-side via crypto.randomBytes(24).toString('base64url').
//     ~32 chars, non devinable.
//   - Expiration obligatoire. Default 7 jours, plafond applicatif 30 jours.
//   - includeIdentities = override admin (audit log obligatoire côté server action,
//     pas ici — ce helper se contente de matérialiser la valeur).
//   - Revoke = soft (revoked_at). Pas de delete (l'audit conserve la trace).
//   - recordShareAccess() est best-effort (un échec ne casse pas l'affichage public).
//
// Toutes les écritures passent par le service role (createAdminClient) car cette
// surface est appelée depuis des Server Actions privilégiées ou la route publique
// /p/[token] qui doit pouvoir lire le token avant même de connaître le user.

import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface CreateShareTokenInput {
  /** UUID de l'intervention à partager. */
  interventionId: string
  /** Durée de validité en jours. Default 7, max 30 (plafond applicatif). */
  durationDays?: number
  /** Override admin : true = identités visibles, false = anonymisé (default). */
  includeIdentities?: boolean
  /** Userid créateur (pour audit + traçabilité). Null possible si système. */
  createdBy?: string | null
}

export interface ProofShareToken {
  id: string
  token: string
  intervention_id: string
  created_at: string
  created_by: string | null
  expires_at: string
  revoked_at: string | null
  include_identities: boolean
  last_accessed_at: string | null
  access_count: number
}

// ----------------------------------------------------------------------------
// Constantes
// ----------------------------------------------------------------------------

const DEFAULT_DURATION_DAYS = 7
const MAX_DURATION_DAYS = 30
/** 24 octets → 32 chars base64url. Largement suffisant contre le brute force. */
const TOKEN_BYTES = 24

// ----------------------------------------------------------------------------
// Helpers internes
// ----------------------------------------------------------------------------

function generateToken(): string {
  // base64url est URL-safe natif (Node 16+). Pas de padding `=`.
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function clampDurationDays(d: number | undefined): number {
  if (!d || d <= 0) return DEFAULT_DURATION_DAYS
  return Math.min(MAX_DURATION_DAYS, Math.floor(d))
}

function expiresAtFromNow(durationDays: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + durationDays)
  return d.toISOString()
}

// ----------------------------------------------------------------------------
// API publique
// ----------------------------------------------------------------------------

/**
 * Crée un nouveau token de partage pour une intervention.
 *
 * Le token est cryptographiquement aléatoire (24 octets, base64url).
 * Si include_identities=true, l'appelant DOIT logger un audit event séparément.
 */
export async function createShareToken(
  input: CreateShareTokenInput,
): Promise<ProofShareToken> {
  const supabase = createAdminClient()

  const days = clampDurationDays(input.durationDays)
  const token = generateToken()

  const { data, error } = await supabase
    .from('proof_share_tokens')
    .insert({
      token,
      intervention_id: input.interventionId,
      expires_at: expiresAtFromNow(days),
      include_identities: input.includeIdentities ?? false,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as ProofShareToken
}

/**
 * Récupère un token par sa valeur (pas l'id !). Utilisé par la route publique.
 *
 * Retourne null si :
 *   - Le token n'existe pas
 *   - Le token est révoqué (revoked_at NOT NULL)
 *   - Le token est expiré (expires_at < now)
 *
 * NB : on filtre côté code pour rester explicite ; l'index partiel filtre déjà
 * les révoqués au niveau lookup.
 */
export async function getShareTokenByValue(
  token: string,
): Promise<ProofShareToken | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('proof_share_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as ProofShareToken
  if (row.revoked_at) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  return row
}

/**
 * Variante "raw" qui retourne TOUS les états (révoqués, expirés). Utile pour le
 * dashboard admin / tests qui veulent voir l'historique complet.
 */
export async function getShareTokenByValueRaw(
  token: string,
): Promise<ProofShareToken | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('proof_share_tokens')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  return (data as ProofShareToken | null) ?? null
}

/**
 * Récupère un token par son ID. Utilisé par la route PDF on-demand qui reçoit
 * tokenId en query string (le token-value reste secret côté URL publique).
 */
export async function getShareTokenById(id: string): Promise<ProofShareToken | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('proof_share_tokens')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as ProofShareToken | null) ?? null
}

/**
 * Révoque (soft) un token. Le lien public devient invalide immédiatement.
 * Idempotent : ré-appeler n'a pas d'effet visible.
 */
export async function revokeShareToken(tokenId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('proof_share_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('revoked_at', null)
  if (error) throw error
}

/**
 * Liste les tokens encore actifs (non révoqués) d'une intervention.
 * Pratique pour montrer "Vous avez déjà 2 liens partagés actifs sur cette intervention".
 */
export async function listShareTokensForIntervention(
  interventionId: string,
): Promise<ProofShareToken[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('proof_share_tokens')
    .select('*')
    .eq('intervention_id', interventionId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ProofShareToken[]
}

/**
 * Enregistre un accès sur le token (incrémente access_count + maj last_accessed_at).
 *
 * Best-effort : si ça échoue, on ne casse PAS l'affichage public. On émet un warn.
 * Pas de RPC atomique pour rester simple ; un accès simultané peut faire perdre 1
 * unité dans le compteur, c'est acceptable pour une métrique d'audit.
 */
export async function recordShareAccess(tokenId: string): Promise<void> {
  const supabase = createAdminClient()
  try {
    // Lit-then-write — pas d'atomicité forte, mais suffisant pour audit.
    const { data, error: rErr } = await supabase
      .from('proof_share_tokens')
      .select('access_count')
      .eq('id', tokenId)
      .maybeSingle()
    if (rErr) throw rErr
    const current = (data as { access_count: number } | null)?.access_count ?? 0

    const { error } = await supabase
      .from('proof_share_tokens')
      .update({
        access_count: current + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq('id', tokenId)
    if (error) throw error
  } catch (e) {
    console.warn('[proof-share] recordShareAccess failed:', e)
  }
}
