// INTELLIGENCE PROACTIVE — deriveSiteAttentionItems(siteId)
//
// Doctrine : 100 % déterministe, zéro LLM. Agrège les signaux des sources
// existantes sans les réinventer. Hiérarchie de règles explicite — pas de
// score opaque. Déduplique par canonical subject : un même sujet ne produit
// qu'un seul item, le plus urgent, même s'il cumule stagnation + action en
// retard + réserve ouverte.
//
// V1.1 — PV signals (pv_status, pv_stagnant) + deadline_overdue ajoutés.
// Ordre : critical → high → medium → low.

import { createAdminClient } from '@/lib/supabase/admin'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import { listConfirmedLinksForSite, listSuggestedLinksBySite } from '@/lib/db/subject-thread-links'
import { listBlocagesBySite } from '@/lib/db/site-blocages'
import { detectActorCongestion } from '@/lib/db/site-memory-signals'
import { listPendingSuggestionsForSite } from '@/lib/db/subject-suggestions'
import { getSiteSubjectMatrix } from '@/lib/documents/pv-history'
import { computeWatchlist, type WatchReason } from '@/lib/documents/pv-watchlist'
import { describeOverdueAction } from '@/lib/knowledge/overdue-action'
import { OPERATIONAL_DEADLINE_SOURCE_FILTER } from '@/lib/db/deadline-projection'

export type AttentionSignal =
  | 'subject_stagnant'
  | 'action_overdue'
  | 'action_to_verify'
  | 'deadline_near'
  | 'deadline_overdue'
  | 'reserve_open'
  | 'relation_blocking'
  | 'blocage_active'
  | 'actor_congestion'
  | 'subject_changed'
  | 'proposal_pending'
  | 'link_suggested'
  | 'pv_status'
  | 'pv_stagnant'

export type AttentionUrgency = 'critical' | 'high' | 'medium' | 'low'

export interface SiteAttentionItem {
  signal: AttentionSignal
  title: string
  reason: string
  urgency: AttentionUrgency
  href: string
  metadata?: Record<string, unknown>
}

// ─── Urgence ─────────────────────────────────────────────────────────────────

const URGENCY_RANK: Record<AttentionUrgency, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

// ─── Dates ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((new Date(isoB).getTime() - new Date(isoA).getTime()) / 86400000)
}

// ─── Labels PV ───────────────────────────────────────────────────────────────

function pvStatusReason(reason: WatchReason, activeObjects?: { actionsOpen: number; reservesOpen: number }): string {
  const base =
    reason === 'non_conforme' ? 'Non-conformité signalée dans le dernier PV' :
    reason === 'aggravé'      ? 'Aggravé au dernier PV' :
                                'Réouvert au dernier PV'
  const parts: string[] = [base]
  if (activeObjects) {
    if (activeObjects.actionsOpen > 0)
      parts.push(`${activeObjects.actionsOpen} action${activeObjects.actionsOpen > 1 ? 's' : ''} ouverte${activeObjects.actionsOpen > 1 ? 's' : ''}`)
    if (activeObjects.reservesOpen > 0)
      parts.push(`${activeObjects.reservesOpen} réserve${activeObjects.reservesOpen > 1 ? 's' : ''} ouverte${activeObjects.reservesOpen > 1 ? 's' : ''}`)
  }
  return parts.join(' · ')
}

// ─── Moteur ──────────────────────────────────────────────────────────────────

