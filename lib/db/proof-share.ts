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
import {
  getContractMonthlyReport,
  type MonthlyReportData,
} from '@/lib/db/monthly-report'

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
  /** Slice E.2 : nullable depuis migration 026. NULL pour les tokens "rapport mensuel". */
  intervention_id: string | null
  created_at: string
  created_by: string | null
  expires_at: string
  revoked_at: string | null
  include_identities: boolean
  last_accessed_at: string | null
  access_count: number
  /** Slice E.2 : contract référencé pour le cas rapport mensuel. */
  contract_id: string | null
  /** Slice E.2 : "YYYY-MM" pour le cas rapport mensuel. */
  report_month: string | null
  /** Slice E.2 : sélection figée des photos approuvées par le DG (1..12). */
  selected_photo_ids: string[] | null
  /** Slice E.2 : note libre du DG figée au moment de l'approbation. */
  dg_note: string | null
  /** Sprint 6 (verrou V3) : timestamp de clôture mentale du dossier. NULL = ouvert. */
  closed_at: string | null
  /** Sprint 6 : user (manager+) ayant clôturé. NULL si rouvert ou pas encore clôturé. */
  closed_by: string | null
  /** Sprint 6 : note libre 0..200 chars (cap applicatif). NULL ou string. */
  closure_note: string | null
}

/**
 * Discriminant runtime : permet de filtrer un token "rapport mensuel"
 * sans répéter la logique XOR partout.
 */
export function isMonthlyReportToken(t: ProofShareToken): boolean {
  return t.contract_id !== null && t.report_month !== null
}

export interface CreateMonthlyReportTokenInput {
  contractId: string
  /** Format "YYYY-MM". */
  reportMonth: string
  /** Durée en jours. Default 30 (rapport mensuel = horizon long). Max 30. */
  durationDays?: number
  /** Sélection figée approuvée par le DG. Min 1, max 12 (cap applicatif Slice E.1). */
  selectedPhotoIds: string[]
  /** Note libre du DG (0-300 chars). */
  dgNote: string
  /** Override admin (default false). Cohérent avec dossier de preuves. */
  includeIdentities?: boolean
  /** Userid créateur (pour audit). */
  createdBy?: string | null
}

// ----------------------------------------------------------------------------
// Constantes
// ----------------------------------------------------------------------------

const DEFAULT_DURATION_DAYS = 7
const DEFAULT_MONTHLY_REPORT_DURATION_DAYS = 30
const MAX_DURATION_DAYS = 30
/** 24 octets → 32 chars base64url. Largement suffisant contre le brute force. */
const TOKEN_BYTES = 24
const MONTHLY_REPORT_PHOTOS_MIN = 1
const MONTHLY_REPORT_PHOTOS_MAX = 12
const MONTHLY_REPORT_NOTE_MAX = 300
const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

// ----------------------------------------------------------------------------
// Helpers internes
// ----------------------------------------------------------------------------

