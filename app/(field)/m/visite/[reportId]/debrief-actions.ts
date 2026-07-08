'use server'

// Débrief express (voiture) — server action du TRI (mig 168).
// 4 décisions métier seulement. Le tri ENREGISTRE le choix ; la matérialisation
// (action, lien sujet, projection) est faite au bureau. Cf. [[visite-trois-temps]].

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import { getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSiteAction } from '@/lib/db/site-actions'
import { createSiteReserve } from '@/lib/db/site-reserve'
import { getVisitCrPhotoPlan, getVisit, deleteVisit } from '@/lib/db/visits'
import {
  setCaptureTriage,
  listVisitCaptures,
  type CaptureTriageIntent,
  type VisitCaptureRow,
} from '@/lib/db/visit-captures'

// Vocabulaire MÉTIER du traitement des captures (mig 182). « Cette capture montre… »
//   📚 Mémoire      → gardée, aucune suite (preuve, historique du chantier)
//   👀 À surveiller → gardée, remonte aux prochains débriefs
//   ⚠️ Réserve      → gardée, deviendra une réserve au bureau
//   ✅ Action       → gardée, deviendra une action au bureau
//   🗑 Supprimer    → geste VOLONTAIRE (photo floue) — le tri, lui, ne supprime jamais
export type TriageDecision = 'memoire' | 'surveiller' | 'reserve' | 'action' | 'delete'

// Décision métier → état technique (caché au terrain). AUCUN tag ne supprime :
// seul « delete » (volontaire) pose discarded.
const MAP: Record<TriageDecision, { status: 'kept' | 'discarded'; intent: CaptureTriageIntent }> = {
  memoire: { status: 'kept', intent: null },
  surveiller: { status: 'kept', intent: 'follow' },
  reserve: { status: 'kept', intent: 'reserve' },
  action: { status: 'kept', intent: 'action' },
  delete: { status: 'discarded', intent: null },
}

const schema = z.object({
  capture_id: z.string().uuid(),
  decision: z.enum(['memoire', 'surveiller', 'reserve', 'action', 'delete']),
  /** Commentaire « ce que la capture montre » — photo/vidéo uniquement. */
  comment: z.string().max(500).optional(),
})

export async function triageCaptureAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await setCaptureTriage(parsed.data.capture_id, {
      ...MAP[parsed.data.decision],
      ...(parsed.data.comment !== undefined ? { comment: parsed.data.comment } : {}),
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec du tri' }
  }
}

// ANNULER un choix : re-tap sur le tag déjà choisi → la capture redevient « à
// trier » (status captured, intent null). Le tri n'est jamais définitif tant
// qu'on est dans le débrief : on peut changer d'avis sans friction.
const untriageSchema = z.object({ capture_id: z.string().uuid() })

