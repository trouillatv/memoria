'use server'

// Sprint 6 — Server actions de fermeture mentale (doctrine V5 verrou V3).
//
// Wording impératif : "Clôturer un dossier" — JAMAIS "Résoudre", "Marquer résolu",
// "Issue closed". Le cleaning : "résolu" implique acceptation de responsabilité,
// juridiquement dangereux. La doctrine V5 verrou V3 ferme cette porte.
//
// Auth = manager+ (cohérent avec prepareProofDossierAction/revokeShareTokenAction).
// Audit log systématique (toute clôture/réouverture est tracée pour le DG).

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  closeProofShareToken,
  reopenProofShareToken,
  getShareTokenById,
} from '@/lib/db/proof-share'
import { logAuditEvent } from '@/lib/audit/log'
import { freezeProofDossierPdf } from '@/lib/pdf/freeze-dossier'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface CloseDossierInput {
  tokenId: string
  /** Note libre 0..200 chars. Optionnelle. */
  note?: string
}

export interface CloseDossierResult {
  ok: boolean
  error?: string
}

// ----------------------------------------------------------------------------
// Auth helper (local, cohérent avec actions.ts du même répertoire)
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
// closeDossierAction
// ----------------------------------------------------------------------------

const closeSchema = z.object({
  tokenId: z.string().uuid(),
  // Cap applicatif aligné sur lib/db/proof-share.ts (CLOSURE_NOTE_MAX = 200).
  note: z.string().max(200).optional(),
})

/**
 * Clôture mentalement un dossier de preuves partagé.
 *
 * Le dossier reste consultable via son lien public. La clôture est un signal
 * d'apaisement (verrou V3), pas une révocation. Patrick peut rouvrir si
 * c'est une erreur (cf. reopenDossierAction).
 */
export async function closeDossierAction(
  input: CloseDossierInput,
): Promise<CloseDossierResult> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = closeSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Paramètres invalides',
    }
  }

  const existing = await getShareTokenById(parsed.data.tokenId)
  if (!existing) return { ok: false, error: 'Lien introuvable' }
  if (existing.closed_at) return { ok: false, error: 'Dossier déjà clôturé.' }

  try {
    // Phase 1.2 — Freeze AVANT clôture : on capture le PDF figé. Si le freeze
    // échoue, on ne clôture pas (atomicité). Le dossier ne devient "clôturé"
    // que si on a la preuve immuable correspondante.
    // Le freeze est skip pour les rapports mensuels (pas encore supporté).
    if (existing.intervention_id) {
      const h = await headers()
      const proto = h.get('x-forwarded-proto') ?? 'http'
      const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
      const origin = `${proto}://${host}`

      const freezeResult = await freezeProofDossierPdf(parsed.data.tokenId, origin)
      if (!freezeResult.ok) {
        return { ok: false, error: `Impossible de figer le PDF : ${freezeResult.error}` }
      }
    }

    await closeProofShareToken({
      tokenId: parsed.data.tokenId,
      closedBy: auth.userId,
      note: parsed.data.note,
    })

    await logAuditEvent({
      userId: auth.userId,
      entityType: 'mission',
      entityId: existing.intervention_id,
      action: 'updated',
      metadata: {
        kind: 'proof_dossier_closed', // doctrine V3 : "closed", pas "resolved"
        token_id: parsed.data.tokenId,
        has_note: !!parsed.data.note,
        frozen: !!existing.intervention_id,
      },
    })

    // L'UI Dossier de preuves dépend de l'état du token : on re-render.
    if (existing.intervention_id) {
      revalidatePath(`/preuves/${existing.intervention_id}`)
    }
    revalidatePath('/dashboard')

    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur clôture du dossier'
    return { ok: false, error: msg }
  }
}

// ----------------------------------------------------------------------------
// reopenDossierAction
// ----------------------------------------------------------------------------

const reopenSchema = z.object({
  tokenId: z.string().uuid(),
})

export async function reopenDossierAction(
  tokenId: string,
): Promise<CloseDossierResult> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = reopenSchema.safeParse({ tokenId })
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Paramètres invalides',
    }
  }

  const existing = await getShareTokenById(parsed.data.tokenId)
  if (!existing) return { ok: false, error: 'Lien introuvable' }

  try {
    await reopenProofShareToken(parsed.data.tokenId)

    await logAuditEvent({
      userId: auth.userId,
      entityType: 'mission',
      entityId: existing.intervention_id,
      action: 'updated',
      metadata: {
        kind: 'proof_dossier_reopened',
        token_id: parsed.data.tokenId,
      },
    })

    if (existing.intervention_id) {
      revalidatePath(`/preuves/${existing.intervention_id}`)
    }
    revalidatePath('/dashboard')

    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur réouverture du dossier'
    return { ok: false, error: msg }
  }
}
