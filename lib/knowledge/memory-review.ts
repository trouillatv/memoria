import 'server-only'

// ── READ MODEL : « QU'EST-CE QUE JE PEUX CONFIRMER ? » ───────────────────────
// L'écran de la Mémoire ne lit AUCUNE table et ne décide d'AUCUN bouton : il
// reçoit des éléments qui portent déjà leur geste (`capability`) et leur
// provenance. C'est la même leçon que la frise, qui affichait deux listes venues
// de deux read models — et que le bug 'watchpoint', où un écran raisonnait sur
// un mot que la base ne connaissait pas.

import { getOrgId } from '@/lib/db/users'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  listProposalsBySite, getPromotionCapability,
  type PromotionCapability, type ProposalKind,
} from '@/lib/db/knowledge-proposals'
import {
  listKnowledgeEntries, listWatchpoints, knowledgeKindLabel,
  type KnowledgeEntryKind,
} from '@/lib/db/site-memory-entries'
import { listDecisionsBySite, type SiteDecision } from '@/lib/db/site-decisions'
import { listSiteIntervenants, type SiteIntervenant } from '@/lib/db/site-intervenants'
import type { DbKnowledgeProposal } from '@/lib/db/knowledge-proposals'
import type { KnowledgeEntry, Watchpoint } from '@/lib/db/site-memory-entries'

/** D'où vient un élément — « Mentionné dans la visite du 15 juillet · 2 mémos ». */
export interface ProposalProvenance {
  reportId: string | null
  /** La date de la VISITE (pas celle de la proposition : c'est le terrain qui
   *  fait foi, l'analyse a pu tourner trois jours plus tard). */
  visitedAt: string | null
  photos: number
  vocals: number
}

/** Un élément à examiner, avec son geste et sa provenance. */
export interface ReviewItem {
  id: string
  kind: ProposalKind
  title: string
  body: string | null
  createdAt: string
  capability: PromotionCapability
  provenance: ProposalProvenance
}

/**
 * Un élément déjà retenu — lu depuis l'OBJET RÉEL (site_knowledge_entries,
 * site_watchpoints, site_decisions, site_intervenants), jamais depuis la
 * proposition qui l'a fait naître. La proposition dit qu'un geste a eu lieu ;
 * seul l'objet dit ce que le chantier sait, et sous quelle nature.
 */
export interface ConfirmedItem {
  id: string
  /** Le groupe d'affichage, avec les mots du conducteur. */
  group: string
  title: string
  /** « Information actuelle » / « Connaissance durable » — la réponse de l'humain,
   *  enfin visible. Sans elle, la question posée à la confirmation n'aurait servi
   *  à rien. */
  nature: string | null
}

export interface MemoryReview {
  /** Ce que le chantier SAIT — validé par un humain. */
  confirmed: ConfirmedItem[]
  /** Ce que MemorIA propose, en attente d'un geste. */
  toReview: ReviewItem[]
}

/**
 * La Mémoire d'un chantier, prête à l'emploi.
 *
 * Ne remonte QUE les types qui vivent dans la Mémoire : connaissances,
 * intervenants, décisions, vigilances. Les actions et les échéances ont leur
 * contexte naturel — le Travail et le Planning — et n'ont rien à faire ici : la
 * Mémoire n'est pas un centre de validation universel.
 */
const MEMORY_KINDS: ProposalKind[] = ['knowledge', 'stakeholder', 'decision', 'vigilance']

export async function getMemoryReview(siteId: string): Promise<MemoryReview> {
  const orgId = await getOrgId()
  // Chaque lecture se protège seule : un objet indisponible ne doit pas rendre
  // toute la Mémoire muette.
  const [rows, entries, watchpoints, decisions, intervenants] = await Promise.all([
    listProposalsBySite(siteId, { status: ['proposed'] }).catch(() => [] as DbKnowledgeProposal[]),
    listKnowledgeEntries(siteId).catch(() => [] as KnowledgeEntry[]),
    listWatchpoints(siteId).catch(() => [] as Watchpoint[]),
    listDecisionsBySite(siteId).catch(() => [] as SiteDecision[]),
    listSiteIntervenants(siteId).catch(() => [] as SiteIntervenant[]),
  ])
  // Garde fail-closed : le service-role bypasse la RLS, l'org se filtre ici.
  const proposed = rows.filter(
    (r) => MEMORY_KINDS.includes(r.kind) && (!orgId || !r.organization_id || r.organization_id === orgId),
  )
  const provenance = await readProvenance([...new Set(proposed.map((r) => r.report_id).filter((id): id is string => !!id))])

  // Ce que le chantier sait, lu dans les objets eux-mêmes. L'ordre suit ce qu'un
  // conducteur cherche : le durable d'abord, le périssable ensuite.
  const confirmed: ConfirmedItem[] = [
    ...entries
      .filter((e) => e.kind === 'durable_knowledge')
      .map((e) => ({ id: e.id, group: 'Ce que le chantier sait', title: e.title, nature: natureOf(e.kind) })),
    ...entries
      .filter((e) => e.kind !== 'durable_knowledge')
      .map((e) => ({ id: e.id, group: 'Ce que le chantier sait', title: e.title, nature: natureOf(e.kind) })),
    ...intervenants.map((i) => ({
      id: i.id, group: 'Intervenants', title: `${i.companyName} — ${i.role}`, nature: null,
    })),
    ...decisions.map((d) => ({ id: d.id, group: 'Décisions', title: d.titre, nature: null })),
    ...watchpoints.map((w) => ({ id: w.id, group: 'Points de vigilance', title: w.title, nature: null })),
  ]

  return {
    confirmed,
    toReview: proposed.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
      capability: getPromotionCapability(r.kind),
      provenance: provenance.get(r.report_id ?? '') ?? { reportId: r.report_id, visitedAt: null, photos: 0, vocals: 0 },
    })),
  }
}

/** La nature d'une information, dite au conducteur — jamais 'durable_knowledge'. */
function natureOf(kind: KnowledgeEntryKind): string {
  return knowledgeKindLabel(kind)
}

/** La visite d'origine et ses preuves. Une provenance absente reste absente :
 *  une proposition peut avoir perdu sa visite (report_id est ON DELETE SET NULL). */
async function readProvenance(reportIds: string[]): Promise<Map<string, ProposalProvenance>> {
  const out = new Map<string, ProposalProvenance>()
  if (reportIds.length === 0) return out
  const db = createAdminClient()
  const [{ data: reports }, { data: caps }] = await Promise.all([
    db.from('site_reports').select('id, started_at, ended_at').in('id', reportIds),
    db.from('visit_capture').select('report_id, kind').in('report_id', reportIds)
      .in('kind', ['photo', 'vocal']).neq('status', 'discarded'),
  ])
  for (const r of (reports ?? []) as Array<{ id: string; started_at: string | null; ended_at: string | null }>) {
    out.set(r.id, { reportId: r.id, visitedAt: r.started_at ?? r.ended_at, photos: 0, vocals: 0 })
  }
  for (const c of (caps ?? []) as Array<{ report_id: string; kind: string }>) {
    const p = out.get(c.report_id)
    if (!p) continue
    if (c.kind === 'photo') p.photos++
    else p.vocals++
  }
  return out
}
