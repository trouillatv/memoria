// DÉCISIONS de chantier (mig 136) — l'objet le plus DURABLE d'un CR : « on a décidé
// que… ». Mémoire du SITE (≠ ajout éditorial de CR). Calqué sur site-actions ; projeté
// dans le spine (PointExamine type 'decision' → Points administratifs).
import { createAdminClient } from '@/lib/supabase/admin'
import { DECISION_STATUTS, DECISION_IMPACTS, type DecisionStatut, type DecisionImpact } from './decision-constants'
import type { PointExamine } from './points-examines'

export { DECISION_STATUTS, DECISION_IMPACTS, type DecisionStatut, type DecisionImpact }

export interface SiteDecision {
  id: string
  siteId: string
  reportId: string | null
  titre: string
  description: string | null
  sujet: string | null
  decisionnaireRole: string | null
  decisionnaireOrg: string | null
  dateDecision: string | null
  echeance: string | null
  statut: DecisionStatut
  impact: DecisionImpact | null
  confiance: 'sûr' | 'à confirmer'
  source: 'meeting' | 'transcript' | 'human'
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
    dateDecision: (r.date_decision as string | null) ?? null,
    echeance: (r.echeance as string | null) ?? null,
    statut: (DECISION_STATUTS as readonly string[]).includes(r.statut as string) ? (r.statut as DecisionStatut) : 'actee',
    impact: (DECISION_IMPACTS as readonly string[]).includes(r.impact as string) ? (r.impact as DecisionImpact) : null,
    confiance: (r.confiance as string) === 'à confirmer' ? 'à confirmer' : 'sûr',
    source: (['meeting', 'transcript', 'human'].includes(r.source as string) ? r.source : 'human') as SiteDecision['source'],
  }
}

const SELECT =
  'id, site_id, report_id, titre, description, sujet, decisionnaire_role, decisionnaire_org, date_decision, echeance, statut, impact, confiance, source'

/** Décisions PRISES dans ce CR (report_id), les plus récentes d'abord. */
export async function listDecisionsByReport(reportId: string): Promise<SiteDecision[]> {
  const { data } = await createAdminClient()
    .from('site_decisions')
    .select(SELECT)
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  return (data ?? []).map(rowToDecision)
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
  dateDecision?: string | null
  echeance?: string | null
  statut?: DecisionStatut
  impact?: DecisionImpact | null
  confiance?: 'sûr' | 'à confirmer'
  source?: 'meeting' | 'transcript' | 'human'
  createdBy?: string | null
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
    echeance: input.echeance || null,
    statut: input.statut ?? 'actee',        // MVP : ajout manuel = actée
    impact: input.impact ?? null,
    confiance: input.confiance ?? 'sûr',     // MVP : ajout manuel = sûr
    source: input.source ?? 'human',         // MVP : ajout manuel = human
    created_by: input.createdBy ?? null,
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
  return data.id as string
}

export interface UpdateDecisionPatch {
  titre?: string
  description?: string | null
  sujet?: string | null
  decisionnaireRole?: string | null
  echeance?: string | null
  statut?: DecisionStatut
  impact?: DecisionImpact | null
  confiance?: 'sûr' | 'à confirmer'
}

/** Édition scopée au site (garde-fou : on ne modifie que les décisions de son org). */
export async function updateSiteDecision(siteId: string, id: string, patch: UpdateDecisionPatch): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.titre !== undefined) row.titre = patch.titre.trim()
  if (patch.description !== undefined) row.description = patch.description?.trim() || null
  if (patch.sujet !== undefined) row.sujet = patch.sujet?.trim() || null
  if (patch.decisionnaireRole !== undefined) row.decisionnaire_role = patch.decisionnaireRole?.trim() || null
  if (patch.echeance !== undefined) row.echeance = patch.echeance || null
  if (patch.statut !== undefined) row.statut = patch.statut
  if (patch.impact !== undefined) row.impact = patch.impact
  if (patch.confiance !== undefined) row.confiance = patch.confiance
  const { error } = await createAdminClient().from('site_decisions').update(row).eq('id', id).eq('site_id', siteId)
  if (error) throw new Error(error.message)
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
