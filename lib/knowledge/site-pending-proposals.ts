import 'server-only'

// #231 Aperçu Lot C — population AGRÉGÉE au niveau chantier des propositions d'action
// en attente de décision humaine (status='proposed'), TOUTES visites/imports confondus.
//
// C'est la destination du compteur « N proposées » de l'Aperçu : un compteur agrégé
// au niveau chantier doit ouvrir une population agrégée au niveau chantier. La
// sémantique du compteur (prouvée correcte en #231 Phase 1) n'est pas modifiée — on
// lit EXACTEMENT la même population que `getSiteProjection().actions.proposed`
// (site_knowledge_proposals, kind=action, status=proposed), avec la provenance.

import { listProposalsBySite, getCanonicalSubjectLabels, type ProposalKind } from '@/lib/db/knowledge-proposals'
import { readReportMeta, classifyProvenance, type ProvenanceType } from '@/lib/knowledge/repository'

const PROV_LABEL: Record<ProvenanceType, string> = {
  pv_historique: 'PV', visite: 'Visite', reunion: 'Réunion', manuel: 'Manuel', autre: 'Rapport',
}

export interface PendingActionProposal {
  id: string
  /** SUIVI-2A — distingue Action / Échéance dans une liste désormais mixte côté UI. */
  kind: ProposalKind
  title: string
  body: string | null
  owner: string | null
  canonicalSubjectId: string | null
  canonicalSubjectLabel: string | null
  /** Provenance lisible : « PV · avr. 2026 », « Visite · juin 2026 »… */
  provenanceLabel: string
  provenanceDate: string | null
  /** Preuve : la visite/PV d'origine (accès SECONDAIRE — P0-1, l'objet se
   *  gère depuis Actions, la source explique seulement pourquoi il existe). */
  reportHref: string | null
  createdAt: string
}

/** Requête + assemblage partagés par kind — seule différence entre les
 *  populations « action » et « deadline » en attente : le filtre `kind`. */
async function queryPendingProposals(siteId: string, kind: ProposalKind): Promise<PendingActionProposal[]> {
  const rows = await listProposalsBySite(siteId, { kind, status: 'proposed' }).catch(() => [])
  if (rows.length === 0) return []

  const reportIds = [...new Set(rows.map((r) => r.report_id).filter((x): x is string => !!x))]
  const subjectIds = [...new Set(rows.map((r) => r.canonical_subject_id).filter((x): x is string => !!x))]
  const [meta, subjectLabels] = await Promise.all([
    readReportMeta(reportIds),
    getCanonicalSubjectLabels(subjectIds),
  ])

  return rows.map((r) => {
    const m = r.report_id ? meta.get(r.report_id) : undefined
    const prov = classifyProvenance(m, Boolean(r.report_id))
    const date = m?.started_at
      ? new Date(m.started_at).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
      : null
    const payload = (r.payload ?? {}) as { owner?: string | null }
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      owner: payload.owner ?? null,
      canonicalSubjectId: r.canonical_subject_id ?? null,
      canonicalSubjectLabel: r.canonical_subject_id ? subjectLabels.get(r.canonical_subject_id) ?? null : null,
      provenanceLabel: PROV_LABEL[prov],
      provenanceDate: date,
      // « Voir la visite source » → la PAGE PRINCIPALE de la visite (l'objet),
      // pas /compte-rendu (sous-espace d'édition du CR). Depuis la visite, on
      // accède ensuite au CR, aux photos, aux objets produits, à l'archive.
      reportHref: r.report_id ? `/sites/${siteId}/visites/${r.report_id}` : null,
      createdAt: r.created_at,
    }
  }).sort((a, b) =>
    (a.reportHref ?? '').localeCompare(b.reportHref ?? '') || a.createdAt.localeCompare(b.createdAt),
  )
}

/**
 * Toutes les propositions d'action en attente du chantier, triées par report puis
 * date. La liste EST la population (son `.length` = le compteur « N proposées »
 * de l'Aperçu — #231, kind='action' UNIQUEMENT, jamais mêlée à d'autres kinds).
 */
export async function getSitePendingActionProposals(siteId: string): Promise<PendingActionProposal[]> {
  return queryPendingProposals(siteId, 'action')
}

/**
 * SUIVI-2A — mêmes propositions en attente, pour les ÉCHÉANCES (kind='deadline').
 * Population DISTINCTE de `getSitePendingActionProposals` : ne participe pas au
 * compteur « N proposées » de l'Aperçu, qui reste actions-only par doctrine #231.
 */
export async function getSitePendingDeadlineProposals(siteId: string): Promise<PendingActionProposal[]> {
  return queryPendingProposals(siteId, 'deadline')
}
