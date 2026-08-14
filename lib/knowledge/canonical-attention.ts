// P0-C — Moteur d'attention canonical chantier
//
// Fusionne les signaux par canonical_subject (un item = un sujet, pas un signal).
// 100% déterministe, zéro LLM. Hiérarchie de règles explicite.
// Sortie : top-N sujets les plus urgents avec raisons explicables.
//
// Différence clé vs deriveSiteAttentionItems : ici chaque item = un sujet,
// pas un signal. Tous les signaux d'un sujet sont fusionnés en une carte unique.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { getNavigableSubjectsForSite, type NavigableSubjectSummary } from '@/lib/db/canonical-subject-life'
import { listConfirmedLinksForSite } from '@/lib/db/subject-thread-links'
import { getSiteSubjectMatrix } from '@/lib/documents/pv-history'
import { computeWatchlist } from '@/lib/documents/pv-watchlist'
import { describeOverdueAction } from '@/lib/knowledge/overdue-action'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CanonicalSignal =
  | 'stagnant_blocking'
  | 'pv_non_conforme'
  | 'pv_aggrave'
  | 'pv_reopened'
  | 'action_overdue'
  | 'action_to_verify'
  | 'stagnant'
  | 'open_with_objects'
  | 'pv_no_evolution'
  | 'deadline_near'

const SIGNAL_BASE_SCORE: Record<CanonicalSignal, number> = {
  stagnant_blocking: 100,
  pv_non_conforme:    90,
  pv_aggrave:         85,
  action_overdue:     80,
  pv_reopened:        75,
  stagnant:           60,
  open_with_objects:  40,
  pv_no_evolution:    35,
  deadline_near:      25,
  // Date IA non confirmée par un humain : jamais « en retard », un simple rappel
  // à vérifier (retour Guillaume 2026-08-14, LOT4).
  action_to_verify:   20,
}

export interface CanonicalAttentionItem {
  canonicalSubjectId: string
  title: string
  urgency: 'critical' | 'high' | 'medium' | 'low'
  score: number
  signals: CanonicalSignal[]
  /** 1-4 lignes de raison, affichables directement dans l'UI. */
  reasons: string[]
  href: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86_400_000)
}

function scoreToUrgency(score: number): 'critical' | 'high' | 'medium' | 'low' {
  if (score >= 85) return 'critical'
  if (score >= 65) return 'high'
  if (score >= 35) return 'medium'
  return 'low'
}

const OPEN_STATUS = new Set([
  'open', 'in_progress', 'still_open', 'non_compliant',
  'planned', 'awaiting_validation', 'field_checked',
])

// ── Moteur ────────────────────────────────────────────────────────────────────

