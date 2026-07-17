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

/** Un élément déjà retenu par un humain. */
export interface ConfirmedItem {
  id: string
  kind: ProposalKind
  title: string
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
  const rows = await listProposalsBySite(siteId, { status: ['proposed', 'confirmed'] }).catch(() => [])
  // Garde fail-closed : le service-role bypasse la RLS, l'org se filtre ici.
  const mine = rows.filter(
    (r) => MEMORY_KINDS.includes(r.kind) && (!orgId || !r.organization_id || r.organization_id === orgId),
  )

  const proposed = mine.filter((r) => r.status === 'proposed')
  const provenance = await readProvenance([...new Set(proposed.map((r) => r.report_id).filter((id): id is string => !!id))])

  return {
    confirmed: mine
      .filter((r) => r.status === 'confirmed')
      .map((r) => ({ id: r.id, kind: r.kind, title: r.title })),
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
