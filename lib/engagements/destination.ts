// Suggéreur de destination d'une proposition (Atelier IA v2, Phase 1).
// Vincent 2026-05-25. PUR, déterministe, explicable — PAS de LLM (discipline
// [[ai-cost-discipline]]). L'IA propose une destination ; l'humain valide.
//
// V1 : on ne distingue que vigilance vs obligation contractuelle. Les
// destinations site-scopées (a_savoir/mission) restent en attente jusqu'à la
// conversion (option A) et ne sont pas suggérées ici.

import type { EngagementDestination } from '@/types/db'
export type { EngagementDestination }

// Signaux d'une VIGILANCE : pénalité, sanction, risque contractuel, point
// sensible. Volontairement resserré (sous-déclencher plutôt que sur-flagger —
// le défaut « obligation » est sûr, l'humain promeut si besoin).
// Radicaux (pas d'ancre \b : « résili » doit matcher dans « résiliation »).
const VIGILANCE_RE =
  /(p[ée]nalit|sanction|r[ée]sili|amende|retenue sur|manquement|mise en demeure|contr[ôo]le inopin|zone sensible|zones? à risque)/

export interface DestinationSuggestion {
  destination: EngagementDestination
  reason: string
}

/** Pur & déterministe. Défaut = obligation de contrat. */
export function suggestDestination(input: {
  category: string
  sourceExcerpt: string
  shortLabel?: string
}): DestinationSuggestion {
  const hay = `${input.sourceExcerpt} ${input.shortLabel ?? ''}`
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
  if (VIGILANCE_RE.test(hay)) {
    return { destination: 'vigilance', reason: 'Pénalité / risque / point sensible détecté' }
  }
  return { destination: 'contract_engagement', reason: 'Obligation contractuelle standard' }
}

/** Libellé + teinte UI d'une destination (curation). */
export const DESTINATION_META: Record<EngagementDestination, { label: string; badge: string }> = {
  contract_engagement: { label: 'Obligation contrat', badge: 'border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300' },
  vigilance: { label: 'Vigilance', badge: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300' },
  a_savoir: { label: 'À savoir (à la conversion)', badge: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300' },
  mission: { label: 'Mission (à la conversion)', badge: 'border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300' },
}