export async function untriageCaptureAction(
  input: z.input<typeof untriageSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = untriageSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await createAdminClient()
      .from('visit_capture')
      .update({ status: 'captured', triage_intent: null, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.capture_id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}

// ── Matérialiser une SUITE au débrief (tag → objet chantier, validé) ─────────
// MemorIA PROPOSE ; l'humain décide. Rien n'est créé sans cette validation. La
// vérité vit au CHANTIER (site_actions / site_reserve), pas à la visite ; la
// capture d'origine est tracée (source_capture_id) et marquée suite_status='done'.

const createSuiteSchema = z.object({
  capture_id: z.string().uuid(),
  kind: z.enum(['action', 'reserve', 'surveiller']),
  title: z.string().trim().min(1).max(300),
})

export async function createSuiteAction(
  input: z.input<typeof createSuiteSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = createSuiteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const { capture_id, kind, title } = parsed.data
  try {
    const supabase = createAdminClient()
    const { data: cap } = await supabase
      .from('visit_capture')
      .select('report_id, site_id')
      .eq('id', capture_id)
      .maybeSingle()
    const c = cap as { report_id: string; site_id: string } | null
    if (!c) return { ok: false, error: 'Capture introuvable' }

    if (kind === 'action') {
      await createSiteAction({
        site_id: c.site_id, report_id: c.report_id, title,
        created_by: auth.userId, created_from: 'visit_debrief', source_capture_id: capture_id,
      })
    } else if (kind === 'reserve') {
      await createSiteReserve({
        siteId: c.site_id, label: title, location: null,
        issuedBy: auth.userId, issuedOn: new Date().toISOString().slice(0, 10),
        userId: auth.userId, sourceCaptureId: capture_id,
      })
    }
    // 'surveiller' ne crée pas d'objet chantier : c'est un TAG de vigilance. On
    // marque la capture source « à surveiller » (elle remonte aux prochains débriefs).
    const patch =
      kind === 'surveiller'
        ? { triage_intent: 'follow' as const, suite_status: 'done' as const, updated_at: new Date().toISOString() }
        : { suite_status: 'done' as const, updated_at: new Date().toISOString() }
    await supabase.from('visit_capture').update(patch).eq('id', capture_id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la création' }
  }
}

// Écarter (ignore) ou rattacher à un objet existant (attached) : dans les deux cas
// on ne crée rien et on ne repropose plus cette suite.
const resolveSuiteSchema = z.object({
  capture_id: z.string().uuid(),
  resolution: z.enum(['ignored', 'attached']),
})

export async function resolveSuiteAction(
  input: z.input<typeof resolveSuiteSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = resolveSuiteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('visit_capture')
      .update({ suite_status: parsed.data.resolution === 'ignored' ? 'ignored' : 'done', updated_at: new Date().toISOString() })
      .eq('id', parsed.data.capture_id)
    if (error) throw error
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec' }
  }
}

/**
 * Combien de photos seront incluses au CR (sélection par tag + photo clé,
 * plafonnée) vs total capté — pour l'écran de confirmation « X photos seront
 * incluses » avant de générer le PDF. MemorIA garde toutes les photos ; le CR
 * ne montre que ce qui sert à comprendre/décider.
 */
export async function getCrPhotoPlanAction(
  reportId: string,
): Promise<{ included: number; total: number }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { included: 0, total: 0 }
  if (!z.string().uuid().safeParse(reportId).success) return { included: 0, total: 0 }
  try {
    return await getVisitCrPhotoPlan(reportId)
  } catch {
    return { included: 0, total: 0 }
  }
}

/**
 * Renseigne l'OBJET de la visite depuis le terrain (« pourquoi je suis venu »).
 * Champ ciblé — on ne touche à AUCUN autre champ métier (outcome/résolution du
 * bureau restent intacts). Cf. le CR qui affiche « Objet : … ».
 */
export async function setVisitObjectiveAction(
  input: { report_id: string; objective: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = z.object({ report_id: z.string().uuid(), objective: z.string().max(300) }).safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('site_reports')
      .update({ objective: parsed.data.objective.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.report_id)
    if (error) throw error
    return { ok: true }
  } catch {
    return { ok: false, error: "Échec de l'enregistrement de l'objet" }
  }
}

/**
 * Relit les captures pour faire APPARAÎTRE les transcripts dès qu'ils arrivent
 * (le worker transcrit en fond). Le conducteur ne réécoute jamais : il lit. On
 * ne montre jamais un nom de fichier audio.
 */
export async function refreshDebriefCapturesAction(reportId: string): Promise<VisitCaptureRow[]> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return []
  if (!z.string().uuid().safeParse(reportId).success) return []
  try {
    return await listVisitCaptures(reportId)
  } catch {
    return []
  }
}

/**
 * Supprime (soft) une visite non concluante. Elle quitte « Reprendre mon travail »,
 * la liste des visites, et n'est plus ouvrable. Réservé aux visites (jamais une
 * réunion). Scope organisation.
 */
export async function deleteVisitAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = z.object({ report_id: z.string().uuid() }).safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const visit = await getVisit(parsed.data.report_id)
  if (!visit) return { ok: false, error: 'Visite introuvable' }
  const orgId = await getOrgId()
  if (orgId && visit.organization_id && visit.organization_id !== orgId) {
    return { ok: false, error: 'Visite hors organisation' }
  }
  try {
    await deleteVisit(parsed.data.report_id)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Suppression impossible' }
  }
}
