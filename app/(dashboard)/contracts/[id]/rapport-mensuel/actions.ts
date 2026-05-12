'use server'

// Slice E.2 — Server action approveAndPrepareReportAction.
//
// Doctrine impérative anti-rapport bullshit V4 :
//   - Pas de génération de texte IA serveur-side.
//   - La note libre du DG est passée brute (300 chars max), c'est SA voix.
//   - Validation stricte : cap 12 photos, note 0-300 chars.
//   - Token 30j par défaut (rapport mensuel = horizon long, vs 7 pour preuve unitaire).
//   - Audit log systématique : kind='monthly_report_approved' avec contract_id,
//     report_month, token_id, nb_photos, note_length, expires_at.

import { headers } from 'next/headers'
import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { createMonthlyReportToken } from '@/lib/db/proof-share'
import { logAuditEvent } from '@/lib/audit/log'

const NOTE_MAX = 300
const PHOTOS_MIN = 1
const PHOTOS_MAX = 12
const DEFAULT_DURATION_DAYS = 30

const inputSchema = z.object({
  contractId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Format mois attendu YYYY-MM'),
  selectedPhotoIds: z
    .array(z.string().uuid())
    .min(PHOTOS_MIN, `Au moins ${PHOTOS_MIN} photo requise.`)
    .max(PHOTOS_MAX, `Maximum ${PHOTOS_MAX} photos par rapport.`),
  note: z.string().max(NOTE_MAX, `Note limitée à ${NOTE_MAX} caractères.`),
})

export interface PrepareReportInput {
  contractId: string
  month: string
  selectedPhotoIds: string[]
  note: string
}

export interface PrepareReportResult {
  ok: boolean
  shareUrl?: string
  pdfUrl?: string
  expiresAt?: string
  error?: string
}

export async function approveAndPrepareReportAction(
  input: PrepareReportInput,
): Promise<PrepareReportResult> {
  // ---- Auth : admin ou manager strict.
  const user = await getCurrentUserWithProfile()
  if (!user) {
    return { ok: false, error: 'Non authentifié.' }
  }
  if (user.role !== 'admin' && user.role !== 'manager') {
    return { ok: false, error: 'Accès refusé.' }
  }

  // ---- Validation.
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Paramètres invalides.',
    }
  }

  // ---- Création du share token 30j.
  try {
    const token = await createMonthlyReportToken({
      contractId: parsed.data.contractId,
      reportMonth: parsed.data.month,
      durationDays: DEFAULT_DURATION_DAYS,
      selectedPhotoIds: parsed.data.selectedPhotoIds,
      dgNote: parsed.data.note,
      createdBy: user.id,
    })

    const origin = await getOrigin()
    const shareUrl = `${origin}/p/${token.token}`
    const pdfUrl = `/p/${token.token}/pdf`

    // ---- Audit log.
    //   entityType='report' : entité parente la plus proche dans la
    //   classification audit existante (pas de type 'contract' dédié).
    //   Le contract_id reste tracé via metadata.
    await logAuditEvent({
      userId: user.id,
      entityType: 'report',
      entityId: parsed.data.contractId,
      action: 'created',
      metadata: {
        kind: 'monthly_report_approved',
        token_id: token.id,
        contract_id: parsed.data.contractId,
        report_month: parsed.data.month,
        selected_photos_count: parsed.data.selectedPhotoIds.length,
        note_length: parsed.data.note.length,
        expires_at: token.expires_at,
      },
    })

    return {
      ok: true,
      shareUrl,
      pdfUrl,
      expiresAt: token.expires_at,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur préparation rapport'
    return { ok: false, error: msg }
  }
}

// ----------------------------------------------------------------------------
// Utils
// ----------------------------------------------------------------------------

/**
 * Construit l'origin à partir des headers HTTP (x-forwarded-* en prod, host en
 * dev). Aligné sur le pattern utilisé par prepareProofDossierAction (Phase 5).
 */
async function getOrigin(): Promise<string> {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host) {
    return process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000'
  }
  return `${proto}://${host}`
}
