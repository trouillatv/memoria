'use server'

// Débrief de visite (desktop) — server actions.
//   - analyzeVisitDebriefAction : l'IA PROPOSE une lecture. N'écrit RIEN.
//   - validateVisitDebriefAction : persiste APRÈS validation humaine.
// Réservé admin/manager (réflexion au bureau, pas terrain).

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { gatherVisitDebriefContext, closeVisit, buildVisitCr } from '@/lib/db/visits'
import { createSiteAction } from '@/lib/db/site-actions'
import { runVisitDebriefAgent, type VisitDebriefParsed } from '@/services/ai/visit-debrief'

async function requireManager(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUserWithProfile()
  if (!user) return { ok: false, error: 'Non authentifié' }
  if (user.role !== 'admin' && user.role !== 'manager') return { ok: false, error: 'Accès refusé' }
  return { ok: true, userId: user.id }
}

export interface DebriefAnalysis {
  narrative: string // Agent 1 — « ce que MemorIA a compris » (texte libre)
  proposal: VisitDebriefParsed
  openSubjects: Array<{ id: string; name: string }>
  provider: string
  model: string | null
}

/** L'IA lit les captures + le contexte site et PROPOSE. Aucune écriture. */
export async function analyzeVisitDebriefAction(
  reportId: string,
): Promise<{ ok: true; analysis: DebriefAnalysis } | { ok: false; error: string }> {
  const auth = await requireManager()
  if (!auth.ok) return auth
  if (!z.string().uuid().safeParse(reportId).success) return { ok: false, error: 'Visite invalide' }

  const ctx = await gatherVisitDebriefContext(reportId)
  if (!ctx) return { ok: false, error: 'Visite introuvable' }

  const signalLines = ctx.signals.flatMap((s) => [
    s.title,
    ...s.items.slice(0, 4).map((i) => `  • ${i.label}${i.context && i.context.length > 0 ? ` (${i.context[0]})` : ''}`),
  ])

  try {
    const res = await runVisitDebriefAgent({
      objectiveHint: ctx.visit.objective,
      capturedText: ctx.capturedText,
      transcript: ctx.transcript,
      attachmentNames: ctx.attachmentNames,
      capturedNotes: ctx.capturedNotes,
      capturedActions: ctx.capturedActions,
      capturedReserves: ctx.capturedReserves,
      signalLines,
      openSubjects: ctx.openSubjects,
      siteHistory: ctx.history,
      subjectDigests: ctx.subjectDigests,
      userId: auth.userId,
    })
    return {
      ok: true,
      analysis: { narrative: res.narrative, proposal: res.parsed, openSubjects: ctx.openSubjects, provider: res.provider, model: res.model },
    }
  } catch {
    return { ok: false, error: "L'analyse IA a échoué" }
  }
}

const validateSchema = z.object({
  site_id: z.string().uuid(),
  report_id: z.string().uuid(),
  objective: z.string().max(300).optional(),
  target_subject_id: z.string().uuid().optional(),
  outcome: z.enum(['ras', 'conforme', 'conforme_reserves', 'non_conforme', 'a_revoir', 'info']).optional(),
  resolution: z.enum(['resolue', 'a_suivre', 'recontrole']).optional(),
  /** Titres d'actions retenus par l'humain — créés en base. */
  accepted_actions: z.array(z.string().min(1).max(200)).max(20).optional(),
})

/** Persiste le débrief VALIDÉ par l'humain : champs visite + actions retenues. */
export async function validateVisitDebriefAction(
  input: z.input<typeof validateSchema>,
): Promise<{ ok: true; createdActions: number } | { ok: false; error: string }> {
  const auth = await requireManager()
  if (!auth.ok) return auth

  const parsed = validateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const d = parsed.data

  try {
    await closeVisit({
      reportId: d.report_id,
      objective: d.objective ?? null,
      targetSubjectId: d.target_subject_id ?? null,
      outcome: d.outcome ?? null,
      resolution: d.resolution ?? null,
    })

    let createdActions = 0
    for (const title of d.accepted_actions ?? []) {
      await createSiteAction({
        site_id: d.site_id,
        report_id: d.report_id,
        title,
        subject_id: d.target_subject_id ?? null,
        created_by: auth.userId,
        created_from: 'desktop_site',
      })
      createdActions++
    }

    revalidatePath(`/sites/${d.site_id}/visites`)
    revalidatePath(`/sites/${d.site_id}/visites/${d.report_id}`)
    return { ok: true, createdActions }
  } catch {
    return { ok: false, error: 'Échec de l’enregistrement du débrief' }
  }
}

/**
 * Génère le CR de la visite — PROJECTION déterministe du Débrief validé (zéro IA).
 * Retourne le markdown ; l'affichage / copie se fait côté client.
 */
export async function generateVisitCrAction(
  reportId: string,
): Promise<{ ok: true; cr: string } | { ok: false; error: string }> {
  const auth = await requireManager()
  if (!auth.ok) return auth
  if (!z.string().uuid().safeParse(reportId).success) return { ok: false, error: 'Visite invalide' }

  try {
    const cr = await buildVisitCr(reportId)
    if (!cr) return { ok: false, error: 'Visite introuvable' }
    return { ok: true, cr }
  } catch {
    return { ok: false, error: 'Échec de la génération du CR' }
  }
}