export async function deriveCanonicalAttentionItems(
  siteId: string,
  opts: { limit?: number; today?: string } = {},
): Promise<CanonicalAttentionItem[]> {
  const limit = opts.limit ?? 5
  const today = opts.today ?? todayIso()
  const admin = createAdminClient()
  const subjectHref = (csId: string) => `/sites/${siteId}/historique/sujets/${csId}`

  // ── 1. Sources en parallèle ───────────────────────────────────────────────

  const [
    subjects,
    confirmedLinks,
    matrix,
    threadMappingsResult,
    overdueActionsResult,
    nearDeadlinesResult,
  ] = await Promise.all([
    getNavigableSubjectsForSite(siteId),
    listConfirmedLinksForSite(siteId),
    getSiteSubjectMatrix(siteId).catch(() => null),
    admin
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .eq('site_id', siteId),
    admin
      .from('site_actions')
      .select('id, title, due_date, due_date_status, subject_thread_id')
      .eq('site_id', siteId)
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .order('due_date', { ascending: true }),
    admin
      .from('site_actions')
      .select('id, title, due_date, subject_thread_id')
      .eq('site_id', siteId)
      .eq('status', 'open')
      .eq('kind', 'deadline')
      .not('due_date', 'is', null)
      .gte('due_date', today)
      .lte('due_date', addDays(today, 7)),
  ])

  // ── 2. Index ───────────────────────────────────────────────────────────────

  const threadToCs = new Map<string, string>(
    ((threadMappingsResult.data ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
      .map(t => [t.subject_thread_id, t.canonical_subject_id]),
  )

  const csIndex = new Map<string, NavigableSubjectSummary>(
    subjects.map(s => [s.canonicalSubjectId, s]),
  )

  const stagnantCsIds = new Set(
    subjects.filter(s => s.isStagnant).map(s => s.canonicalSubjectId),
  )

  // ── 3. Relations bloquantes ────────────────────────────────────────────────
  // Cas 1 : A requires B et B est stagnant → B bloque A
  // Cas 2 : A enables B et A est stagnant → A bloque B

  const blockingByCsId = new Map<string, string>() // csId stagnant → label du sujet bloqué

  for (const link of confirmedLinks) {
    if (link.linkType !== 'requires' && link.linkType !== 'enables') continue
    const fromCs = link.fromCanonicalSubjectId
    const toCs = link.toCanonicalSubjectId
    if (!fromCs || !toCs) continue

    if (link.linkType === 'requires' && stagnantCsIds.has(toCs) && !blockingByCsId.has(toCs)) {
      blockingByCsId.set(toCs, link.fromLabel ?? '?')
    }
    if (link.linkType === 'enables' && stagnantCsIds.has(fromCs) && !blockingByCsId.has(fromCs)) {
      blockingByCsId.set(fromCs, link.toLabel ?? '?')
    }
  }

  // Nombre de relations confirmées par CS (pour "Lié à N sujets actifs")
  const linkCountByCsId = new Map<string, number>()
  for (const link of confirmedLinks) {
    if (link.fromCanonicalSubjectId) {
      linkCountByCsId.set(link.fromCanonicalSubjectId, (linkCountByCsId.get(link.fromCanonicalSubjectId) ?? 0) + 1)
    }
    if (link.toCanonicalSubjectId) {
      linkCountByCsId.set(link.toCanonicalSubjectId, (linkCountByCsId.get(link.toCanonicalSubjectId) ?? 0) + 1)
    }
  }

  // ── 4. Watchlist PV (résolution thread → canonical) ───────────────────────

  const pvWatchlist = matrix ? computeWatchlist(matrix) : []
  // Premier signal PV par canonical (priorité : non_conforme > aggravé > réouvert > sans_évolution)
  const pvByCsId = new Map<string, { reason: string; pvCount: number }>()
  const PV_PRIORITY: Record<string, number> = {
    non_conforme: 0, aggravé: 1, réouvert: 2, sans_évolution: 3,
  }
  for (const w of pvWatchlist) {
    const csId = threadToCs.get(w.subjectThreadId)
    if (!csId) continue
    const existing = pvByCsId.get(csId)
    if (!existing || PV_PRIORITY[w.reason] < PV_PRIORITY[existing.reason]) {
      pvByCsId.set(csId, { reason: w.reason, pvCount: w.pvCount })
    }
  }

  // ── 5. Actions en retard par canonical ────────────────────────────────────

  type ActionRow = {
    id: string; title: string; due_date: string
    due_date_status: 'explicit' | 'estimated' | null; subject_thread_id: string | null
  }
  const overdueActions = (overdueActionsResult.data ?? []) as ActionRow[]
  const overdueByCsId = new Map<string, { title: string; overdueDays: number; dueDate: string; confirmed: boolean; reason: string }>()
  for (const a of overdueActions) {
    if (!a.subject_thread_id) continue
    const csId = threadToCs.get(a.subject_thread_id)
    if (!csId || overdueByCsId.has(csId)) continue
    const info = describeOverdueAction(a.title, a.due_date, a.due_date_status, today)
    overdueByCsId.set(csId, { title: a.title, dueDate: a.due_date, ...info })
  }

  // ── 6. Échéances proches par canonical ────────────────────────────────────

  type DeadlineRow = { id: string; title: string; due_date: string; subject_thread_id: string | null }
  const nearDeadlines = (nearDeadlinesResult.data ?? []) as DeadlineRow[]
  const nearDlByCsId = new Map<string, { title: string; daysLeft: number }>()
  for (const dl of nearDeadlines) {
    if (!dl.subject_thread_id) continue
    const csId = threadToCs.get(dl.subject_thread_id)
    if (!csId || nearDlByCsId.has(csId)) continue
    nearDlByCsId.set(csId, { title: dl.title, daysLeft: daysBetween(today, dl.due_date) })
  }

  // ── 7. Scorecard par canonical_subject ────────────────────────────────────

  const items: CanonicalAttentionItem[] = []

  for (const s of subjects) {
    const csId = s.canonicalSubjectId
    const signals: CanonicalSignal[] = []
    let score = 0

    const pv        = pvByCsId.get(csId)
    const overdue   = overdueByCsId.get(csId)
    const nearDl    = nearDlByCsId.get(csId)
    const blocking  = blockingByCsId.get(csId) // label du sujet que ce CS bloque
    const isBlocking = blocking !== undefined && s.isStagnant

    // Signal : stagnant_blocking (max priorité)
    if (isBlocking) {
      signals.push('stagnant_blocking')
      score = Math.max(score, SIGNAL_BASE_SCORE.stagnant_blocking)
    }

    // Signal : PV status (non_conforme / aggravé / réouvert)
    if (pv && pv.reason !== 'sans_évolution') {
      const sig: CanonicalSignal =
        pv.reason === 'non_conforme' ? 'pv_non_conforme' :
        pv.reason === 'aggravé'      ? 'pv_aggrave' :
                                       'pv_reopened'
      signals.push(sig)
      score = Math.max(score, SIGNAL_BASE_SCORE[sig])
    }

    // Signal : action en retard (score ajusté selon l'ancienneté) — seulement si
    // la date est confirmée. Sinon : simple rappel « à vérifier ».
    if (overdue && overdue.confirmed) {
      signals.push('action_overdue')
      const overdueScore = overdue.overdueDays > 14
        ? SIGNAL_BASE_SCORE.action_overdue
        : SIGNAL_BASE_SCORE.action_overdue - 10
      score = Math.max(score, overdueScore)
    } else if (overdue) {
      signals.push('action_to_verify')
      score = Math.max(score, SIGNAL_BASE_SCORE.action_to_verify)
    }

    // Signal : stagnation (sans blocage — déjà compté ci-dessus sinon)
    if (s.isStagnant && !isBlocking) {
      signals.push('stagnant')
      // >= 60 j → high ; < 60 j mais objets actifs → high ; sinon medium
      const stagScore =
        s.stagnationDays >= 60 ? 70 :
        s.activeObjects.total > 0 ? 68 :
        45
      score = Math.max(score, stagScore)
    }

    // Signal : PV sans_évolution (signal PV distinct de la stagnation calculée)
    if (pv?.reason === 'sans_évolution' && !signals.includes('stagnant')) {
      signals.push('pv_no_evolution')
      score = Math.max(score, SIGNAL_BASE_SCORE.pv_no_evolution)
    }

    // Signal : objets actifs (sans autre signal fort)
    if (s.activeObjects.total > 0 && !s.isStagnant && !pv) {
      signals.push('open_with_objects')
      score = Math.max(score, SIGNAL_BASE_SCORE.open_with_objects)
    }

    // Signal : échéance proche (bonus, jamais seul déterminant)
    if (nearDl) {
      signals.push('deadline_near')
      score = Math.max(score, SIGNAL_BASE_SCORE.deadline_near)
    }

    // Aucun signal → skip (sujet sans alerte)
    if (signals.length === 0) continue

    // ── Lignes de raisons ──────────────────────────────────────────────────
    const reasons: string[] = []

    // Ligne 1 : récence + stagnation
    const total = s.pvCount + s.nativeOccurrenceCount
    const mentionPart = total > 0 ? `Mentionné dans ${total} rapport${total > 1 ? 's' : ''}` : null
    const stagnPart = s.isStagnant ? `aucune évolution depuis ${s.stagnationDays} j` : null
    if (mentionPart || stagnPart) {
      reasons.push([mentionPart, stagnPart].filter(Boolean).join(' · '))
    }

    // Ligne 2 : statut lors de la dernière visite
    const isOpen = OPEN_STATUS.has(s.currentStatus ?? '')
    if (pv && pv.reason !== 'sans_évolution') {
      const pvLine =
        pv.reason === 'non_conforme' ? 'Non-conformité signalée dans le dernier PV' :
        pv.reason === 'aggravé'      ? 'Aggravé au dernier PV' :
                                       'Réouvert au dernier PV'
      reasons.push(pvLine)
    } else if (pv?.reason === 'sans_évolution') {
      reasons.push(`Sans évolution sur ${pv.pvCount} PV`)
    } else if (isOpen) {
      reasons.push('Toujours ouvert lors de la dernière visite')
    }

    // Ligne 3 : action en retard, à vérifier, ou objets actifs
    if (overdue) {
      reasons.push(overdue.reason)
    } else if (s.activeObjects.total > 0) {
      const objParts: string[] = []
      if (s.activeObjects.actionsOpen > 0)
        objParts.push(`${s.activeObjects.actionsOpen} action${s.activeObjects.actionsOpen > 1 ? 's' : ''} ouverte${s.activeObjects.actionsOpen > 1 ? 's' : ''}`)
      if (s.activeObjects.reservesOpen > 0)
        objParts.push(`${s.activeObjects.reservesOpen} réserve${s.activeObjects.reservesOpen > 1 ? 's' : ''} ouverte${s.activeObjects.reservesOpen > 1 ? 's' : ''}`)
      if (objParts.length > 0) reasons.push(objParts.join(' · '))
    }

    // Ligne 4 : relation bloquante ou liens actifs
    if (isBlocking) {
      reasons.push(`Bloque « ${blocking} »`)
    } else {
      const linkCount = linkCountByCsId.get(csId) ?? 0
      if (linkCount > 0) {
        reasons.push(`Lié à ${linkCount} sujet${linkCount > 1 ? 's' : ''} actif${linkCount > 1 ? 's' : ''}`)
      }
    }

    items.push({
      canonicalSubjectId: csId,
      title: s.title,
      urgency: scoreToUrgency(score),
      score,
      signals,
      reasons,
      href: subjectHref(csId),
    })
  }

  // ── 8. Tri déterministe et sélection ─────────────────────────────────────
  // score DESC → stagnationDays DESC → title ASC
  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aDays = csIndex.get(a.canonicalSubjectId)?.stagnationDays ?? 0
    const bDays = csIndex.get(b.canonicalSubjectId)?.stagnationDays ?? 0
    if (bDays !== aDays) return bDays - aDays
    return a.title.localeCompare(b.title)
  })

  return items.slice(0, limit)
}
