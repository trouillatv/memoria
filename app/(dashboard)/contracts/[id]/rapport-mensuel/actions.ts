'use server'

// Slice E.1 — Server action approveAndPrepareReportAction.
//
// Pour cette slice : validation des inputs + auth + retour placeholder.
// La génération PDF + token 30j arriveront en Slice E.2.
//
// Doctrine impérative anti-rapport bullshit V4 :
//   - Pas de génération de texte IA serveur-side.
//   - La note libre du DG est passée brute (300 chars max), c'est SA voix.
//   - Validation stricte : cap 12 photos, note 0-300 chars.

import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'

const NOTE_MAX = 300
const PHOTOS_MIN = 1
const PHOTOS_MAX = 12

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

  // ---- Slice E.2 : génération PDF + token 30j.
  // Pour la slice E.1, on renvoie un message explicite qui informe le DG que
  // la suite est en cours d'implémentation. Aucun side-effect DB.
  return {
    ok: false,
    error: 'Génération PDF disponible dans la slice E.2 (à venir).',
  }
}
