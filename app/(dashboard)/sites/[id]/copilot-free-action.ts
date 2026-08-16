'use server'

// Copilote Phase 3 — conversation libre, lecture seule. TRANSPORT Server Action.
//
// P2-C (16/08) : toute la préparation (classification, résolution de sujet,
// chargement du contexte, moteurs déterministes) vit dans
// `lib/visits/copilot-free-prepare.ts` — un module serveur ORDINAIRE, pas une
// action. Raison de sécurité : `prepareCopilotAnswer` accepte un paramètre de
// confiance (accès déjà décidé par la route vocale) qui, exporté d'un fichier
// `'use server'`, aurait été forgeable par un client invoquant l'action
// directement. Ici ne restent que les transports réellement exposés au client.

import { prepareCopilotAnswer } from '@/lib/visits/copilot-free-prepare'
import { answerCopilotFreeQuestion } from '@/lib/visits/copilot-free-answer'
import type { CopilotFreeResult } from '@/lib/visits/copilot-free-prepare'

export type {
  CopilotFreeCandidate,
  CopilotFreeResult,
  PreparedCopilotAnswer,
  PreparedCopilotAnswerReady,
} from '@/lib/visits/copilot-free-prepare'

// ── Action (transport non streamé) ──────────────────────────────────────────

export async function askCopilotFreeAction(
  rawInput: unknown,
): Promise<CopilotFreeResult> {
  const prep = await prepareCopilotAnswer(rawInput)
  if (prep.kind === 'result') return prep.result

  const answerStartAt = Date.now()
  const answer = await answerCopilotFreeQuestion(
    prep.question,
    prep.history,
    prep.items,
    prep.subjectDetails,
    prep.delta,
    prep.filteredPrep,
    prep.siteName,
    prep.extra,
  )
  return prep.finish(answer, answerStartAt)
}
