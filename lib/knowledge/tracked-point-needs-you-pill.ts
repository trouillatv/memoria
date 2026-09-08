// 6E.4A.10 — copie de la pilule mobile "MemorIA a besoin de toi" (fiche chantier /m/site/[siteId]).
// Mandat exact de Vincent (2026-09-07) : jamais le total brut en titre ; le signal utile
// "maintenant" est le nombre de questions sur le dernier PV, avec un indicateur de priorité
// réelle (PRIORITAIRE, cf. tracked-point-needs-you-priority.ts) quand il existe ; en l'absence
// d'activité PV récente, un rendu beaucoup plus discret n'affichant que l'historique.
//
// Trois gabarits, aucun autre :
//   - activité PV récente, aucune priorité   -> "MemorIA · N questions sur le dernier PV"
//   - activité PV récente, priorité réelle   -> "MemorIA · P importante(s) · N sur le dernier PV"
//   - aucune activité PV récente             -> "H clarification(s) historique(s)" (discret)
//
// Le cas priorité-réelle-mais-uniquement-historique (aucune question datée du dernier PV) n'est
// pas couvert par un 4e gabarit : Vincent n'a spécifié que ces trois messages, et l'étendre sans
// mandat élargirait le périmètre. Repli : le rendu historique s'applique quand même (le signal
// n'est simplement pas mis en avant), point noté ici plutôt que corrigé silencieusement.

import type { MemoriaNeedsYouSummary } from './tracked-point-needs-you-summary'
import { computeQuestionPriority } from './tracked-point-needs-you-priority'

export type MemoriaNeedsYouPillTone = 'default' | 'priority' | 'historical'

export type MemoriaNeedsYouPill = {
  tone: MemoriaNeedsYouPillTone
  label: string
  priorityCount: number
}

function plural(count: number, singular: string, plural: string): string {
  return count > 1 ? plural : singular
}

export function computeMemoriaNeedsYouPill(summary: MemoriaNeedsYouSummary): MemoriaNeedsYouPill | null {
  if (summary.totalCount === 0) return null

  const priorityCount = summary.questions.filter((q) => computeQuestionPriority(q) === 'PRIORITAIRE').length

  if (summary.latestPvCount > 0) {
    if (priorityCount > 0) {
      return {
        tone: 'priority',
        priorityCount,
        label: `MemorIA · ${priorityCount} ${plural(priorityCount, 'importante', 'importantes')} · ${summary.latestPvCount} sur le dernier PV`,
      }
    }
    return {
      tone: 'default',
      priorityCount: 0,
      label: `MemorIA · ${summary.latestPvCount} ${plural(summary.latestPvCount, 'question', 'questions')} sur le dernier PV`,
    }
  }

  return {
    tone: 'historical',
    priorityCount,
    label: `${summary.historicalCount} ${plural(summary.historicalCount, 'clarification', 'clarifications')} ${plural(summary.historicalCount, 'historique', 'historiques')}`,
  }
}
