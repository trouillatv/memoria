// Contexte déterministe pour le Copilote Phase 2.
// Transforme les read-models déjà calculés (SiteOverview + prépItems)
// en un JSON structuré, prêt à être injecté dans le LLM ou à servir
// de fallback déterministe. Aucun appel DB ici — pure fonction.

import type { SiteOverview, AttentionReason } from '@/lib/knowledge/site-overview'
import type { SiteAttentionItem, AttentionSignal } from '@/lib/knowledge/site-attention-items'

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
  fromDate: string | null  // date du PV précédent (référence)
  toDate: string | null    // date du PV analysé (le plus récent)
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
  attentionItems: SiteAttentionItem[] = [],
): SiteCopilotContext {
  const subjectMap = new Map<string, CopilotItem>()
  /** Signaux du moteur sans sujet canonique (réserves, blocages, congestion…). */
  const engineSignals: CopilotItem[] = []

  // ── Moteur canonique d'attention (deriveSiteAttentionItems, via le briefing) ──
  //
  // Première source injectée, volontairement : `upsertSubject` conserve le
  // premier `href` rencontré, et on veut que ce soit celui du moteur d'origine
  // (`/sites/:id/historique/sujets/:csId` → historique et preuves), pas un lien
  // de repli. Le LLM ne fabrique jamais de lien : il ne voit que ceux-là.
  //
  // Sans ce branchement, un chantier terrain sans PV analysé (PETRO ATTITI)
  // arrivait au générateur avec ZÉRO item : tout le contexte venait de
  // `overview.pv*`, alimenté par le seul moteur PV.
  for (const item of attentionItems) {
    const csId = typeof item.metadata?.canonicalSubjectId === 'string'
      ? item.metadata.canonicalSubjectId
      : null
    const entry: CopilotItem = {
      type: attentionItemType(item.signal),
      id: csId ?? `${item.signal}:${item.title}`,
      label: item.title,
      facts: item.reason ? [item.reason] : [],
      href: item.href,
      intents: attentionSignalIntents(item.signal),
    }
    // Dédup par sujet canonique : deux signaux sur le même sujet = un item dont
    // les faits et les intentions fusionnent, jamais deux lignes concurrentes.
    if (csId) upsertSubject(subjectMap, csId, entry)
    else engineSignals.push(entry)
  }

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
      intents: reasonIntents(),
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
        toDate:   overview.pvLastDelta.toDate,
        nouveaux: overview.pvLastDelta.nouveaux,
        aggravés: overview.pvLastDelta.aggravésRéouverts,
        traités: overview.pvLastDelta.réalisésLevés,
      }
    : null

  return {
    site: { id: siteId, name: siteName },
    asOf: new Date().toISOString(),
    items: [...subjectMap.values(), ...engineSignals, ...signalItems, ...changeItems],
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
    const fmtShort = (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '?'
    const range = delta.fromDate && delta.toDate
      ? `Du PV du ${fmtShort(delta.fromDate)} au PV du ${fmtShort(delta.toDate)}`
      : 'Entre les deux derniers PV'
    const parts: string[] = []
    if (delta.nouveaux > 0)  parts.push(`${delta.nouveaux} nouveau${delta.nouveaux > 1 ? 'x point' : ' point'}`)
    if (delta.aggravés > 0)  parts.push(`${delta.aggravés} aggravé${delta.aggravés > 1 ? 's' : ''}`)
    if (delta.traités > 0)   parts.push(`${delta.traités} traité${delta.traités > 1 ? 's' : ''}`)
    if (parts.length === 0) return `${range} : aucun changement notable.`
    return `${range} : ${parts.join(', ')}.`
  }

  if (intent === 'next_visit') {
    const lines: string[] = []
    if (prepItems.length > 0) {
      lines.push(`Plan de visite actif :\n${prepItems.map((p) => `• ${p.label}`).join('\n')}`)
    }
    const subjects = items.filter((i) => i.type === 'subject')
    if (subjects.length > 0) {
      const header = prepItems.length > 0
        ? `\nPoints à vérifier (${subjects.length}) :`
        : `Points à vérifier (${subjects.length}) :`
      lines.push(header)
      for (const s of subjects) {
        const detail = s.facts.filter(Boolean).join(' · ')
        lines.push(`• ${s.label}${detail ? ` — ${detail}` : ''}`)
      }
    }
    return lines.join('\n') || 'Aucun point prioritaire identifié pour la prochaine visite.'
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

/**
 * Intentions rapides réellement pertinentes pour ce chantier.
 *
 * Un raccourci n'est proposé que si le moteur a matière à répondre — c'est le
 * MÊME filtre que celui utilisé pour construire la réponse, donc l'affichage ne
 * peut pas diverger du contenu (doctrine : les suggestions du Copilote doivent
 * être conditionnées par ce que MemorIA sait réellement du chantier).
 */
export function availableQuickIntents(context: SiteCopilotContext): CopilotIntent[] {
  const all: CopilotIntent[] = ['attention', 'changes', 'stale', 'next_visit']
  return all.filter((intent) => {
    const { items, delta, prepItems } = filterContextForIntent(context, intent)
    if (items.length > 0) return true
    if (intent === 'changes') return delta !== null
    if (intent === 'next_visit') return prepItems.length > 0
    return false
  })
}

/**
 * Décide si une question quantitative peut recevoir une réponse « zéro » ferme.
 *
 * DOCTRINE (Vincent, 2026-08) : **un verdict quantitatif exige une mesure
 * quantitative, pas l'absence d'un signal.**
 *
 * La version précédente concluait « aucune action en retard » depuis
 * `itemCount === 0`, c'est-à-dire depuis le fait que le FILTRE n'avait rien
 * retenu. Sur PETRO ATTITI, où le contexte était vide pour une raison de
 * retrieval (aucun PV analysé), cela produisait une affirmation métier fausse,
 * énoncée avec aplomb. Trois états sont désormais distincts :
 *   — compteur chargé et > 0      → pas de verdict, le générateur répond ;
 *   — compteur chargé et = 0      → `confirmed_zero`, affirmation légitime ;
 *   — compteur absent / en échec  → `unknown`, jamais un zéro.
 */
export type QuantitativeVerdict =
  | { kind: 'confirmed_zero'; text: string }
  | { kind: 'unknown'; text: string }
  | null

/**
 * Compteurs métier réellement chargés. `null`/absent = « non mesuré », ce qui
 * n'est jamais interprété comme zéro.
 */
export interface QuantitativeMeasures {
  actionsOverdue?: number | null
  deadlinesOverdue?: number | null
  reservesOpen?: number | null
  blocagesActive?: number | null
  subjectsStagnant?: number | null
}

type QuantitativeTopic = {
  key: keyof QuantitativeMeasures
  /** Le sujet mesuré doit être nommé dans la question — pas seulement supposé. */
  match: RegExp
  subject: string
}

// Ordre = priorité. Le plus spécifique d'abord : « échéances en retard » ne doit
// pas être servi par le compteur d'actions, et « qu'est-ce qui bloque ? » ne doit
// jamais recevoir un zéro d'actions en retard (c'est la confusion exacte que ce
// lot supprime).
const QUANTITATIVE_TOPICS: QuantitativeTopic[] = [
  {
    key: 'deadlinesOverdue',
    match: /\b(?:[ée]ch[ée]ances?|d[ée]lais?)\b[\s\S]{0,40}\bre?tard\b|\bre?tard\b[\s\S]{0,40}\b(?:[ée]ch[ée]ances?|d[ée]lais?)\b/i,
    subject: 'échéance',
  },
  {
    key: 'blocagesActive',
    match: /\bblocages?\b|\bbloqu[ée]e?s?\b|\bqu[' ’]?est.ce qui bloque\b/i,
    subject: 'blocage',
  },
  {
    key: 'reservesOpen',
    match: /\br[ée]serves?\b/i,
    subject: 'réserve',
  },
  {
    key: 'actionsOverdue',
    match: /\bre?tards?\b/i,
    subject: 'action en retard',
  },
]

const ZERO_TEXT: Record<keyof QuantitativeMeasures, string> = {
  actionsOverdue:   "Aucune action n'est actuellement en retard sur ce chantier.",
  deadlinesOverdue: "Aucune échéance n'est actuellement en retard sur ce chantier.",
  reservesOpen:     "Aucune réserve n'est actuellement ouverte sur ce chantier.",
  blocagesActive:   "Aucun blocage n'est actuellement déclaré sur ce chantier.",
  subjectsStagnant: "Aucun sujet ne franchit actuellement le seuil de stagnation.",
}

export function resolveQuantitativeVerdict(input: {
  question: string
  primaryIntent: string
  measures: QuantitativeMeasures
  overviewLoadFailed: boolean
  /** Sujet le plus proche du seuil, pour ne pas répondre « rien » sans rien montrer. */
  stagnationClosest?: { title: string; days: number } | null
}): QuantitativeVerdict {
  // Seules les familles qui POSENT une question de comptage. `global` en est
  // exclu : « où en est le chantier ? » attend une synthèse, jamais un zéro.
  const isCountingFamily =
    input.primaryIntent === 'action_status' || input.primaryIntent === 'stagnation'
  if (!isCountingFamily) return null

  const key: keyof QuantitativeMeasures | null =
    input.primaryIntent === 'stagnation'
      ? 'subjectsStagnant'
      : QUANTITATIVE_TOPICS.find((t) => t.match.test(input.question))?.key ?? null
  if (!key) return null

  if (input.overviewLoadFailed) {
    return {
      kind: 'unknown',
      text: "Je n'ai pas pu charger les données de suivi de ce chantier. Je préfère ne rien affirmer plutôt que de vous dire à tort qu'il n'y a rien à signaler — réessayez dans quelques instants.",
    }
  }

  const count = input.measures[key]
  // Compteur non chargé : le silence de la mesure n'est pas un zéro métier.
  if (count === null || count === undefined) {
    return {
      kind: 'unknown',
      text: "Je n'ai pas cette mesure sous la main pour ce chantier. Je préfère vous le dire plutôt que d'affirmer qu'il n'y a rien.",
    }
  }

  // Il y a de la matière : le générateur répond normalement, pas de raccourci.
  if (count > 0) return null

  if (key === 'subjectsStagnant' && input.stagnationClosest) {
    const { title, days } = input.stagnationClosest
    return {
      kind: 'confirmed_zero',
      text: `${ZERO_TEXT.subjectsStagnant} Le sujet le plus ancien sans évolution significative est « ${title} », à ${days} jour${days > 1 ? 's' : ''}.`,
    }
  }

  return { kind: 'confirmed_zero', text: ZERO_TEXT[key] }
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

// `stale` a été retiré de action_overdue / reserve_old : une action en retard ou
// une réserve ancienne relèvent du RETARD (une date confirmée est dépassée), pas
// de la STAGNATION (un sujet rementionné qui n'a pas bougé sur le fond). Les
// confondre faisait répondre « aucune action en retard » à « qu'est-ce qui
// n'avance pas ? ». La stagnation réelle vient désormais du moteur canonique
// (`subject_stagnant` / `pv_stagnant` / `relation_blocking`).
// Plus aucune discrimination par `kind` : toutes ces raisons ne portent que `attention`.
function reasonIntents(): CopilotIntent[] {
  return ['attention']
}

// ── Moteur canonique → contexte copilote ──────────────────────────────────────

function attentionItemType(signal: AttentionSignal): CopilotItem['type'] {
  switch (signal) {
    case 'action_overdue':
    case 'action_to_verify':
      return 'action'
    case 'deadline_near':
    case 'deadline_overdue':
      return 'deadline'
    case 'subject_stagnant':
    case 'subject_changed':
    case 'relation_blocking':
    case 'pv_status':
    case 'pv_stagnant':
      return 'subject'
    default:
      return 'signal'
  }
}

/**
 * Traduit un signal du moteur en intentions copilote.
 *
 * `stale` est réservé aux signaux qui décrivent une ABSENCE D'ÉVOLUTION mesurée
 * par le moteur canonique. `attention` reste porté par tous : un sujet stagnant
 * mérite aussi d'apparaître dans « où en est le chantier ? ».
 */
function attentionSignalIntents(signal: AttentionSignal): CopilotIntent[] {
  switch (signal) {
    case 'subject_stagnant':
    case 'pv_stagnant':
    case 'relation_blocking':
      return ['attention', 'stale']
    case 'subject_changed':
      return ['attention', 'changes']
    default:
      return ['attention']
  }
}
