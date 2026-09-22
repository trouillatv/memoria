// DÉCISIONS de chantier (mig 136) — l'objet le plus DURABLE d'un CR : « on a décidé
// que… ». Mémoire du SITE (≠ ajout éditorial de CR). Calqué sur site-actions ; projeté
// dans le spine (PointExamine type 'decision' → Points administratifs).
import { createAdminClient } from '@/lib/supabase/admin'
import { invalidateSiteProjection } from '@/lib/knowledge/invalidate'
import {
  DECISION_STATUTS,
  DECISION_IMPACTS,
  DECISION_PERTINENCE_TERRAIN,
  type DecisionStatut,
  type DecisionImpact,
  type DecisionPertinenceTerrain,
} from './decision-constants'
import type { PointExamine } from './points-examines'

export {
  DECISION_STATUTS,
  DECISION_IMPACTS,
  DECISION_PERTINENCE_TERRAIN,
  type DecisionStatut,
  type DecisionImpact,
  type DecisionPertinenceTerrain,
}

export interface SiteDecision {
  id: string
  siteId: string
  reportId: string | null
  titre: string
  description: string | null
  sujet: string | null
  decisionnaireRole: string | null
  decisionnaireOrg: string | null
  decisionnaireContactId: string | null
  actionId: string | null
  subjectId: string | null
  dateDecision: string | null
  echeance: string | null
  statut: DecisionStatut
  impact: DecisionImpact | null
  confiance: 'sûr' | 'à confirmer'
  source: 'meeting' | 'transcript' | 'human'
  /** Décision qui REMPLACE celle-ci (mig 319). NULL = jamais remplacée. */
  supersededBy: string | null
  /** NULL = legacy_unknown (jamais classifiée, cf. decision-constants.ts). */
  pertinenceTerrain: DecisionPertinenceTerrain | null
}

function rowToDecision(r: Record<string, unknown>): SiteDecision {
  return {
    id: r.id as string,
    siteId: r.site_id as string,
    reportId: (r.report_id as string | null) ?? null,
    titre: (r.titre as string) ?? '',
    description: (r.description as string | null) ?? null,
    sujet: (r.sujet as string | null) ?? null,
    decisionnaireRole: (r.decisionnaire_role as string | null) ?? null,
    decisionnaireOrg: (r.decisionnaire_org as string | null) ?? null,
    decisionnaireContactId: (r.decisionnaire_contact_id as string | null) ?? null,
    actionId: (r.action_id as string | null) ?? null,
    subjectId: (r.subject_id as string | null) ?? null,
    dateDecision: (r.date_decision as string | null) ?? null,
    echeance: (r.echeance as string | null) ?? null,
    statut: (DECISION_STATUTS as readonly string[]).includes(r.statut as string) ? (r.statut as DecisionStatut) : 'actee',
    impact: (DECISION_IMPACTS as readonly string[]).includes(r.impact as string) ? (r.impact as DecisionImpact) : null,
    confiance: (r.confiance as string) === 'à confirmer' ? 'à confirmer' : 'sûr',
    source: (['meeting', 'transcript', 'human'].includes(r.source as string) ? r.source : 'human') as SiteDecision['source'],
    supersededBy: (r.superseded_by as string | null) ?? null,
    pertinenceTerrain: (DECISION_PERTINENCE_TERRAIN as readonly string[]).includes(r.pertinence_terrain as string)
      ? (r.pertinence_terrain as DecisionPertinenceTerrain)
      : null,
  }
}

const SELECT =
  'id, site_id, report_id, titre, description, sujet, decisionnaire_role, decisionnaire_org, decisionnaire_contact_id, action_id, subject_id, date_decision, echeance, statut, impact, confiance, source, superseded_by, pertinence_terrain'

/** Décisions PRISES dans ce CR (report_id), les plus récentes d'abord. */
export async function listDecisionsByReport(reportId: string): Promise<SiteDecision[]> {
  const { data } = await createAdminClient()
    .from('site_decisions')
    .select(SELECT)
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  return (data ?? []).map(rowToDecision)
}

