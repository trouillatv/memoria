'use server'

// Slice B.3 — Server actions /preuves/[id]
//
// Doctrine impérative :
//   - prepareProofDossierAction : crée un proof_share_token, retourne les URLs
//     PDF + share + expiresAt. C'est ce que la UI consomme pour bâtir la dialog
//     "Dossier prêt".
//   - revokeShareTokenAction : invalide immédiatement un lien partagé.
//   - Auth = admin/manager strict. Pas de bypass.
//   - Audit log systématique :
//       'proof_dossier_prepared' (toujours, avec include_identities flag)
//       'proof_dossier_identities_override' (seulement si include_identities=true)
//       'proof_share_revoked' (sur revoke)
//   - L'URL publique /p/[token] sera servie par Slice B.4. On la construit déjà
//     ici car le DG va vouloir copier le lien immédiatement.

import { headers } from 'next/headers'
import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createShareToken, revokeShareToken, getShareTokenById } from '@/lib/db/proof-share'
import { logAuditEvent } from '@/lib/audit/log'

// ----------------------------------------------------------------------------
// Auth helper
// ----------------------------------------------------------------------------

async function requireManagerOrAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Not authenticated' }
  if (user.role !== 'admin' && user.role !== 'manager') {
    return { ok: false, error: 'Forbidden' }
  }
  return { ok: true, userId: user.id }
}

// ----------------------------------------------------------------------------
// prepareProofDossierAction
// ----------------------------------------------------------------------------

const prepareSchema = z.object({
  interventionId: z.string().uuid(),
  durationDays: z.number().int().min(1).max(30).optional(),
  includeIdentities: z.boolean().optional(),
})

export interface PrepareProofDossierInput {
  interventionId: string
  /** Durée de validité en jours (1-30). Default 7. */
  durationDays?: number
  /** Override admin : true = identités visibles dans le PDF + page publique. */
  includeIdentities?: boolean
}

export type PrepareProofDossierResult =
  | {
      ok: true
      tokenId: string
      token: string
      shareUrl: string
      pdfUrl: string
      expiresAt: string
    }
  | { ok: false; error: string }

/**
 * Prépare un Dossier de preuves : crée un share token, retourne les URLs.
 *
 * Le PDF est généré on-demand par la route GET /preuves/[id]/dossier?tokenId=xxx,
 * pas pré-stocké. Ça simplifie le storage et garantit que les changements futurs
 * sur l'intervention se reflètent si quelqu'un re-télécharge le PDF avant expiration.
 */
export async function prepareProofDossierAction(
  input: PrepareProofDossierInput,
): Promise<PrepareProofDossierResult> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = prepareSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Paramètres invalides',
    }
  }

  try {
    const token = await createShareToken({
      interventionId: parsed.data.interventionId,
      durationDays: parsed.data.durationDays,
      includeIdentities: parsed.data.includeIdentities ?? false,
      createdBy: auth.userId,
    })

    // Construit l'origin depuis les headers de la request actuelle.
    // En prod : x-forwarded-host + x-forwarded-proto. En dev : host.
    const origin = await getOrigin()

    const shareUrl = `${origin}/p/${token.token}`
    const pdfUrl = `/preuves/${parsed.data.interventionId}/dossier?tokenId=${token.id}`

    await logAuditEvent({
      userId: auth.userId,
      entityType: 'mission', // entité parente trackée (la mission rattachée à l'intervention)
      entityId: parsed.data.interventionId,
      action: 'created',
      metadata: {
        kind: 'proof_dossier_prepared',
        token_id: token.id,
        intervention_id: parsed.data.interventionId,
        duration_days: parsed.data.durationDays ?? 7,
        include_identities: parsed.data.includeIdentities ?? false,
        expires_at: token.expires_at,
      },
    })

    if (parsed.data.includeIdentities) {
      // Trace explicite séparée pour l'override identités (recherchable).
      await logAuditEvent({
        userId: auth.userId,
        entityType: 'mission',
        entityId: parsed.data.interventionId,
        action: 'updated',
        metadata: {
          kind: 'proof_dossier_identities_override',
          token_id: token.id,
        },
      })
    }

    return {
      ok: true,
      tokenId: token.id,
      token: token.token,
      shareUrl,
      pdfUrl,
      expiresAt: token.expires_at,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur préparation dossier'
    return { ok: false, error: msg }
  }
}

// ----------------------------------------------------------------------------
// revokeShareTokenAction
// ----------------------------------------------------------------------------

const revokeSchema = z.object({
  tokenId: z.string().uuid(),
})

export interface RevokeShareTokenInput {
  tokenId: string
}

export type RevokeShareTokenResult = { ok: true } | { ok: false; error: string }

export async function revokeShareTokenAction(
  input: RevokeShareTokenInput,
): Promise<RevokeShareTokenResult> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = revokeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Paramètres invalides' }
  }

  const existing = await getShareTokenById(parsed.data.tokenId)
  if (!existing) return { ok: false, error: 'Lien introuvable' }

  try {
    await revokeShareToken(parsed.data.tokenId)
    await logAuditEvent({
      userId: auth.userId,
      entityType: 'mission',
      entityId: existing.intervention_id,
      action: 'soft_deleted',
      metadata: {
        kind: 'proof_share_revoked',
        token_id: parsed.data.tokenId,
      },
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur révocation'
    return { ok: false, error: msg }
  }
}

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------

async function getOrigin(): Promise<string> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) {
    // Fallback prudent — devrait jamais arriver côté server action.
    return process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000'
  }
  return `${proto}://${host}`
}