function generateToken(): string {
  // base64url est URL-safe natif (Node 16+). Pas de padding `=`.
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function clampDurationDays(d: number | undefined, fallback = DEFAULT_DURATION_DAYS): number {
  if (!d || d <= 0) return fallback
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

// ----------------------------------------------------------------------------
// Slice E.2 — Tokens "rapport mensuel" (contract_id + report_month)
// ----------------------------------------------------------------------------

/**
 * Crée un share token pour un rapport mensuel client.
 *
 * - Default 30 jours (rapport mensuel = horizon long, vs 7 pour preuve unitaire).
 * - Cap photos 1..12 (cohérent avec MonthlyReportEditor Slice E.1).
 * - Cap note 0..300 chars (cohérent avec NoteSection Slice E.1).
 * - intervention_id reste null ; la CHECK chk_token_kind impose le XOR.
 *
 * Throws si validation échoue (avant insertion) ou si la DB rejette
 * (notamment la CHECK constraint si on tente d'insérer une combinaison invalide).
 */
export async function createMonthlyReportToken(
  input: CreateMonthlyReportTokenInput,
): Promise<ProofShareToken> {
  // Validations applicatives — protections en plus des CHECK SQL.
  if (!MONTH_REGEX.test(input.reportMonth)) {
    throw new Error(`createMonthlyReportToken: reportMonth invalide "${input.reportMonth}" (attendu YYYY-MM)`)
  }
  if (
    !Array.isArray(input.selectedPhotoIds) ||
    input.selectedPhotoIds.length < MONTHLY_REPORT_PHOTOS_MIN ||
    input.selectedPhotoIds.length > MONTHLY_REPORT_PHOTOS_MAX
  ) {
    throw new Error(
      `createMonthlyReportToken: selectedPhotoIds doit contenir entre ${MONTHLY_REPORT_PHOTOS_MIN} et ${MONTHLY_REPORT_PHOTOS_MAX} ids.`,
    )
  }
  if (typeof input.dgNote !== 'string' || input.dgNote.length > MONTHLY_REPORT_NOTE_MAX) {
    throw new Error(
      `createMonthlyReportToken: dgNote doit être une string de 0..${MONTHLY_REPORT_NOTE_MAX} caractères.`,
    )
  }

  const days = clampDurationDays(input.durationDays, DEFAULT_MONTHLY_REPORT_DURATION_DAYS)
  const tokenValue = generateToken()

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('proof_share_tokens')
    .insert({
      token: tokenValue,
      intervention_id: null,
      contract_id: input.contractId,
      report_month: input.reportMonth,
      selected_photo_ids: input.selectedPhotoIds,
      dg_note: input.dgNote,
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
 * MC-6 — Récupère la note du DG du DERNIER rapport mensuel approuvé pour un
 * contrat, en excluant le mois en cours (`excludeMonth`). Pour pré-remplir le
 * champ « Note du DG » du mois suivant et réduire la peur de la page blanche.
 *
 * Doctrine V5 Pilier 2 : réduit la charge mentale. La voix de Patrick est
 * la SIENNE, on le rappelle juste de sa note précédente, jamais d'IA générative.
 *
 * Renvoie null si aucun rapport antérieur n'existe.
 */
export async function getLastMonthlyReportNote(input: {
  contractId: string
  excludeMonth: string // yyyy-mm
}): Promise<{ month: string; note: string } | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('proof_share_tokens')
    .select('report_month, dg_note')
    .eq('contract_id', input.contractId)
    .not('report_month', 'is', null)
    .neq('report_month', input.excludeMonth)
    .is('revoked_at', null)
    .not('dg_note', 'is', null)
    .order('report_month', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data || !data.report_month) return null
  const note = (data.dg_note ?? '').trim()
  if (note.length === 0) return null
  return { month: data.report_month, note }
}

/**
 * Récupère un token "rapport mensuel" + le dataset factuel associé.
 *
 * Retourne null si :
 *   - Le token n'existe pas
 *   - Le token est révoqué (revoked_at NOT NULL)
 *   - Le token est expiré (expires_at < now)
 *   - Le token n'est PAS un rapport mensuel (cas dossier de preuves)
 *
 * Le caller (page publique) peut distinguer "token inexistant" de
 * "token révoqué/expiré" via getShareTokenByValueRaw avant d'appeler ce helper
 * si besoin d'affichage dédié — pattern Phase 5 conservé.
 */
export async function getMonthlyReportFromToken(token: string): Promise<{
  shareToken: ProofShareToken
  reportData: MonthlyReportData
  selectedPhotoIds: string[]
  dgNote: string
} | null> {
  const shareToken = await getShareTokenByValue(token)
  if (!shareToken) return null
  if (!shareToken.contract_id || !shareToken.report_month) return null

  const reportData = await getContractMonthlyReport(
    shareToken.contract_id,
    shareToken.report_month,
  )
  if (!reportData) return null

  return {
    shareToken,
    reportData,
    selectedPhotoIds: shareToken.selected_photo_ids ?? [],
    dgNote: shareToken.dg_note ?? '',
  }
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

// ----------------------------------------------------------------------------
// Sprint 6 — Fermeture mentale (doctrine V5 verrou V3)
// ----------------------------------------------------------------------------
//
// Wording impératif : "Dossier clôturé" / "Échange finalisé" / "Incident traité"
// / "Réclamation refermée". JAMAIS "résolu" / "resolved" / "issue closed".
// Le cleaning : "résolu" implique acceptation de responsabilité = juridiquement
// dangereux. La doctrine V5 verrou V3 ferme cette porte par convention forte.

/** Cap applicatif sur la note de clôture, cohérent avec le chk_ DB (255). */
const CLOSURE_NOTE_MAX = 200

export interface CloseProofShareTokenInput {
  /** UUID du token à clôturer (NB : tokenId, pas la valeur du token). */
  tokenId: string
  /** User id (manager+) ayant clôturé. Audit + dignité. */
  closedBy?: string | null
  /** Note libre 0..200 chars. Trim côté caller — on garde tel quel ici. */
  note?: string
}

/**
 * Clôture un dossier de preuves partagé (Sprint 6, verrou V3).
 *
 * - "Clôturer" est mental, pas juridique : le dossier reste consultable via
 *   l'URL publique tant que le lien n'est pas révoqué/expiré. La clôture est
 *   un signal d'apaisement, pas une révocation.
 * - Throw si tokenId inexistant.
 * - Throw si déjà clôturé (closed_at NOT NULL) — protection contre les
 *   double-submits côté UI.
 */
export async function closeProofShareToken(
  input: CloseProofShareTokenInput,
): Promise<void> {
  if (input.note != null && input.note.length > CLOSURE_NOTE_MAX) {
    throw new Error(
      `closeProofShareToken: note trop longue (${input.note.length} > ${CLOSURE_NOTE_MAX} chars).`,
    )
  }

  const supabase = createAdminClient()

  const { data: existing, error: rErr } = await supabase
    .from('proof_share_tokens')
    .select('id, closed_at')
    .eq('id', input.tokenId)
    .maybeSingle()
  if (rErr) throw rErr
  if (!existing) {
    throw new Error(`closeProofShareToken: token introuvable (${input.tokenId}).`)
  }
  if ((existing as { closed_at: string | null }).closed_at) {
    throw new Error('Dossier déjà clôturé.')
  }

  const noteValue =
    typeof input.note === 'string' && input.note.trim().length > 0
      ? input.note.trim()
      : null

  const { error } = await supabase
    .from('proof_share_tokens')
    .update({
      closed_at: new Date().toISOString(),
      closed_by: input.closedBy ?? null,
      closure_note: noteValue,
    })
    .eq('id', input.tokenId)
  if (error) throw error
}

/**
 * Rouvre un dossier précédemment clôturé (Sprint 6).
 *
 * Cas d'usage : Patrick clique par erreur sur "Clôturer" depuis un mobile.
 * Idempotent : appeler sur un dossier déjà ouvert ne lève pas d'erreur (on
 * reset les 3 champs en NULL sans condition).
 */
export async function reopenProofShareToken(tokenId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('proof_share_tokens')
    .update({
      closed_at: null,
      closed_by: null,
      closure_note: null,
    })
    .eq('id', tokenId)
  if (error) throw error
}

/**
 * Compte les dossiers clôturés depuis le 1er du mois courant (UTC).
 *
 * Utilisé par le widget cockpit "N dossiers clôturés ce mois". On reste
 * factuel : nombre brut, pas de moyenne, pas de comparaison inter-mois.
 * Doctrine V5 pilier 5 : sensation de maîtrise, jamais alerte.
 */
export async function countClosedThisMonth(): Promise<number> {
  const supabase = createAdminClient()
  const now = new Date()
  const startOfMonthUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  ).toISOString()

  const { count, error } = await supabase
    .from('proof_share_tokens')
    .select('id', { count: 'exact', head: true })
    .gte('closed_at', startOfMonthUtc)
  if (error) throw error
  return count ?? 0
}