/** UNE décision, scopée au chantier (garde IDOR). `null` si absente. */
export async function getSiteDecision(siteId: string, id: string): Promise<SiteDecision | null> {
  const { data } = await createAdminClient()
    .from('site_decisions')
    .select(SELECT)
    .eq('id', id)
    .eq('site_id', siteId)
    .maybeSingle()
  return data ? rowToDecision(data as Record<string, unknown>) : null
}

/** Toutes les décisions d'un site (recherche mémoire / cross-CR / contradictions). */
export async function listDecisionsBySite(siteId: string): Promise<SiteDecision[]> {
  const { data } = await createAdminClient()
    .from('site_decisions')
    .select(SELECT)
    .eq('site_id', siteId)
    .order('date_decision', { ascending: false })
  return (data ?? []).map(rowToDecision)
}

export interface CreateDecisionInput {
  siteId: string
  reportId: string | null
  titre: string
  description?: string | null
  sujet?: string | null
  decisionnaireRole?: string | null
  decisionnaireOrg?: string | null
  decisionnaireContactId?: string | null
  actionId?: string | null
  dateDecision?: string | null
  echeance?: string | null
  statut?: DecisionStatut
  impact?: DecisionImpact | null
  confiance?: 'sûr' | 'à confirmer'
  source?: 'meeting' | 'transcript' | 'human'
  createdBy?: string | null
  /** Choix humain explicite au moment d'acter la décision (mig 431). NULL/absent = legacy_unknown. */
  pertinenceTerrain?: DecisionPertinenceTerrain | null
  /** Id d'une décision EXISTANTE que celle-ci remplace (mig 319). Marque l'ancienne `superseded_by`. */
  supersedesId?: string | null
}

export async function createSiteDecision(input: CreateDecisionInput): Promise<string> {
  const row: Record<string, unknown> = {
    site_id: input.siteId,
    report_id: input.reportId,
    titre: input.titre.trim(),
    description: input.description?.trim() || null,
    sujet: input.sujet?.trim() || null,
    decisionnaire_role: input.decisionnaireRole?.trim() || null,
    decisionnaire_org: input.decisionnaireOrg?.trim() || null,
    decisionnaire_contact_id: input.decisionnaireContactId || null,
    action_id: input.actionId || null,
    echeance: input.echeance || null,
    statut: input.statut ?? 'actee',        // MVP : ajout manuel = actée
    impact: input.impact ?? null,
    confiance: input.confiance ?? 'sûr',     // MVP : ajout manuel = sûr
    source: input.source ?? 'human',         // MVP : ajout manuel = human
    created_by: input.createdBy ?? null,
    pertinence_terrain: input.pertinenceTerrain ?? null,
  }
  // date_decision : on OMET le champ si absent → laisse le défaut DB (current_date),
  // plutôt que d'envoyer null (qui violerait le not-null).
  if (input.dateDecision) row.date_decision = input.dateDecision
  const { data, error } = await createAdminClient()
    .from('site_decisions')
    .insert(row)
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  // C'est la MUTATION qui invalide, jamais l'écran (cf. lib/knowledge/invalidate).
  // Cette ligne manquait : `createSiteAction`, `createSiteDeadline`,
  // `createKnowledgeEntry` et `createWatchpoint` l'avaient, pas les décisions.
  // Une décision confirmée n'apparaissait donc pas avant l'expiration du TTL.
  invalidateSiteProjection(input.siteId)
  const newId = data.id as string
  if (input.supersedesId) await markDecisionSuperseded(input.siteId, input.supersedesId, newId)
  return newId
}

