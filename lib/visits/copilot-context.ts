// Contexte déterministe pour le Copilote Phase 2.
// Transforme les read-models déjà calculés (SiteOverview + prépItems)
// en un JSON structuré, prêt à être injecté dans le LLM ou à servir
// de fallback déterministe. Aucun appel DB ici — pure fonction.

import type { SiteOverview, AttentionReason } from '@/lib/knowledge/site-overview'

export type CopilotIntent = 'attention' | 'changes' | 'stale' | 'next_visit'

export interface CopilotItem {
  type: 'subject' | 'action' | 'deadline' | 'signal'
  id: string
  label: string
  facts: string[]      // faits déterministes, jamais générés par le LLM
  href: string | null  // URL interne issue du contexte fermé — jamais du LLM
  intents: CopilotIntent[]
}

export interface SiteCopilotDelta {
  fromDate: string | null
  nouveaux: number
  aggravés: number
  traités: number
}

export interface SiteCopilotContext {
  site: { id: string; name: string }
  asOf: string
  items: CopilotItem[]
  delta: SiteCopilotDelta | null
  prepItems: { label: string; stableKey: string }[]
}

export const COPILOT_MAX_INTENT = 8

/**
 * Construit le contexte copilote à partir des données déjà calculées.
 * Invariants :
 *   — Deux sources différentes pour le même canonical_subject → un seul item.
 *   — Les liens suggested ne sont JAMAIS inclus (only confirmed via facts).
 *   — Aucune notion de person / company / knowledge_fact ici.
 */
export function buildSiteCopilotContext(
  siteId: string,
  siteName: string,
  overview: SiteOverview,
  prepItems: { label: string; stableKey: string }[],
): SiteCopilotContext {
  const subjectMap = new Map<string, CopilotItem>()

  // ── pvAttention : sujets demandant attention (+ stale si sans_évolution) ──
  for (const item of overview.pvAttention) {
    if (!item.canonicalSubjectId) continue
    const intents: CopilotIntent[] = ['attention']
    if (item.reason === 'sans_évolution') intents.push('stale')
    const facts = [`Présent dans ${item.pvCount} PV`, pvReasonLabel(item.reason)]
    upsertSubject(subjectMap, item.canonicalSubjectId, {
      type: 'subject', id: item.canonicalSubjectId, label: item.label,
      facts, href: item.href, intents,
    })
  }

  // ── pvToVerify : sujets canoniques à vérifier (next_visit) ────────────────
  // Note : pendingLinks = dépendances "suggested" — on ne les transmet PAS au
  // LLM pour éviter qu'il affirme une causalité non confirmée.
  for (const item of overview.pvToVerify) {
    const facts = item.signals.slice(0, 2)
    upsertSubject(subjectMap, item.canonicalSubjectId, {
      type: 'subject', id: item.canonicalSubjectId, label: item.label,
      facts, href: item.href, intents: ['next_visit'],
    })
  }

  // ── attention.reasons : signaux opérationnels (non canonical subjects) ─────
  const signalItems: CopilotItem[] = overview.attention.reasons
    .filter((r) => r.kind !== 'event_upcoming') // prochain événement = hors périmètre copilote
    .map((r) => ({
      type: reasonItemType(r.kind),
      id: r.id,
      label: r.title,
      facts: r.detail ? [r.detail] : [],
      href: r.href,
      intents: reasonIntents(r.kind),
    }))

  // ── recentChanges : items pour l'intention "changes" ──────────────────────
  const changeItems: CopilotItem[] = overview.recentChanges
    .slice(0, COPILOT_MAX_INTENT)
    .map((c) => ({
      type: 'signal' as const,
      id: c.id,
      label: c.title,
      facts: c.detail ? [c.detail] : [],
      href: c.href,
      intents: ['changes' as CopilotIntent],
    }))

  // ── delta : chiffres du moteur Histoire (= pvLastDelta) ───────────────────
  // Invariant : ces chiffres DOIVENT correspondre exactement à pvLastDelta.
  const delta: SiteCopilotDelta | null = overview.pvLastDelta
    ? {
        fromDate: overview.pvLastDelta.fromDate,
        nouveaux: overview.pvLastDelta.nouveaux,
        aggravés: overview.pvLastDelta.aggravésRéouverts,
        traités: overview.pvLastDelta.réalisésLevés,
      }
    : null

  return {
    site: { id: siteId, name: siteName },
    asOf: new Date().toISOString(),
    items: [...subjectMap.values(), ...signalItems, ...changeItems],
    delta,
    prepItems,
  }
}

