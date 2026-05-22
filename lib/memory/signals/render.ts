// Renderer — couche PURE (aucun import server-only).
//
// Transforme un signal SÉMANTIQUE en présentation FR. C'est le SEUL endroit où
// naissent la phrase, le détail temporel et le lien. Permet plus tard d'autres
// formats (mobile, push, PDF, vocal) sans toucher aux détecteurs.

import type { MemorySignal } from './types'

export interface RenderedSignal {
  text: string
  detail?: string
  href: string
}

/** « il y a X jours » à partir d'un nombre de jours (déterministe, depuis facts). */
function daysAgoFr(days: number): string {
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  return `il y a ${days} jours`
}

export function renderSignal(s: MemorySignal): RenderedSignal {
  switch (s.kind) {
    case 'handover_acknowledged': {
      return {
        text: `${s.subjectLabel} — passation reconnue, mémoire transmise`,
        detail: `reconnu ${daysAgoFr(Number(s.facts.daysAgo ?? 0))}`,
        href: `/sites/${s.subjectId}`,
      }
    }
    case 'unusual_silence': {
      const days = Number(s.facts.daysSinceLastTrace ?? 0)
      return {
        text: `Aucune intervention documentée sur ${s.subjectLabel} depuis ${days} jours`,
        href: `/sites/${s.subjectId}`,
      }
    }
    case 'fresh_field_memory': {
      const n = Number(s.facts.notesAdded ?? 0)
      return {
        text: `${s.subjectLabel} — mémoire confirmée récemment`,
        detail: `${n} note${n > 1 ? 's' : ''} terrain cette semaine`,
        href: `/sites/${s.subjectId}`,
      }
    }
    default: {
      // Exhaustivité garantie à la compilation : ajouter un kind sans renderer
      // casse le build (verrou « pas de signal sans rendu »).
      const _exhaustive: never = s.kind
      throw new Error(`renderSignal: kind non géré ${String(_exhaustive)}`)
    }
  }
}
