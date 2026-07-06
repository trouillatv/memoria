'use server'

// Visites terrain (mig 162) — server actions. Démarrer / clôturer une visite.
// Auth terrain (requireFieldAgent). MVP : friction zéro au démarrage (siteId
// seul) ; champs facultatifs posés à la clôture ; jamais de score personne.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVisit, endVisit, closeVisit, reopenVisit } from '@/lib/db/visits'

const MOTIVES = [
  'inspection', 'controle', 'reunion', 'avancement', 'reception',
  'levee_reserves', 'constat', 'expertise', 'maintenance', 'libre',
  // Intentions métier (mig 186) — « pourquoi êtes-vous ici ? ».
  'premiere', 'previsite_ao', 'prereception', 'sav',
] as const

// Démarrage : le site (+ origine auto) et, si connue, l'INTENTION de la visite
// (« pourquoi êtes-vous ici ? »). L'intention reste facultative (friction zéro).
const startSchema = z.object({
  site_id: z.string().uuid(),
  origin: z.enum(['planned', 'spontaneous', 'qr', 'gps']).default('spontaneous'),
  motive: z.enum(MOTIVES).optional(),
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
      motive: parsed.data.motive ?? null,
    })
    revalidatePath(`/m/site/${parsed.data.site_id}`)
    return { ok: true, reportId }
  } catch {
    return { ok: false, error: 'Échec du démarrage de la visite' }
  }
}

// Reprendre (terrain) : efface ended_at → la visite redevient « en cours », avec
// toutes ses captures + tags intacts. Une visite n'est jamais figée.
const reopenSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid(),
})

export async function reopenVisitAction(
  input: z.input<typeof reopenSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = reopenSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await reopenVisit(parsed.data.report_id)
    revalidatePath(`/m/site/${parsed.data.site_id}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la reprise de la visite' }
  }
}

// Objet de la visite — « pourquoi je suis là ». Renseigné AU DÉMARRAGE (contexte
// pour l'IA/le CR) ou plus tard. Champ ciblé : ne touche à aucun autre champ.
const objectiveSchema = z.object({
  report_id: z.string().uuid(),
  site_id: z.string().uuid().optional(),
  objective: z.string().max(300),
})

export async function setVisitObjectiveAction(
  input: z.input<typeof objectiveSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = objectiveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('site_reports')
      .update({ objective: parsed.data.objective.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.report_id)
    if (error) throw error
    if (parsed.data.site_id) revalidatePath(`/m/site/${parsed.data.site_id}`)
    return { ok: true }
  } catch {
    return { ok: false, error: "Échec de l'enregistrement de l'objet" }
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
