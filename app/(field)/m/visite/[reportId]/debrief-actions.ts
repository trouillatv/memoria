'use server'

// Débrief express (voiture) — server action du TRI (mig 168).
// 4 décisions métier seulement. Le tri ENREGISTRE le choix ; la matérialisation
// (action, lien sujet, projection) est faite au bureau. Cf. [[visite-trois-temps]].

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireFieldAgent } from '@/lib/field/auth'
import { getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSiteAction } from '@/lib/db/site-actions'
import { createSiteReserve } from '@/lib/db/site-reserve'
import { curateProposal, markProposalCreated } from '@/lib/db/site-reports'
import { markWatchlistItemPromoted } from '@/lib/db/visit-watchlist'
import { getVisit, deleteVisit, finalizeVisit } from '@/lib/db/visits'
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
  // Proposition IA persistée (mig 194) — son cycle proposed→accepted vit dans
  // site_report_proposals, comme pour une réunion. Absent pour une suite taguée.
  proposal_id: z.string().uuid().optional(),
})

export async function createSuiteAction(
  input: z.input<typeof createSuiteSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = createSuiteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const { capture_id, kind, title, proposal_id } = parsed.data
  try {
    const supabase = createAdminClient()
    const { data: cap } = await supabase
      .from('visit_capture')
      .select('report_id, site_id')
      .eq('id', capture_id)
      .maybeSingle()
    const c = cap as { report_id: string; site_id: string } | null
    if (!c) return { ok: false, error: 'Capture introuvable' }

    let entity: { type: string; id: string } | null = null
    if (kind === 'action') {
      const actionId = await createSiteAction({
        site_id: c.site_id, report_id: c.report_id, title,
        created_by: auth.userId, created_from: 'visit_debrief', source_capture_id: capture_id,
      })
      entity = { type: 'site_action', id: actionId }
    } else if (kind === 'reserve') {
      const reserve = await createSiteReserve({
        siteId: c.site_id, label: title, location: null,
        issuedBy: auth.userId, issuedOn: new Date().toISOString().slice(0, 10),
        userId: auth.userId, sourceCaptureId: capture_id,
      })
      entity = { type: 'site_reserve', id: reserve.id }
    }

    if (proposal_id) {
      // Proposition IA : la décision vit dans site_report_proposals. On ne touche
      // PAS suite_status (la capture est 'analyzed' ; ses autres propositions
      // restent en attente). 'surveiller' pose quand même le tag de vigilance.
      await curateProposal(proposal_id, { short_label: title, status: 'accepted' })
      if (entity) await markProposalCreated(proposal_id, entity.type, entity.id)
      if (kind === 'surveiller') {
        await supabase.from('visit_capture')
          .update({ triage_intent: 'follow', updated_at: new Date().toISOString() })
          .eq('id', capture_id)
      }
      return { ok: true }
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
  // Proposition IA persistée (mig 194) — la décision se pose sur la ligne
  // site_report_proposals, pas sur la capture (qui reste 'analyzed').
  proposal_id: z.string().uuid().optional(),
})

export async function resolveSuiteAction(
  input: z.input<typeof resolveSuiteSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = resolveSuiteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    if (parsed.data.proposal_id) {
      await curateProposal(parsed.data.proposal_id, {
        status: parsed.data.resolution === 'ignored' ? 'rejected' : 'accepted',
      })
      return { ok: true }
    }
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

// ── Promotion HUMAINE d'un point « à suivre » (mig 196) ─────────────────────
// Un point de la liste « À vérifier » resté ouvert peut devenir un objet
// chantier — sur DÉCISION du conducteur, jamais automatiquement.

const promoteWatchSchema = z.object({
  item_id: z.string().uuid(),
  promote_to: z.enum(['action', 'reserve']),
})

export async function promoteWatchlistItemAction(
  input: z.input<typeof promoteWatchSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = promoteWatchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('visit_watchlist_item')
      .select('id, report_id, site_id, label, promoted_ref')
      .eq('id', parsed.data.item_id)
      .maybeSingle()
    const item = data as { id: string; report_id: string; site_id: string; label: string; promoted_ref: string | null } | null
    if (!item) return { ok: false, error: 'Point introuvable' }
    if (item.promoted_ref) return { ok: true } // déjà promu : idempotent

    let refId: string
    if (parsed.data.promote_to === 'action') {
      refId = await createSiteAction({
        site_id: item.site_id, report_id: item.report_id, title: item.label,
        created_by: auth.userId, created_from: 'visit_watchlist',
      })
    } else {
      const reserve = await createSiteReserve({
        siteId: item.site_id, label: item.label, location: null,
        issuedBy: auth.userId, issuedOn: new Date().toISOString().slice(0, 10),
        userId: auth.userId,
      })
      refId = reserve.id
    }
    await markWatchlistItemPromoted(item.id, parsed.data.promote_to, refId)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la promotion' }
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
    const affected = await deleteVisit(parsed.data.report_id)
    // Écriture VÉRIFIÉE : si 0 ligne écrite, on ne prétend PAS avoir supprimé
    // (sinon la carte se cache puis la visite réapparaît au rafraîchissement).
    if (affected === 0) return { ok: false, error: "La visite n'a pas pu être écartée" }
    // La visite écartée doit disparaître d'« Aujourd'hui » (Reprendre mon travail)
    // ET de la fiche chantier — sinon le cache de route la ferait persister.
    revalidatePath('/m')
    if (visit.site_id) revalidatePath(`/m/site/${visit.site_id}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Suppression impossible' }
  }
}

/**
 * VALIDER DÉFINITIVEMENT la visite (bouton « Terminer la visite » du débrief).
 * C'est le point final : la visite doit alors quitter « Reprendre mon travail »
 * (elle est faite). Or « Tri restant » ne compte que les captures encore à trier
 * (status = 'captured'). Une capture laissée « À trier » suffisait à la faire
 * traîner comme « pas effectuée ».
 *
 * Règle produit : « non trié = gardé en mémoire » (rien n'est jamais perdu). On
 * bascule donc les captures restantes en 'kept' (Mémoire) → plus rien « à trier »
 * → la visite est effectuée. On s'assure aussi que ended_at est posé.
 */
export async function finalizeVisitAction(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = z.object({ report_id: z.string().uuid() }).safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  const visit = await getVisit(parsed.data.report_id)
  if (!visit) return { ok: false, error: 'Visite introuvable' }
  const orgId = await getOrgId()
  // Scope organisation (le client admin bypasse les RLS → ce contrôle applicatif
  // est LA barrière). Les null (visites/utilisateurs historiques d'avant le
  // multi-org) passent : choix assumé, cohérent avec deleteVisitAction ci-dessus.
  if (orgId && visit.organization_id && visit.organization_id !== orgId) {
    return { ok: false, error: 'Visite hors organisation' }
  }
  try {
    // Cœur testable (lib/db/visits.finalizeVisit) : écritures VÉRIFIÉES, ordre
    // filet (captures d'abord — un échec sur ended_at laisse la visite visible
    // dans « Reprendre mon travail », jamais perdue), idempotent.
    const result = await finalizeVisit(parsed.data.report_id)
    if (!result.ok) return result

    revalidatePath('/m')
    if (visit.site_id) revalidatePath(`/m/site/${visit.site_id}`)
    revalidatePath(`/m/visite/${parsed.data.report_id}`)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec de la clôture de la visite' }
  }
}
