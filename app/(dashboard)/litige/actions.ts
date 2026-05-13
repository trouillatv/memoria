'use server'

// Sprint 3 — UX-8 Mode litige express : server action de préparation dossier.
//
// Doctrine V5 — Pilier 1 + Verrou V1 + Verrou V4 :
//   - Génère un dossier agrégé (site × période) prêt à servir de
//     « préparation de défense ».
//   - Auth admin/manager (chef_equipe redirigé hors flow).
//   - Audit log explicite « litige_dossier_prepared ».
//   - Réutilise les helpers Phase 5 :
//       - searchProofs() pour la liste agrégée des interventions
//       - createShareToken() pour le partage temporaire
//   - Le PDF est généré on-demand via une route GET dédiée
//     (`/litige/dossier?...`), pas pré-stocké.
//
// Wording strict :
//   - « Préparation de défense », JAMAIS « Attaque ».
//   - Pas de score, pas de %, pas de classement.

import { headers } from 'next/headers'
import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { searchProofs } from '@/lib/db/proofs'
import { createShareToken } from '@/lib/db/proof-share'
import { logAuditEvent } from '@/lib/audit/log'

// ----------------------------------------------------------------------------
// Schéma d'entrée
// ----------------------------------------------------------------------------

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export const prepareLitigeDossierSchema = z.object({
  siteId: z.string().uuid({ message: 'Site invalide' }),
  dateFrom: z.string().regex(DATE_REGEX, { message: 'Date de début invalide' }),
  dateTo: z.string().regex(DATE_REGEX, { message: 'Date de fin invalide' }),
  includeInterventions: z.boolean(),
  includePhotos: z.boolean(),
  includeAnomalies: z.boolean(),
  includeValidations: z.boolean(),
})

export type PrepareLitigeDossierInput = z.infer<typeof prepareLitigeDossierSchema>

export interface PrepareLitigeDossierCounts {
  interventions: number
  photos: number
  anomalies: number
  anomaliesResolved: number
  validations: number
}

export type PrepareLitigeDossierResult = {
  ok: boolean
  pdfUrl?: string
  shareUrl?: string
  expiresAt?: string
  tokenId?: string
  counts?: PrepareLitigeDossierCounts
  error?: string
}

// ----------------------------------------------------------------------------
// Auth helper (cohérent avec /preuves)
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

async function getOrigin(): Promise<string> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) {
    return process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000'
  }
  return `${proto}://${host}`
}

// ----------------------------------------------------------------------------
// Action principale
// ----------------------------------------------------------------------------

/**
 * Prépare un dossier de litige express :
 *   - Agrège les interventions du site sur la période demandée.
 *   - Calcule les compteurs factuels (photos, anomalies, validations).
 *   - Crée un share_token (durée par défaut Phase 5 = 7 jours) pour partage.
 *   - Retourne les URLs PDF + share + counts au caller.
 *
 * Le PDF est résolu côté UI via `pdfUrl` qui pointe sur une route
 * GET `/litige/dossier?...` rendant le PDF on-demand.
 *
 * Pour ce sprint, la sélection « includePhotos/Anomalies/Validations » est
 * purement informative côté serveur (elle n'altère PAS le PDF, qui reste un
 * récap agrégé). On l'enregistre dans l'audit log pour traçabilité métier.
 *
 * Le token est créé avec `interventionId = première intervention de la liste`,
 * pour cohérence avec le schéma existant (intervention_id NOT NULL côté
 * tokens « preuves »). Si aucune intervention sur la période, on retourne
 * tout de même counts=0 avec pdfUrl null + shareUrl null (cas vide).
 */
export async function prepareLitigeDossierAction(
  input: unknown,
): Promise<PrepareLitigeDossierResult> {
  const auth = await requireManagerOrAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const parsed = prepareLitigeDossierSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Paramètres invalides',
    }
  }

  // Validation borne : dateFrom ≤ dateTo.
  if (parsed.data.dateFrom > parsed.data.dateTo) {
    return { ok: false, error: 'La date de début est postérieure à la date de fin.' }
  }

  try {
    // 1. Agrégation des interventions sur la période, borné raisonnablement.
    const result = await searchProofs({
      siteId: parsed.data.siteId,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      limit: 200,
    })

    // 2. Compteurs factuels — strictement descriptifs, jamais évaluatifs.
    const counts: PrepareLitigeDossierCounts = {
      interventions: result.items.length,
      photos: result.items.reduce((acc, it) => acc + it.photosCount, 0),
      anomalies: result.items.reduce((acc, it) => acc + it.anomaliesCount, 0),
      anomaliesResolved: result.items.reduce(
        (acc, it) => acc + it.anomaliesResolvedCount,
        0,
      ),
      validations: result.items.reduce((acc, it) => acc + it.validationsCount, 0),
    }

    // 3. Si aucune intervention : on retourne counts=0 mais pas de token.
    //    Le caller peut afficher l'état "Aucune intervention sur la période"
    //    sans créer un partage inutile.
    if (result.items.length === 0) {
      await logAuditEvent({
        userId: auth.userId,
        entityType: 'mission',
        entityId: null,
        action: 'created',
        metadata: {
          kind: 'litige_dossier_prepared',
          empty: true,
          site_id: parsed.data.siteId,
          date_from: parsed.data.dateFrom,
          date_to: parsed.data.dateTo,
          include_interventions: parsed.data.includeInterventions,
          include_photos: parsed.data.includePhotos,
          include_anomalies: parsed.data.includeAnomalies,
          include_validations: parsed.data.includeValidations,
        },
      })
      return { ok: true, counts }
    }

    // 4. Création d'un share_token. On rattache le token à la PREMIÈRE
    //    intervention (la plus récente — searchProofs renvoie antichrono),
    //    pour respecter le schéma existant (intervention_id NOT NULL côté
    //    proof_share_tokens classiques). Doctrine : c'est juste un ancrage
    //    technique ; le PDF agrégé continue d'afficher TOUTES les
    //    interventions de la période.
    const anchorIntervention = result.items[0]
    const token = await createShareToken({
      interventionId: anchorIntervention.id,
      durationDays: 7,
      includeIdentities: false,
      createdBy: auth.userId,
    })

    const origin = await getOrigin()
    const shareUrl = `${origin}/p/${token.token}`

    // URL du PDF agrégé : route GET dédiée `/litige/dossier` (créée à part).
    // On encode les params dans l'URL — pas de body sur un download GET.
    const pdfQs = new URLSearchParams({
      siteId: parsed.data.siteId,
      dateFrom: parsed.data.dateFrom,
      dateTo: parsed.data.dateTo,
      tokenId: token.id,
    })
    const pdfUrl = `/litige/dossier?${pdfQs.toString()}`

    await logAuditEvent({
      userId: auth.userId,
      entityType: 'mission',
      entityId: anchorIntervention.id,
      action: 'created',
      metadata: {
        kind: 'litige_dossier_prepared',
        empty: false,
        token_id: token.id,
        site_id: parsed.data.siteId,
        date_from: parsed.data.dateFrom,
        date_to: parsed.data.dateTo,
        counts,
        include_interventions: parsed.data.includeInterventions,
        include_photos: parsed.data.includePhotos,
        include_anomalies: parsed.data.includeAnomalies,
        include_validations: parsed.data.includeValidations,
      },
    })

    return {
      ok: true,
      pdfUrl,
      shareUrl,
      expiresAt: token.expires_at,
      tokenId: token.id,
      counts,
    }
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : 'Erreur préparation dossier de défense'
    return { ok: false, error: msg }
  }
}
