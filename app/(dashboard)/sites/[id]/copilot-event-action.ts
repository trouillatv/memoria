'use server'

// Copilote — événements client légers.
// Appelés depuis CopilotBlock après que l'interaction a déjà été créée côté serveur.
// Best-effort : l'appelant ne doit jamais await ces fonctions de façon bloquante.

import { z } from 'zod'
import { requireSiteAccess } from '@/lib/auth/resource-access'
import {
  updateCopilotProposalStatus,
  incrementCopilotReferenceClick,
} from '@/lib/db/copilot-telemetry'

const uuidSchema = z.string().uuid()

/**
 * Enregistre un clic sur une référence dans une réponse du Copilote.
 * Incrémente le compteur de façon atomique.
 */
export async function trackCopilotReferenceClick(input: {
  interactionId: string
  siteId: string
}): Promise<void> {
  try {
    if (!uuidSchema.safeParse(input.interactionId).success) return
    await requireSiteAccess(input.siteId)
    await incrementCopilotReferenceClick(input.interactionId)
  } catch {
    // best-effort
  }
}

/**
 * Met à jour le statut d'une proposition (cancelled) depuis le client.
 * La confirmation (confirmed) est tracée directement dans createCopilotAction.
 */
export async function trackCopilotProposalCancelled(input: {
  interactionId: string
  siteId: string
}): Promise<void> {
  try {
    if (!uuidSchema.safeParse(input.interactionId).success) return
    await requireSiteAccess(input.siteId)
    await updateCopilotProposalStatus(input.interactionId, 'cancelled')
  } catch {
    // best-effort
  }
}