export async function deriveSiteAttentionItems(
  siteId: string,
  today = todayIso(),
): Promise<SiteAttentionItem[]> {
  const admin = createAdminClient()
  const in7days = addDays(today, 7)
  const subjectHref = (csId: string) => `/sites/${siteId}/historique/sujets/${csId}`

  const [
    subjects,
    overdueResult,
    deadlineResult,
    reserveResult,
    confirmedLinks,
    suggestedLinks,
    blocages,
    congestionSignal,
    pendingSuggestions,
    threadMappingsResult,
    lastVisitResult,
    matrix,
    overdueDeadlinesResult,
  ] = await Promise.all([
    getNavigableSubjectsForSite(siteId),
    admin
      .from('site_actions')
      .select('id, title, due_date, due_date_status, subject_thread_id, assigned_to')
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
      .lte('due_date', in7days),
    admin
      .from('site_reserve')
      .select('id, label, issued_on')
      .eq('site_id', siteId)
      .eq('status', 'open')
      .order('issued_on', { ascending: true, nullsFirst: false }),
    listConfirmedLinksForSite(siteId),
    listSuggestedLinksBySite(siteId),
    listBlocagesBySite(siteId),
    detectActorCongestion(siteId),
    listPendingSuggestionsForSite(siteId),
    admin
      .from('subject_thread_identity')
      .select('subject_thread_id, canonical_subject_id')
      .eq('site_id', siteId),
    admin
      .from('site_reports')
      .select('ended_at')
      .eq('site_id', siteId)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(1),
    getSiteSubjectMatrix(siteId).catch(() => null),
    admin
      .from('site_deadlines')
      .select('id, title, due_date')
      .eq('site_id', siteId)
      .or(OPERATIONAL_DEADLINE_SOURCE_FILTER)
      .in('status', ['to_plan', 'planned'])
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .order('due_date', { ascending: true }),
  ])

  const lastVisitAt: string | null =
    (lastVisitResult.data?.[0]?.ended_at as string | null) ?? null

  // thread_id → canonical_subject_id
  const threadToCs = new Map<string, string>(
    ((threadMappingsResult.data ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>)
      .map(t => [t.subject_thread_id, t.canonical_subject_id]),
  )

  // canonical_subject_id → NavigableSubjectSummary (pour lookups rapides)
  const csIndex = new Map(subjects.map(s => [s.canonicalSubjectId, s]))

  // canonical_subject_id → première relation bloquante (requires/enables confirmée)
  const stagnantCsIds = new Set(subjects.filter(s => s.isStagnant).map(s => s.canonicalSubjectId))
  const blockingByCsId = new Map<string, { blockedLabel: string; linkType: string }>()

  for (const link of confirmedLinks) {
    if (link.linkType !== 'requires' && link.linkType !== 'enables') continue
    const fromCs = link.fromCanonicalSubjectId
    const toCs = link.toCanonicalSubjectId
    if (!fromCs || !toCs) continue

    if (link.linkType === 'requires' && stagnantCsIds.has(toCs) && !blockingByCsId.has(toCs)) {
      blockingByCsId.set(toCs, { blockedLabel: link.fromLabel ?? '?', linkType: 'requires' })
    }
    if (link.linkType === 'enables' && stagnantCsIds.has(fromCs) && !blockingByCsId.has(fromCs)) {
      blockingByCsId.set(fromCs, { blockedLabel: link.toLabel ?? '?', linkType: 'enables' })
    }
  }

  const coveredCsIds = new Set<string>()
  const items: SiteAttentionItem[] = []

  // ── 1. Blocages actifs (critique par nature) ──────────────────────────────
  for (const b of blocages) {
    if (b.dateEnd !== null) continue
    items.push({
      signal: 'blocage_active',
      title: b.title,
      reason: `Blocage déclaré depuis le ${b.dateStart}`,
      urgency: 'critical',
      href: `/sites/${siteId}/apercu`,
      metadata: { blocageId: b.id, type: b.type },
    })
  }

  // ── 2. Signaux PV (pv_status + pv_stagnant) ────────────────────────────────
  // pv_status (non_conforme/aggravé/réouvert) + objets actifs → critical
  // pv_status seul → high
  // pv_stagnant (sans_évolution) → medium
  const pvWatchlist = matrix ? computeWatchlist(matrix) : []

  for (const w of pvWatchlist) {
    const csId = threadToCs.get(w.subjectThreadId)
    if (!csId) continue
    if (coveredCsIds.has(csId)) continue

    const s = csIndex.get(csId)
    const activeObjects = s?.activeObjects

    const isStatusSignal = w.reason !== 'sans_évolution'

    let urgency: AttentionUrgency
    if (isStatusSignal && activeObjects && activeObjects.total > 0) {
      urgency = 'critical'
    } else if (isStatusSignal) {
      urgency = 'high'
    } else {
      urgency = 'medium' // sans_évolution
    }

    items.push({
      signal: isStatusSignal ? 'pv_status' : 'pv_stagnant',
      title: w.label,
      reason: isStatusSignal
        ? pvStatusReason(w.reason, activeObjects)
        : `Sans évolution depuis ${w.pvCount} PV`,
      urgency,
      href: csId ? subjectHref(csId) : `/sites/${siteId}/historique?view=lifelines`,
      metadata: { canonicalSubjectId: csId, pvReason: w.reason, pvCount: w.pvCount },
    })
    coveredCsIds.add(csId)
  }

  // ── 3. Sujets stagnants (jours) ───────────────────────────────────────────
  for (const s of subjects) {
    if (!s.isStagnant) continue
    if (coveredCsIds.has(s.canonicalSubjectId)) continue

    const blocking = blockingByCsId.get(s.canonicalSubjectId)

    const urgency: AttentionUrgency =
      s.stagnationDays >= 60 && blocking ? 'critical' :
      s.stagnationDays >= 60 ? 'high' :
      s.activeObjects.total > 0 ? 'high' :
      'medium'

    const reasonParts: string[] = [`Stagnant depuis ${s.stagnationDays} j`]
    if (s.activeObjects.actionsOpen > 0)
      reasonParts.push(`${s.activeObjects.actionsOpen} action${s.activeObjects.actionsOpen > 1 ? 's' : ''} ouverte${s.activeObjects.actionsOpen > 1 ? 's' : ''}`)
    if (s.activeObjects.reservesOpen > 0)
      reasonParts.push(`${s.activeObjects.reservesOpen} réserve${s.activeObjects.reservesOpen > 1 ? 's' : ''} ouverte${s.activeObjects.reservesOpen > 1 ? 's' : ''}`)
    if (blocking)
      reasonParts.push(`bloque « ${blocking.blockedLabel} »`)

    items.push({
      signal: blocking ? 'relation_blocking' : 'subject_stagnant',
      title: s.title,
      reason: reasonParts.join(' · '),
      urgency,
      href: subjectHref(s.canonicalSubjectId),
      metadata: { canonicalSubjectId: s.canonicalSubjectId, stagnationDays: s.stagnationDays },
    })
    coveredCsIds.add(s.canonicalSubjectId)
  }

  // ── 4. Actions en retard ──────────────────────────────────────────────────
  // due_date_status distingue une date CONFIRMÉE par un humain (explicit) d'une
  // date DÉDUITE par l'IA (estimated) — même règle que assigned-actions.ts et
  // action-fiche.ts. L'absence de confirmation n'est pas une preuve de retard
  // (retour Guillaume 2026-08-14, LOT4) : une date estimée non dépassée-prouvée
  // reste « à vérifier », jamais « en retard ».
  const overdueActions = (overdueResult.data ?? []) as Array<{
    id: string; title: string; due_date: string; due_date_status: 'explicit' | 'estimated' | null
    subject_thread_id: string | null; assigned_to: string | null
  }>

  for (const action of overdueActions) {
    const csId = action.subject_thread_id ? threadToCs.get(action.subject_thread_id) : undefined
    if (csId && coveredCsIds.has(csId)) continue

    const overdue = describeOverdueAction(action.title, action.due_date, action.due_date_status, today)
    const signal = overdue.confirmed ? 'action_overdue' : 'action_to_verify'
    // 'medium', pas 'low' : rankBriefingAttention (visit-briefing.ts) écarte tout
    // ce qui est 'low' avant la visite. Un item « à vérifier » doit justement
    // apparaître dans la préparation de visite (LOT5) — sinon la question posée
    // au terrain (Q9) reste invisible plutôt que « à vérifier ».
    const urgency: AttentionUrgency = overdue.confirmed
      ? (overdue.overdueDays > 14 ? 'high' : overdue.overdueDays > 7 ? 'high' : 'medium')
      : 'medium'
    const title = csId ? (csIndex.get(csId)?.title ?? action.title) : action.title
    const reason = overdue.reason

    if (csId) {
      items.push({
        signal,
        title,
        reason,
        urgency,
        href: subjectHref(csId),
        metadata: { actionId: action.id, canonicalSubjectId: csId },
      })
      coveredCsIds.add(csId)
    } else {
      items.push({
        signal,
        title,
        reason,
        urgency,
        href: `/sites/${siteId}/actions`,
        metadata: { actionId: action.id },
      })
    }
  }

  // ── 5. Échéances proches (site_actions kind=deadline) ────────────────────
  const nearDeadlines = (deadlineResult.data ?? []) as Array<{
    id: string; title: string; due_date: string; subject_thread_id: string | null
  }>

  for (const dl of nearDeadlines) {
    const csId = dl.subject_thread_id ? threadToCs.get(dl.subject_thread_id) : undefined
    if (csId && coveredCsIds.has(csId)) continue

    const daysLeft = daysBetween(today, dl.due_date)
    const urgency: AttentionUrgency = daysLeft <= 2 ? 'high' : 'medium'

    if (csId) {
      const s = csIndex.get(csId)
      items.push({
        signal: 'deadline_near',
        title: s?.title ?? dl.title,
        reason: `Échéance « ${dl.title} » dans ${daysLeft} j`,
        urgency,
        href: subjectHref(csId),
        metadata: { actionId: dl.id, canonicalSubjectId: csId },
      })
      coveredCsIds.add(csId)
    } else {
      items.push({
        signal: 'deadline_near',
        title: dl.title,
        reason: daysLeft === 0 ? `Échéance aujourd'hui` : `Échéance dans ${daysLeft} j`,
        urgency,
        href: `/sites/${siteId}/actions`,
        metadata: { actionId: dl.id },
      })
    }
  }

  // ── 6. Réserves ouvertes ──────────────────────────────────────────────────
  const openReserves = (reserveResult.data ?? []) as Array<{
    id: string; label: string; issued_on: string | null
  }>

  for (const r of openReserves) {
    const openDays = r.issued_on ? daysBetween(r.issued_on, today) : null
    const urgency: AttentionUrgency = openDays != null && openDays > 45 ? 'high' :
      openDays != null && openDays > 15 ? 'high' : 'medium'
    const reason = openDays != null
      ? `Ouverte depuis ${openDays} j`
      : 'Réserve non levée'

    items.push({
      signal: 'reserve_open',
      title: r.label,
      reason,
      urgency,
      href: `/sites/${siteId}/reserves`,
      metadata: { reserveId: r.id, openDays },
    })
  }

  // ── 7. Échéances en retard (site_deadlines) ───────────────────────────────
  const overdueDls = (overdueDeadlinesResult.data ?? []) as Array<{
    id: string; title: string; due_date: string
  }>
  if (overdueDls.length > 0) {
    const oldest = overdueDls[0]
    const days = daysBetween(oldest.due_date, today)
    const urgency: AttentionUrgency = days > 30 ? 'high' : 'medium'
    items.push({
      signal: 'deadline_overdue',
      title: overdueDls.length === 1
        ? oldest.title
        : `${overdueDls.length} échéances en retard`,
      reason: overdueDls.length === 1
        ? `Échéance en retard de ${days} j`
        : `La plus ancienne : en retard de ${days} j`,
      urgency,
      href: `/sites/${siteId}/historique`,
      metadata: { count: overdueDls.length },
    })
  }

  // ── 8. Congestion acteur ──────────────────────────────────────────────────
  if (congestionSignal) {
    const first = congestionSignal.items[0]
    if (first) {
      items.push({
        signal: 'actor_congestion',
        title: first.label,
        reason: congestionSignal.title,
        urgency: 'medium',
        href: `/sites/${siteId}/actions`,
        metadata: { source: congestionSignal.source },
      })
    }
  }

  // ── 9. Sujets ayant changé depuis la dernière visite ─────────────────────
  if (lastVisitAt) {
    for (const s of subjects) {
      if (!s.lastMeaningfulChangeAt) continue
      if (s.lastMeaningfulChangeAt <= lastVisitAt) continue
      if (coveredCsIds.has(s.canonicalSubjectId)) continue

      items.push({
        signal: 'subject_changed',
        title: s.title,
        reason: `Évolution depuis votre dernière visite`,
        urgency: 'low',
        href: subjectHref(s.canonicalSubjectId),
        metadata: { canonicalSubjectId: s.canonicalSubjectId, changedAt: s.lastMeaningfulChangeAt },
      })
    }
  }

  // ── 10. Propositions de rapprochement en attente ───────────────────────────
  if (pendingSuggestions.length > 0) {
    const best = pendingSuggestions[0]
    const conf = best.model_confidence != null ? ` (${Math.round(best.model_confidence * 100)}% confiance)` : ''
    items.push({
      signal: 'proposal_pending',
      title: pendingSuggestions.length === 1
        ? `Rapprochement à valider`
        : `${pendingSuggestions.length} rapprochements à valider`,
      reason: `« ${best.proposal_label} » → « ${best.candidate_label ?? '?' } »${conf}`,
      urgency: 'low',
      href: `/sites/${siteId}/sujets`,
      metadata: { count: pendingSuggestions.length },
    })
  }

  // ── 11. Relations suggérées en attente ────────────────────────────────────
  const pendingLinks = suggestedLinks.filter(l => l.status === 'suggested')
  if (pendingLinks.length > 0) {
    const first = pendingLinks[0]
    items.push({
      signal: 'link_suggested',
      title: pendingLinks.length === 1
        ? `Relation à valider`
        : `${pendingLinks.length} relations à valider`,
      reason: first.fromLabel && first.toLabel
        ? `« ${first.fromLabel} » → « ${first.toLabel} »`
        : `${pendingLinks.length} relation${pendingLinks.length > 1 ? 's' : ''} suggérée${pendingLinks.length > 1 ? 's' : ''} par MemorIA`,
      urgency: 'low',
      href: `/sites/${siteId}/historique/sujets`,
      metadata: { count: pendingLinks.length },
    })
  }

  // ── Enrichissement du contexte sujet ─────────────────────────────────────
  // Le moteur d'attention répond « qu'est-ce qui mérite mon attention ? ». Le
  // plan de visite doit répondre « qu'est-ce qu'il est utile de constater sur
  // place ? » — ce qui exige le dernier état connu et le changement depuis la
  // dernière visite, pas seulement un titre et une urgence (recette PETRO :
  // cinq items portant tous la même raison « Évolution depuis votre dernière
  // visite »). Ces champs sont déjà chargés par `getNavigableSubjectsForSite` :
  // l'enrichissement ne coûte aucune requête supplémentaire.
  //
  // Additif et centralisé : chaque règle continue d'écrire sa propre métadonnée,
  // on ne fait que compléter celles qui portent un canonical_subject_id.
  for (const item of items) {
    const csId = item.metadata?.canonicalSubjectId
    if (typeof csId !== 'string') continue
    const s = csIndex.get(csId)
    if (!s) continue
    // La métadonnée de la règle prime : elle porte le sens local du signal
    // (`pvCount` de la watchlist, `stagnationDays` du sujet stagnant — ce dernier
    // sert de départage au tri ci-dessous et ne doit surtout pas apparaître sur
    // des items qui n'en avaient pas, sous peine de réordonner l'Aperçu).
    item.metadata = {
      currentStatus: s.currentStatus,
      kind: s.dominantFamily, // #228 : métadonnée descriptive = famille (dominantFamily), pas la nature durable
      durableKind: s.durableKind,
      activeObjects: s.activeObjects,
      consecutiveMentionsWithoutChange: s.consecutiveMentionsWithoutChange,
      lastMeaningfulChangeAt: s.lastMeaningfulChangeAt,
      lastSeenAt: s.lastSeenAt,
      changedSinceLastVisit: Boolean(
        lastVisitAt && s.lastMeaningfulChangeAt && s.lastMeaningfulChangeAt > lastVisitAt,
      ),
      lastVisitAt,
      ...item.metadata,
    }
  }

  // ── Tri déterministe ─────────────────────────────────────────────────────
  // critical → high → medium → low
  // À même urgence : stagnationDays DESC pour sujets stagnants
  items.sort((a, b) => {
    const u = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    if (u !== 0) return u
    const aDays = (a.metadata?.stagnationDays as number | undefined) ?? 0
    const bDays = (b.metadata?.stagnationDays as number | undefined) ?? 0
    return bDays - aDays
  })

  return items
}