export interface UpdateDecisionPatch {
  titre?: string
  description?: string | null
  sujet?: string | null
  decisionnaireRole?: string | null
  decisionnaireContactId?: string | null
  actionId?: string | null
  echeance?: string | null
  statut?: DecisionStatut
  impact?: DecisionImpact | null
  confiance?: 'sûr' | 'à confirmer'
  pertinenceTerrain?: DecisionPertinenceTerrain | null
  /** Id d'une décision EXISTANTE que celle-ci remplace (mig 319). Marque l'ancienne `superseded_by`. */
  supersedesId?: string | null
}

/** Édition scopée au site (garde-fou : on ne modifie que les décisions de son org). */
export async function updateSiteDecision(siteId: string, id: string, patch: UpdateDecisionPatch): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.titre !== undefined) row.titre = patch.titre.trim()
  if (patch.description !== undefined) row.description = patch.description?.trim() || null
  if (patch.sujet !== undefined) row.sujet = patch.sujet?.trim() || null
  if (patch.decisionnaireRole !== undefined) row.decisionnaire_role = patch.decisionnaireRole?.trim() || null
  if (patch.decisionnaireContactId !== undefined) row.decisionnaire_contact_id = patch.decisionnaireContactId || null
  if (patch.actionId !== undefined) row.action_id = patch.actionId || null
  if (patch.echeance !== undefined) row.echeance = patch.echeance || null
  if (patch.statut !== undefined) row.statut = patch.statut
  if (patch.impact !== undefined) row.impact = patch.impact
  if (patch.confiance !== undefined) row.confiance = patch.confiance
  if (patch.pertinenceTerrain !== undefined) row.pertinence_terrain = patch.pertinenceTerrain
  const { error } = await createAdminClient().from('site_decisions').update(row).eq('id', id).eq('site_id', siteId)
  if (error) throw new Error(error.message)
  if (patch.supersedesId) await markDecisionSuperseded(siteId, patch.supersedesId, id)
}

/** Chaîne `ancienne → remplacée par → nouvelle` (mig 319). Jamais automatique :
 *  seul un choix humain explicite au moment de créer/éditer une décision
 *  appelle cette fonction (cf. PvDecisionsBlock « remplace la décision… »). */
export async function markDecisionSuperseded(siteId: string, oldDecisionId: string, newDecisionId: string): Promise<void> {
  if (oldDecisionId === newDecisionId) return
  const { error } = await createAdminClient()
    .from('site_decisions')
    .update({ superseded_by: newDecisionId, superseded_at: new Date().toISOString() })
    .eq('id', oldDecisionId)
    .eq('site_id', siteId) // garde IDOR : on ne remplace qu'une décision de son propre site
  if (error) throw new Error(error.message)
  invalidateSiteProjection(siteId)
}

export async function deleteSiteDecision(siteId: string, id: string): Promise<void> {
  const { error } = await createAdminClient().from('site_decisions').delete().eq('id', id).eq('site_id', siteId)
  if (error) throw new Error(error.message)
}

const STATUT_SUFFIX: Record<DecisionStatut, string> = {
  proposee: ' (proposée — à confirmer)',
  actee: '',
  appliquee: ' (appliquée)',
  caduque: ' (caduque)',
  contredite: ' (contredite)',
}

/** Projection vers le spine : décisions du CR → PointExamine type 'decision'
 *  (routé vers Points administratifs). Source stable `decision:<id>`. */
export async function listDecisionsAsPoints(reportId: string): Promise<PointExamine[]> {
  const decisions = await listDecisionsByReport(reportId)
  return decisions
    .filter((d) => d.statut !== 'caduque') // une décision caduque n'encombre pas le CR
    .map((d) => {
      const who = d.decisionnaireOrg || d.decisionnaireRole
      const corps = d.description ? `${d.titre} — ${d.description}` : d.titre
      const texte = `${corps}${who ? ` (${who})` : ''}${STATUT_SUFFIX[d.statut]}`
      return {
        type: 'decision',
        sousTitre: 'DÉCISIONS',
        texte,
        action: null,
        statut: null,
        source: `decision:${d.id}`,
        confiance: d.confiance,
      }
    })
}
