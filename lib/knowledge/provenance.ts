import 'server-only'

// ── « POURQUOI ? » — LA PREUVE CIBLÉE ────────────────────────────────────────
// Objectif du moteur d'explication : « en moins de 5 secondes, je comprends
// pourquoi MemorIA a proposé ceci » — une logique de PREUVE, pas d'affichage
// exhaustif du contenu source (Vincent, 2026-07-28).
//
// Le bloc remonte, dans cet ordre de lecture :
//   1. STATUT de la proposition (validée / en attente / rejetée / remplacée) ;
//   2. DÉTECTÉ LE — le jour où MemorIA a créé la proposition ;
//   3. SOURCE — la visite/réunion/document d'origine ;
//   4. CITATION — UNIQUEMENT la ou les phrases (≤ 2) qui ont justifié
//      l'extraction, jamais tout le mémo ;
//   5. LIEN vers la source.
//
// AUCUNE génération : chaque maillon est une ligne de base identifiable. La
// citation est RETROUVÉE dans le mémo par correspondance déterministe (aucun
// appel IA) — on ne cite jamais une paraphrase.

import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgIdsOfUser } from '@/lib/auth/memberships'
import { CANCEL_REASON_LABEL, type DeadlineCancelReason } from '@/lib/db/site-deadlines'

export type ProvenanceObjectType = 'action' | 'deadline' | 'decision'

/** Cycle de vie d'une proposition (mig 212 + 231). */
export type ProposalStatus = 'proposed' | 'confirmed' | 'fulfilled' | 'dismissed' | 'superseded'

export interface ProvenanceCitation {
  /** « Mémo vocal » · « Note de visite ». */
  source: string
  /** La phrase RETROUVÉE dans le mémo — courte, mot pour mot. */
  text: string
}

/** Fin de vie d'une échéance déjà validée (réalisée / annulée / remplacée) — le
 *  bloc « Pourquoi ? » d'une échéance annulée doit dire qui/quand/pourquoi. */
export interface ProvenanceLifecycle {
  status: 'done' | 'cancelled' | 'superseded'
  /** Le jour du changement (ISO) — cancelled_at ou completed_at. */
  at: string | null
  byName: string | null
  reasonLabel: string | null
  comment: string | null
  /** L'échéance de remplacement (statut superseded). */
  replacement: { href: string; label: string } | null
}

export interface ProvenanceChain {
  /** Statut de la proposition IA. null = objet saisi à la main (aucune proposition). */
  status: ProposalStatus | null
  /** Fin de vie d'une échéance validée (null hors échéance, ou échéance encore active). */
  lifecycle: ProvenanceLifecycle | null
  /** Jour où MemorIA a détecté/proposé (ISO) — proposition `created_at`. null si saisie manuelle. */
  detectedAt: string | null
  /** Le chantier — contexte discret. */
  siteName: string
  /** La source d'origine — « Visite du 12 mai 2026 ». */
  sourceLabel: string | null
  /** Citations CIBLÉES (≤ 2) : les phrases qui ont justifié l'extraction. */
  citations: ProvenanceCitation[]
  /** Lien vers la visite/document d'origine. */
  origin: { href: string; label: string } | null
  /** L'objet lui-même (l'échéance/action/décision) + sa nature. */
  objectLabel: string
  objectKind: string
}

const TABLES: Record<ProvenanceObjectType, { table: string; titleCol: string }> = {
  action: { table: 'site_actions', titleCol: 'title' },
  deadline: { table: 'site_deadlines', titleCol: 'title' },
  decision: { table: 'site_decisions', titleCol: 'titre' },
}

const OBJET_LABEL: Record<ProvenanceObjectType, string> = {
  action: 'Action',
  deadline: 'Échéance',
  decision: 'Décision',
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric',
})

// ── Citation ciblée (déterministe) ───────────────────────────────────────────
// On ne montre plus tout le mémo : on RETROUVE la/les phrase(s) la/les plus
// proche(s) de ce que MemorIA a extrait (le titre de l'objet + la contrainte).