/**
 * Filtre et trie les items du contexte pour une intention donnée.
 * Sujets en premier, puis signaux ; tri secondaire par nombre d'intentions
 * (plus d'intentions = plus transversal = plus prioritaire). Max 8 items.
 */
export function filterContextForIntent(
  context: SiteCopilotContext,
  intent: CopilotIntent,
): {
  items: CopilotItem[]
  delta: SiteCopilotDelta | null
  prepItems: { label: string; stableKey: string }[]
} {
  const relevant = context.items
    .filter((item) => item.intents.includes(intent))
    .sort((a, b) => {
      if (a.type === 'subject' && b.type !== 'subject') return -1
      if (a.type !== 'subject' && b.type === 'subject') return 1
      return b.intents.length - a.intents.length
    })
    .slice(0, COPILOT_MAX_INTENT)

  return {
    items: relevant,
    delta: intent === 'changes' ? context.delta : null,
    prepItems: intent === 'next_visit' ? context.prepItems : [],
  }
}

/**
 * Fallback déterministe : si le provider IA échoue, l'utilisateur obtient
 * quand même une réponse utile construite depuis les faits structurés.
 * Jamais un message "IA indisponible".
 */
export function buildFallbackText(
  items: CopilotItem[],
  intent: CopilotIntent,
  delta: SiteCopilotDelta | null,
  prepItems: { label: string; stableKey: string }[],
): string {
  if (intent === 'changes') {
    if (!delta) return 'Aucun delta inter-PV disponible sur ce chantier.'
    const parts: string[] = []
    if (delta.nouveaux > 0)  parts.push(`${delta.nouveaux} nouveau${delta.nouveaux > 1 ? 'x point' : ' point'}`)
    if (delta.aggravés > 0)  parts.push(`${delta.aggravés} aggravé${delta.aggravés > 1 ? 's' : ''}`)
    if (delta.traités > 0)   parts.push(`${delta.traités} traité${delta.traités > 1 ? 's' : ''}`)
    if (parts.length === 0) return 'Aucun changement entre les deux derniers PV.'
    return `Depuis le dernier PV : ${parts.join(', ')}.`
  }

  if (intent === 'next_visit') {
    const lines: string[] = []
    if (prepItems.length > 0) {
      lines.push(`Plan de visite actif : ${prepItems.map((p) => p.label).join(', ')}.`)
    }
    const subjects = items.filter((i) => i.type === 'subject').slice(0, 5)
    if (subjects.length > 0) {
      lines.push(`À vérifier : ${subjects.map((i) => i.label).join(', ')}.`)
    }
    return lines.join(' ') || 'Aucun point prioritaire identifié pour la prochaine visite.'
  }

  const subjects = items.filter((i) => i.type === 'subject').slice(0, 5)
  if (subjects.length === 0) {
    return intent === 'attention'
      ? 'Aucun point d\'attention identifié sur ce chantier.'
      : 'Aucun sujet sans évolution identifié.'
  }
  const verb = intent === 'attention' ? 'méritent votre attention' : 'n\'évoluent pas'
  const parts = subjects.map((i) => `${i.label}${i.facts.length > 0 ? ` (${i.facts[0]})` : ''}`)
  return `Les sujets suivants ${verb} : ${parts.join(' ; ')}.`
}

// ── Helpers internes ──────────────────────────────────────────────────────────

function upsertSubject(map: Map<string, CopilotItem>, csId: string, item: CopilotItem) {
  const existing = map.get(csId)
  if (existing) {
    for (const f of item.facts) {
      if (!existing.facts.includes(f)) existing.facts.push(f)
    }
    for (const i of item.intents) {
      if (!existing.intents.includes(i)) existing.intents.push(i)
    }
    if (!existing.href && item.href) existing.href = item.href
  } else {
    map.set(csId, { ...item, facts: [...item.facts], intents: [...item.intents] })
  }
}

function pvReasonLabel(reason: string): string {
  const map: Record<string, string> = {
    non_conforme:  'Non conforme',
    'aggravé':     'Aggravé',
    'réouvert':    'Réouvert',
    sans_évolution: 'Sans évolution',
  }
  return map[reason] ?? reason
}

function reasonItemType(kind: AttentionReason['kind']): CopilotItem['type'] {
  if (kind === 'action_overdue')    return 'action'
  if (kind === 'deadline_imminent') return 'deadline'
  return 'signal'
}

function reasonIntents(kind: AttentionReason['kind']): CopilotIntent[] {
  if (kind === 'action_overdue' || kind === 'reserve_old') return ['attention', 'stale']
  return ['attention']
}
