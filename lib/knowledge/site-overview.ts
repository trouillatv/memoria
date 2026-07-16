import 'server-only'

// ── READ MODEL : SiteOverview ────────────────────────────────────────────────
// LE CONTRAT PUBLIC de la connaissance d'un chantier pour l'écran « Aperçu » (fiche
// chantier desktop + mobile). Les composants ne connaissent QUE ce type — jamais
// ActionProjection / ProposalProjection / les tables. Il COMPOSE les projections
// métier (proposé) et les repositories (validé) ; il ne contient aucune mutation et
// n'accède pas directement à Supabase (il passe par la couche projection/repository).
//
// Règle de forme : JAMAIS `undefined`. Chaque section existe toujours, avec des
// tableaux vides et des compteurs à 0 → les composants sont quasiment sans `if`.
//
// NB : le « ici et maintenant » terrain (visites du jour, captures en attente,
// présence) N'EST PAS ici — il vit dans un read model distinct `getSiteFieldToday`
// (mobile), pour que SiteOverview ne grossisse pas pour un seul écran.

import { getSiteProjection, emptySiteProjection, type ProposalProjection } from '@/lib/knowledge/projection'
import {
  readSiteActionSummaries,
  readLatestVisitSynthesis,
  type ActionSummaryRow,
} from '@/lib/knowledge/repository'
import { getSiteIdentity, listSiteASavoirActive } from '@/lib/db/sites'
import { listSiteIntervenants } from '@/lib/db/site-intervenants'
import { getSiteRecentActivity } from '@/lib/db/visits'

const TOP = 3
const HISTORY_LIMIT = 5
/** Un verrou de génération plus vieux que ça est considéré comme abandonné (cf. débrief). */
const GENERATING_LEASE_MS = 120_000

export interface KnowledgeItem { id: string; title: string }
export interface HistoryItem { id: string; label: string; at: string; kind: string; href: string; detail: string | null }

/** Section uniforme d'un objet de connaissance : proposé (à confirmer) vs validé. */
export interface KnowledgeSection {
  proposed: KnowledgeItem[]
  confirmed: KnowledgeItem[]
  counts: { proposed: number; confirmed: number }
}

/** L'objet Action a des compteurs métier supplémentaires (retard / terminées). */
export interface ActionsSection {
  proposed: KnowledgeItem[]
  confirmed: KnowledgeItem[] // actions actives (open/planned)
  counts: { proposed: number; confirmed: number; overdue: number; completed: number }
}

export type SynthesisStatus = 'missing' | 'up_to_date' | 'outdated' | 'generating'

export interface SiteOverview {
  identity: { id: string; name: string; clientName: string | null }
  synthesis: {
    status: SynthesisStatus
    latestVisit: { reportId: string; endedAt: string | null } | null
  }
  actions: ActionsSection
  watchpoints: KnowledgeSection
  deadlines: KnowledgeSection
  stakeholders: KnowledgeSection
  knowledge: KnowledgeSection
  history: HistoryItem[]
}

/** Section « proposé seul » (objet validé pas encore modélisé, ex. vigilances). */
function proposedOnly(p: ProposalProjection): KnowledgeSection {
  return { proposed: p.proposedTop.slice(0, TOP), confirmed: [], counts: { proposed: p.proposed, confirmed: 0 } }
}

/** Section « proposé + validé ». */
function proposedAndConfirmed(p: ProposalProjection, confirmed: KnowledgeItem[], confirmedTotal: number): KnowledgeSection {
  return {
    proposed: p.proposedTop.slice(0, TOP),
    confirmed: confirmed.slice(0, TOP),
    counts: { proposed: p.proposed, confirmed: confirmedTotal },
  }
}

/**
 * Contrat public de la connaissance d'un chantier. Ne throw jamais : chaque source
 * a son repli, et la forme est toujours complète (aucun `undefined`).
 */
export async function getSiteOverview(siteId: string): Promise<SiteOverview> {
  const [proj, actionRows, aSavoir, intervenants, recent, identity, synth] = await Promise.all([
    getSiteProjection(siteId).catch(() => emptySiteProjection()),
    readSiteActionSummaries(siteId).catch(() => [] as ActionSummaryRow[]),
    listSiteASavoirActive(siteId).catch(() => []),
    listSiteIntervenants(siteId).catch(() => []),
    getSiteRecentActivity(siteId, HISTORY_LIMIT).catch(() => []),
    getSiteIdentity(siteId).catch(() => null),
    readLatestVisitSynthesis(siteId).catch(() => null),
  ])

  // ── Actions : proposé (projection) + validé (site_actions actives) ──
  const active = actionRows.filter((a) => a.status === 'open' || a.status === 'planned')
  const completed = actionRows.filter((a) => a.status === 'done').length
  const todayIso = new Date().toISOString().slice(0, 10)
  const overdue = active.filter((a) => a.due_date && a.due_date.slice(0, 10) < todayIso).length
  const actions: ActionsSection = {
    proposed: proj.actions.proposedTop.slice(0, TOP),
    confirmed: active.slice(0, TOP).map((a) => ({ id: a.id, title: a.title })),
    counts: { proposed: proj.actions.proposed, confirmed: active.length, overdue, completed },
  }

  // ── Connaissances « à savoir » validées (site_notes a_savoir) ──
  const knowledgeConfirmed: KnowledgeItem[] = aSavoir.map((n) => ({ id: n.id, title: n.body }))

  // ── Intervenants validés (casting actif) ──
  const stakeholderConfirmed: KnowledgeItem[] = intervenants.map((it) => ({
    id: it.id,
    title: [it.contactName, it.companyName].filter(Boolean).join(' · ') || it.role,
  }))

  // ── État de synthèse de la dernière visite (sans regénérer) ──
  let status: SynthesisStatus = 'missing'
  let latestVisit: SiteOverview['synthesis']['latestVisit'] = null
  if (synth) {
    latestVisit = { reportId: synth.reportId, endedAt: synth.endedAt }
    const generating = synth.generatingAt != null && (Date.parse(synth.generatingAt) > 0)
      && (Date.now() - Date.parse(synth.generatingAt) < GENERATING_LEASE_MS)
    // 'outdated' (visite enrichie depuis la synthèse) = comparaison de corpus, à
    // brancher quand l'objet Synthèse sera structuré ; on reste sur up_to_date ici.
    status = generating ? 'generating' : synth.hasAnalysis ? 'up_to_date' : 'missing'
  }

  return {
    identity: { id: siteId, name: identity?.name ?? '', clientName: identity?.clientName ?? null },
    synthesis: { status, latestVisit },
    actions,
    watchpoints: proposedOnly(proj.watchpoints),
    deadlines: proposedOnly(proj.deadlines),
    stakeholders: proposedAndConfirmed(proj.stakeholders, stakeholderConfirmed, stakeholderConfirmed.length),
    knowledge: proposedAndConfirmed(proj.knowledge, knowledgeConfirmed, knowledgeConfirmed.length),
    history: recent.map((a) => ({
      id: a.reportId ?? a.href,
      label: a.label,
      at: a.at,
      kind: a.kind,
      href: a.href,
      detail: a.detail,
    })),
  }
}