const STOP = new Set([
  'dans', 'pour', 'avec', 'les', 'des', 'une', 'que', 'qui', 'est', 'sera', 'seront',
  'vont', 'plus', 'sont', 'aux', 'par', 'pas', 'leur', 'leurs', 'cette', 'ces', 'ils',
  'elle', 'nous', 'vous', 'sur', 'son', 'ses', 'the', 'and', 'être', 'avoir', 'fait',
])

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Jetons signifiants (≥ 4 lettres, hors mots vides). */
function tokens(s: string): string[] {
  return normalize(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 4 && !STOP.has(w))
}

/** Découpe en phrases (ponctuation forte ou saut de ligne). */
function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '\n')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Raccourcit une citation trop longue à la frontière d'un mot. */
function trimCitation(s: string, maxLen = 180): string {
  if (s.length <= maxLen) return s
  const cut = s.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–-]+$/, '') + '…'
}

/**
 * Retrouve dans les mémos les phrases les plus proches de ce qui a été extrait.
 * Au plus `max` citations, dans l'ordre de lecture. Si aucune phrase ne partage
 * de mot signifiant, on retombe sur la 1ʳᵉ phrase du 1ᵉ mémo (courte) plutôt que
 * sur tout le mémo — jamais l'intégralité de la note.
 */
function pickCitations(
  captures: Array<{ kind: string; body: string }>,
  needle: string,
  max = 2,
): ProvenanceCitation[] {
  const key = new Set(tokens(needle))
  const label = (kind: string) => (kind === 'vocal' ? 'Mémo vocal' : 'Note de visite')
  type Cand = { kind: string; text: string; order: number; overlap: number }
  const cands: Cand[] = []
  let order = 0
  for (const c of captures) {
    for (const sentence of splitSentences(c.body)) {
      const t = tokens(sentence)
      const overlap = t.reduce((n, w) => n + (key.has(w) ? 1 : 0), 0)
      cands.push({ kind: c.kind, text: sentence, order: order++, overlap })
    }
  }
  if (cands.length === 0) return []
  const scored = cands.filter((c) => c.overlap > 0).sort((a, b) => b.overlap - a.overlap || a.order - b.order)
  const chosen = (scored.length > 0 ? scored : cands.slice(0, 1)).slice(0, max)
  return chosen
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ source: label(c.kind), text: trimCitation(c.text) }))
}

/** Fin de vie d'une échéance (réalisée/annulée/remplacée). null si encore active. */
async function getDeadlineLifecycle(
  db: ReturnType<typeof createAdminClient>, deadlineId: string, siteId: string,
): Promise<ProvenanceLifecycle | null> {
  const { data } = await db
    .from('site_deadlines')
    .select('status, completed_at, completed_by, cancelled_at, cancelled_by, cancel_reason, cancel_comment, superseded_by')
    .eq('id', deadlineId)
    .maybeSingle()
  const d = data as {
    status: string; completed_at: string | null; completed_by: string | null
    cancelled_at: string | null; cancelled_by: string | null
    cancel_reason: DeadlineCancelReason | null; cancel_comment: string | null; superseded_by: string | null
  } | null
  if (!d || (d.status !== 'done' && d.status !== 'cancelled' && d.status !== 'superseded')) return null

  const actorId = d.cancelled_by ?? d.completed_by
  let byName: string | null = null
  if (actorId) {
    const { data: u } = await db.from('users').select('full_name').eq('id', actorId).maybeSingle()
    byName = (u as { full_name: string | null } | null)?.full_name?.trim() || null
  }

  let replacement: ProvenanceLifecycle['replacement'] = null
  if (d.superseded_by) {
    const { data: r } = await db.from('site_deadlines').select('title').eq('id', d.superseded_by).maybeSingle()
    const title = (r as { title: string | null } | null)?.title?.trim()
    if (title) replacement = { href: `/sites/${siteId}/planning`, label: title }
  }

  return {
    status: d.status as ProvenanceLifecycle['status'],
    at: d.cancelled_at ?? d.completed_at,
    byName,
    reasonLabel: d.cancel_reason ? CANCEL_REASON_LABEL[d.cancel_reason] : null,
    comment: d.cancel_comment?.trim() || null,
    replacement,
  }
}

