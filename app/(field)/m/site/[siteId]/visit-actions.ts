'use server'

// Visites terrain (mig 162) — server actions. Démarrer / clôturer une visite.
// Auth terrain (requireFieldAgent). MVP : friction zéro au démarrage (siteId
// seul) ; champs facultatifs posés à la clôture ; jamais de score personne.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { createVisit, endVisit, closeVisit } from '@/lib/db/visits'

const MOTIVES = [
  'inspection', 'controle', 'reunion', 'avancement', 'reception',
  'levee_reserves', 'constat', 'expertise', 'maintenance', 'libre',
] as const

// Démarrage : AUCUNE question. Seulement le site (+ origine auto).
const startSchema = z.object({
  site_id: z.string().uuid(),
  origin: z.enum(['planned', 'spontaneous', 'qr', 'gps']).default('spontaneous'),
})

export async function startVisitAction(
  input: z.input<typeof startSchema>,
): Promise<{ ok: true; reportId: string } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = startSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  try {
    const reportId = await createVisit({
      siteId: parsed.data.site_id,
      origin: parsed.data.origin,
      createdBy: auth.userId,
    })
    revalidatePath(`/m/site/${parsed.data.site_id}`)
    return { ok: true, reportId }
  } catch {
    return { ok: false, error: 'Échec du démarrage de la visite' }
  }
}

// Terminer (terrain) : pose seulement ended_at. Aucun champ métier.
const endSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid().optional(),
})

export async function endVisitAction(
  input: z.input<typeof endSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = endSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }

  try {
    await endVisit(parsed.data.report_id)
    if (parsed.data.site_id) revalidatePath(`/m/site/${parsed.data.site_id}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la fin de visite' }
  }
}

// Clôture (desktop Débrief) : tout facultatif.
const closeSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid().optional(), // pour revalidation
  motive: z.enum(MOTIVES).optional(),
  objective: z.string().max(300).optional(),
  target_subject_id: z.string().uuid().optional(),
  outcome: z.enum(['ras', 'conforme', 'conforme_reserves', 'non_conforme', 'a_revoir', 'info']).optional(),
  resolution: z.enum(['resolue', 'a_suivre', 'recontrole']).optional(),
})

export async function closeVisitAction(
  input: z.input<typeof closeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }

  const parsed = closeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const d = parsed.data

  try {
    await closeVisit({
      reportId: d.report_id,
      motive: d.motive ?? null,
      objective: d.objective ?? null,
      targetSubjectId: d.target_subject_id ?? null,
      outcome: d.outcome ?? null,
      resolution: d.resolution ?? null,
    })
    if (d.site_id) revalidatePath(`/m/site/${d.site_id}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la clôture de la visite' }
  }
}
