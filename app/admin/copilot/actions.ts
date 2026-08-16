'use server'

import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import {
  getCopilotInteractionDetail,
  type CopilotInteractionDetail,
} from '@/lib/db/copilot-interactions-read'
import {
  updateCopilotCauseDiagnostic,
  updateCopilotAnswerQuality,
  type CopilotCauseDiagnostic,
  type CopilotAnswerQuality,
} from '@/lib/db/copilot-telemetry'

export async function fetchInteractionDetail(id: string): Promise<CopilotInteractionDetail | null> {
  const user = await getCurrentUserWithProfile()
  if (!user || user.role !== 'admin') redirect('/missions')
  return getCopilotInteractionDetail(id)
}

/**
 * Classification manuelle de la cause racine (brique 2). Un humain (recette
 * ou revue) pose ce diagnostic ; une future proposition LLM (brique 3) devra
 * passer par la même validation, jamais une écriture directe.
 */
export async function setInteractionCauseDiagnostic(
  id: string,
  cause: CopilotCauseDiagnostic,
): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || user.role !== 'admin') redirect('/missions')
  await updateCopilotCauseDiagnostic(id, cause)
}

/**
 * Marque humaine sur la qualité de la réponse (correcte / incomplète /
 * incorrecte) + correction ou note libre optionnelle (brique 2).
 */
export async function setInteractionAnswerQuality(
  id: string,
  quality: CopilotAnswerQuality,
  comment?: string | null,
): Promise<void> {
  const user = await getCurrentUserWithProfile()
  if (!user || user.role !== 'admin') redirect('/missions')
  await updateCopilotAnswerQuality(id, quality, comment ?? null)
}
