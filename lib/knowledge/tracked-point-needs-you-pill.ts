// 6E.4A.10 — copie de la pilule mobile "MemorIA a besoin de toi" (fiche chantier /m/site/[siteId]).
// Mandat exact de Vincent (2026-09-07, révisé 2026-09-08 après relecture de la doctrine priorité
// PRIORITAIRE/IMPORTANT) : jamais le total brut en titre ; PRIORITAIRE (Point reopened/conflict)
// et IMPORTANT (Point open) sont deux niveaux distincts — cf. tracked-point-needs-you-priority.ts,
// « Historique ≠ faible importance ». Un sujet PRIORITAIRE ou IMPORTANT reste visible même quand
// aucune question n'est datée du dernier PV : la fraîcheur n'est jamais ce qui décide de la
// visibilité d'un signal réel.
//
// Cinq gabarits, aucun autre :
//   - activité PV récente, priorité PRIORITAIRE -> "MemorIA · P prioritaire(s) · N sur le dernier PV"
//   - activité PV récente, priorité IMPORTANT    -> "MemorIA · I importante(s) · N sur le dernier PV"
//   - activité PV récente, aucune priorité       -> "MemorIA · N questions sur le dernier PV"
//   - aucune activité PV récente, PRIORITAIRE    -> "MemorIA · P prioritaire(s) à clarifier"
//   - aucune activité PV récente, IMPORTANT      -> "MemorIA · I importante(s) à clarifier"
//   - aucune activité PV récente, ni l'un ni l'autre -> "H clarification(s) historique(s)" (discret)

import type { MemoriaNeedsYouSummary } from './tracked-point-needs-you-summary'
import { computeQuestionPriority } from './tracked-point-needs-you-priority'

export type MemoriaNeedsYouPillTone = 'default' | 'priority' | 'important' | 'historical'

export type MemoriaNeedsYouPill = {
  tone: MemoriaNeedsYouPillTone
  label: string
  priorityCount: number
  importantCount: number
}

function plural(count: number, singular: string, plural: string): string {
  return count > 1 ? plural : singular
}

export function computeMemoriaNeedsYouPill(summary: MemoriaNeedsYouSummary): MemoriaNeedsYouPill | null {
  if (summary.totalCount === 0) return null

  const priorityCount = summary.questions.filter((q) => computeQuestionPriority(q) === 'PRIORITAIRE').length
  const importantCount = summary.questions.filter((q) => computeQuestionPriority(q) === 'IMPORTANT').length

  if (summary.latestPvCount > 0) {
    if (priorityCount > 0) {
      return {
        tone: 'priority',
        priorityCount,
        importantCount,
        label: `MemorIA · ${priorityCount} ${plural(priorityCount, 'prioritaire', 'prioritaires')} · ${summary.latestPvCount} sur le dernier PV`,
      }
    }
    if (importantCount > 0) {
      return {
        tone: 'important',
        priorityCount: 0,
        importantCount,
        label: `MemorIA · ${importantCount} ${plural(importantCount, 'importante', 'importantes')} · ${summary.latestPvCount} sur le dernier PV`,
      }
    }
    return {
      tone: 'default',
      priorityCount: 0,
      importantCount: 0,
      label: `MemorIA · ${summary.latestPvCount} ${plural(summary.latestPvCount, 'question', 'questions')} sur le dernier PV`,
    }
  }

  if (priorityCount > 0) {
    return {
      tone: 'priority',
      priorityCount,
      importantCount,
      label: `MemorIA · ${priorityCount} ${plural(priorityCount, 'prioritaire', 'prioritaires')} à clarifier`,
    }
  }
  if (importantCount > 0) {
    return {
      tone: 'important',
      priorityCount: 0,
      importantCount,
      label: `MemorIA · ${importantCount} ${plural(importantCount, 'importante', 'importantes')} à clarifier`,
    }
  }

  return {
    tone: 'historical',
    priorityCount: 0,
    importantCount: 0,
    label: `${summary.historicalCount} ${plural(summary.historicalCount, 'clarification', 'clarifications')} ${plural(summary.historicalCount, 'historique', 'historiques')}`,
  }
}
