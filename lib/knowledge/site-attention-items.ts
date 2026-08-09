// INTELLIGENCE PROACTIVE — deriveSiteAttentionItems(siteId)
//
// Doctrine : 100 % déterministe, zéro LLM. Agrège les signaux des sources
// existantes sans les réinventer. Hiérarchie de règles explicite — pas de
// score opaque. Déduplique par canonical subject : un même sujet ne produit
// qu'un seul item, le plus urgent, même s'il cumule stagnation + action en
// retard + réserve ouverte.
//
// Ordre : critical → high → medium → low.
// V1 cible : fiche chantier, bloc "À retenir maintenant" (3 items max).

import { createAdminClient } from '@/lib/supabase/admin'
import { getNavigableSubjectsForSite } from '@/lib/db/canonical-subject-life'
import { listConfirmedLinksForSite, listSuggestedLinksBySite } from '@/lib/db/subject-thread-links'
import { listBlocagesBySite } from '@/lib/db/site-blocages'
import { detectActorCongestion } from '@/lib/db/site-memory-signals'
import { listPendingSuggestionsForSite } from '@/lib/db/subject-suggestions'

export type AttentionSignal =
  | 'subject_stagnant'
  | 'action_overdue'
  | 'deadline_near'
  | 'reserve_open'
  | 'relation_blocking'
  | 'blocage_active'
  | 'actor_congestion'
  | 'subject_changed'
  | 'proposal_pending'
  | 'link_suggested'

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

function maxUrgency(a: AttentionUrgency, b: AttentionUrgency): AttentionUrgency {
  return URGENCY_RANK[a] <= URGENCY_RANK[b] ? a : b
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
  ] = await Promise.all([
    getNavigableSubjectsForSite(siteId),
    admin
      .from('site_actions')
      .select('id, title, due_date, subject_thread_id, assigned_to')
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
      // A requires B : B stagnant bloque A
      blockingByCsId.set(toCs, { blockedLabel: link.fromLabel ?? '?', linkType: 'requires' })
    }
    if (link.linkType === 'enables' && stagnantCsIds.has(fromCs) && !blockingByCsId.has(fromCs)) {
      // A enables B : A stagnant bloque B
      blockingByCsId.set(fromCs, { blockedLabel: link.toLabel ?? '?', linkType: 'enables' })
    }
  }

  // Ensemble des csId déjà couverts → déduplique les signaux action/deadline
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

  // ── 2. Sujets stagnants ───────────────────────────────────────────────────
  for (const s of subjects) {
    if (!s.isStagnant) continue

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

  // ── 3. Actions en retard ──────────────────────────────────────────────────
  const overdueActions = (overdueResult.data ?? []) as Array<{
    id: string; title: string; due_date: string; subject_thread_id: string | null; assigned_to: string | null
  }>

  for (const action of overdueActions) {
    const csId = action.subject_thread_id ? threadToCs.get(action.subject_thread_id) : undefined
    if (csId && coveredCsIds.has(csId)) continue // déjà couvert par sujet stagnant

    const overdueDays = daysBetween(action.due_date, today)
    const urgency: AttentionUrgency = overdueDays > 14 ? 'critical' : overdueDays > 7 ? 'high' : 'medium'

    if (csId) {
      const s = csIndex.get(csId)
      items.push({
        signal: 'action_overdue',
        title: s?.title ?? action.title,
        reason: `Action « ${action.title} » en retard de ${overdueDays} j`,
        urgency,
        href: subjectHref(csId),
        metadata: { actionId: action.id, canonicalSubjectId: csId },
      })
      coveredCsIds.add(csId)
    } else {
      items.push({
        signal: 'action_overdue',
        title: action.title,
        reason: `En retard de ${overdueDays} j (échéance ${action.due_date})`,
        urgency,
        href: `/sites/${siteId}/actions`,
        metadata: { actionId: action.id },
      })
    }
  }

  // ── 4. Échéances proches ──────────────────────────────────────────────────
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

  // ── 5. Réserves ouvertes ──────────────────────────────────────────────────
  const openReserves = (reserveResult.data ?? []) as Array<{
    id: string; label: string; issued_on: string | null
  }>

  for (const r of openReserves) {
    const openDays = r.issued_on ? daysBetween(r.issued_on, today) : null
    const urgency: AttentionUrgency = openDays != null && openDays > 45 ? 'critical' :
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

  // ── 6. Congestion acteur ──────────────────────────────────────────────────
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

  // ── 7. Sujets ayant changé depuis la dernière visite ─────────────────────
  if (lastVisitAt) {
    for (const s of subjects) {
      if (!s.lastMeaningfulChangeAt) continue
      if (s.lastMeaningfulChangeAt <= lastVisitAt) continue
      if (coveredCsIds.has(s.canonicalSubjectId)) continue // déjà dans un item

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

  // ── 8. Propositions de rapprochement en attente ───────────────────────────
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

  // ── 9. Relations suggérées en attente ────────────────────────────────────
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
