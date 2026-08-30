import 'server-only'

// #231 Aperçu Lot C — population AGRÉGÉE au niveau chantier des propositions d'action
// en attente de décision humaine (status='proposed'), TOUTES visites/imports confondus.
//
// C'est la destination du compteur « N proposées » de l'Aperçu : un compteur agrégé
// au niveau chantier doit ouvrir une population agrégée au niveau chantier. La
// sémantique du compteur (prouvée correcte en #231 Phase 1) n'est pas modifiée — on
// lit EXACTEMENT la même population que `getSiteProjection().actions.proposed`
// (site_knowledge_proposals, kind=action, status=proposed), avec la provenance.

import { listProposalsBySite } from '@/lib/db/knowledge-proposals'
import { readReportMeta, classifyProvenance, type ProvenanceType } from '@/lib/knowledge/repository'

const PROV_LABEL: Record<ProvenanceType, string> = {
  pv_historique: 'PV', visite: 'Visite', reunion: 'Réunion', manuel: 'Manuel', autre: 'Rapport',
}

export interface PendingActionProposal {
  id: string
  title: string
  /** Provenance lisible : « PV · avr. 2026 », « Visite · juin 2026 »… */
  provenanceLabel: string
  provenanceDate: string | null
  /** Page d'arbitrage du report d'origine (là où on confirme cette proposition). */
  reportHref: string | null
  createdAt: string
}

/**
 * Toutes les propositions d'action en attente du chantier, triées par report puis
 * date. La liste EST la population (son `.length` = le compteur « N proposées »).
 */
export async function getSitePendingActionProposals(siteId: string): Promise<PendingActionProposal[]> {
  const rows = await listProposalsBySite(siteId, { kind: 'action', status: 'proposed' }).catch(() => [])
  if (rows.length === 0) return []

  const reportIds = [...new Set(rows.map((r) => r.report_id).filter((x): x is string => !!x))]
  const meta = await readReportMeta(reportIds)

  return rows.map((r) => {
    const m = r.report_id ? meta.get(r.report_id) : undefined
    const prov = classifyProvenance(m, Boolean(r.report_id))
    const date = m?.started_at
      ? new Date(m.started_at).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
      : null
    return {
      id: r.id,
      title: r.title,
      provenanceLabel: PROV_LABEL[prov],
      provenanceDate: date,
      // Destination = la page d'arbitrage réelle (PanneauArbitrage, confirmer/écarter),
      // pas la visite générique qui n'a aucun CTA sur ces propositions.
      reportHref: r.report_id ? `/sites/${siteId}/visites/${r.report_id}/compte-rendu` : null,
      createdAt: r.created_at,
    }
  }).sort((a, b) =>
    (a.reportHref ?? '').localeCompare(b.reportHref ?? '') || a.createdAt.localeCompare(b.createdAt),
  )
}
