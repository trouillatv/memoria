// Climat mémoriel d'un contrat — couche PURE (aucun import server-only).
//
// Vincent 2026-05-26. Cf. [[etats-fragiles-moteur-surfacage]] (« 1 source,
// N surfaces ») : la page /contracts est une nouvelle surface du MÊME moteur
// de signaux. On AGRÈGE les signaux des SITES d'un contrat en UN état lisible.
//
// Doctrine encodée ici :
//   - Sujet = lieu / mémoire, JAMAIS RH (cf. [[refus-erp-rh-pointage-gps]]).
//     « relay_instability » devient « Relais récents sur le site », pas une
//     mention de rotation d'équipes / staffing.
//   - Plafond ambre : pas de rouge sur une liste (rouge réservé à l'urgence
//     réelle d'une fiche, pas à un parc).
//   - Calme = puce seule, pas de ligne (anti-papier-peint) : le silence
//     redevient signifiant (cf. [[discipline-dapparition]]).
//   - Écho juste : tout libellé/chiffre sort d'un signal réel, jamais simulé.

import type { MemorySignal } from '@/lib/memory/signals/types'
import { SIGNAL_REGISTRY } from '@/lib/memory/signals/registry'

export type ClimateTone = 'calme' | 'stable' | 'vigilance'

export interface ContractClimate {
  tone: ClimateTone
  /** Libellé du climat (puce). */
  label: string
  /** Ligne mémoire secondaire, factuelle. null si calme. */
  line: string | null
  vigilanceCount: number
}

const CALME: ContractClimate = {
  tone: 'calme',
  label: 'Mémoire calme',
  line: null,
  vigilanceCount: 0,
}

export interface ClimateInput {
  /** Sites du contrat. */
  siteIds: string[]
  /** Signaux mémoire pré-groupés par site (subjectId). */
  signalsBySite: Map<string, MemorySignal[]>
  /** Nombre d'engagements à risque rattachés à ce contrat. */
  atRiskCount: number
  /** Résumé de conformité (needsAttention) du contrat. */
  needsAttention: boolean
}

export function computeContractClimate(input: ClimateInput): ContractClimate {
  const { siteIds, signalsBySite, atRiskCount, needsAttention } = input

  const signals: MemorySignal[] = []
  for (const sid of siteIds) {
    const s = signalsBySite.get(sid)
    if (s) signals.push(...s)
  }
  const has = (k: MemorySignal['kind']) => signals.some((s) => s.kind === k)
  const vigilanceLine = atRiskCount > 0 ? `${atRiskCount} point${atRiskCount > 1 ? 's' : ''} de vigilance` : null

  // — Vigilance (ambre) — priorité : rupture de transmission > silence > relais
  //   > vigilance contractuelle. La PUCE reste courte ; la phrase validée vit
  //   dans la ligne mémoire (lisibilité d'une carte en 2 colonnes).
  if (has('memory_awaiting')) {
    return { tone: 'vigilance', label: 'Passation en attente', line: 'Une passation attend reconnaissance', vigilanceCount: atRiskCount }
  }
  if (has('unusual_silence')) {
    return { tone: 'vigilance', label: 'Sous attention douce', line: silenceLine(signals) ?? vigilanceLine, vigilanceCount: atRiskCount }
  }
  if (has('relay_instability')) {
    return { tone: 'vigilance', label: 'Relais récents', line: 'Continuité récemment transmise', vigilanceCount: atRiskCount }
  }
  if (atRiskCount > 0 || needsAttention) {
    return { tone: 'vigilance', label: 'Sous vigilance', line: vigilanceLine, vigilanceCount: atRiskCount }
  }

  // — Sain (sauge discret) — au moins un signal de santé, aucune fragilité.
  if (signals.some((s) => SIGNAL_REGISTRY[s.kind].valence === 'sain')) {
    return { tone: 'stable', label: 'Continuité stable', line: 'Aucune rupture récente', vigilanceCount: 0 }
  }

  // — Calme (neutre) — aucun signal. Puce seule.
  return CALME
}

/**
 * Pour un silence, `lastRelevantEventAt` = dernière trace connue (cf. types).
 * On en dérive « depuis N j » sans supposer le nom d'un champ de facts.
 */
function silenceLine(signals: MemorySignal[]): string | null {
  const sig = signals.find((s) => s.kind === 'unusual_silence')
  if (!sig?.lastRelevantEventAt) return null
  const days = Math.floor((Date.now() - new Date(sig.lastRelevantEventAt).getTime()) / 86_400_000)
  if (days <= 0) return null
  return `Aucune intervention documentée depuis ${days} j`
}