/**
 * La provenance d'un objet. `null` si l'objet n'existe pas, n'a pas de source
 * traçable, ou n'appartient pas à l'organisation de l'appelant (fail-closed :
 * le service-role bypasse la RLS, la garde vit ici).
 */
export async function getProvenance(
  type: ProvenanceObjectType,
  id: string,
): Promise<ProvenanceChain | null> {
  const orgIds = await getOrgIdsOfUser()
  if (orgIds.length === 0) return null

  const db = createAdminClient()
  const { table, titleCol } = TABLES[type]

  const { data: obj } = await db
    .from(table)
    .select(`id, ${titleCol}, site_id, report_id`)
    .eq('id', id)
    .maybeSingle()
  if (!obj) return null
  const row = obj as unknown as Record<string, string | null>
  const siteId = row.site_id
  const reportId = row.report_id
  if (!siteId) return null

  // Garde tenant : l'objet doit appartenir à un chantier de MON organisation.
  const { data: site } = await db
    .from('sites')
    .select('id, name, organization_id')
    .eq('id', siteId)
    .maybeSingle()
  if (!site || !orgIds.includes((site as { organization_id: string | null }).organization_id ?? '')) return null

  // La proposition qui a porté l'objet (mig 212) : elle connaît le STATUT, la
  // date de détection et les captures d'origine. Son absence n'est pas une
  // erreur — un objet saisi à la main n'a simplement pas de voix derrière lui.
  const { data: prop } = await db
    .from('site_knowledge_proposals')
    .select('id, source_capture_ids, report_id, status, created_at, title, body')
    .eq('promoted_object_id', id)
    .maybeSingle()
  const p = prop as {
    source_capture_ids?: string[]; report_id?: string | null; status?: ProposalStatus
    created_at?: string | null; title?: string | null; body?: string | null
  } | null

  const captureIds: string[] = p?.source_capture_ids ?? []
  const effectiveReportId = reportId ?? p?.report_id ?? null
  // Sans source traçable, pas de bloc : on ne rend pas un « Pourquoi ? » qui ment.
  if (!effectiveReportId) return null

  const status = p?.status ?? null
  const detectedAt = p?.created_at ?? null

  let sourceLabel: string | null = null
  const { data: report } = await db
    .from('site_reports')
    .select('id, started_at')
    .eq('id', effectiveReportId)
    .maybeSingle()
  if (report) {
    const started = (report as { started_at: string | null }).started_at
    sourceLabel = started ? `Visite du ${dateFmt.format(new Date(started))}` : 'Visite'
  }

  // Les mémos d'origine : d'abord ceux que la proposition désigne ; à défaut,
  // les captures textuelles de la visite (le fait en vient forcément).
  let capQuery = db
    .from('visit_capture')
    .select('id, kind, body')
    .is('hidden_at', null)
    .not('body', 'is', null)
  capQuery = captureIds.length > 0
    ? capQuery.in('id', captureIds)
    : capQuery.eq('report_id', effectiveReportId).in('kind', ['vocal', 'note'])
  const { data: caps } = await capQuery.limit(3)
  const captures = ((caps ?? []) as Array<{ id: string; kind: string; body: string | null }>)
    .filter((c): c is { id: string; kind: string; body: string } => !!c.body)

  // La cible de la citation = ce que MemorIA a extrait (titre de l'objet + titre/
  // corps de la proposition), pour retrouver la phrase d'origine la plus proche.
  const objectLabel = (row[titleCol] as string) ?? OBJET_LABEL[type]
  const needle = [objectLabel, p?.title ?? '', p?.body ?? ''].join(' ')
  const citations = pickCitations(captures.map((c) => ({ kind: c.kind, body: c.body })), needle)

  // Fin de vie : réservée aux échéances (seul objet doté du menu réaliser/annuler).
  const lifecycle = type === 'deadline' ? await getDeadlineLifecycle(db, id, siteId) : null

  return {
    status,
    lifecycle,
    detectedAt,
    siteName: (site as { name: string }).name,
    sourceLabel,
    citations,
    origin: { href: `/sites/${siteId}/visites/${effectiveReportId}`, label: 'Ouvrir la visite' },
    objectLabel,
    objectKind: OBJET_LABEL[type],
  }
}
