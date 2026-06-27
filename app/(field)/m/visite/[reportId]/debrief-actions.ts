'use server'

// Débrief express (voiture) — server action du TRI (mig 168).
// 4 décisions métier seulement. Le tri ENREGISTRE le choix ; la matérialisation
// (action, lien sujet, projection) est faite au bureau. Cf. [[visite-trois-temps]].

import { z } from 'zod'
import { requireFieldAgent } from '@/lib/field/auth'
import {
  setCaptureTriage,
  listVisitCaptures,
  type CaptureTriageIntent,
  type VisitCaptureRow,
} from '@/lib/db/visit-captures'

export type TriageDecision = 'ignore' | 'keep' | 'action' | 'follow'

// Décision métier → état technique (caché au terrain).
const MAP: Record<TriageDecision, { status: 'kept' | 'discarded'; intent: CaptureTriageIntent }> = {
  ignore: { status: 'discarded', intent: null },
  keep: { status: 'kept', intent: null },
  action: { status: 'kept', intent: 'action' },
  follow: { status: 'kept', intent: 'follow' },
}

const schema = z.object({
  capture_id: z.string().uuid(),
  decision: z.enum(['ignore', 'keep', 'action', 'follow']),
})

export async function triageCaptureAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await setCaptureTriage(parsed.data.capture_id, MAP[parsed.data.decision])
    return { ok: true }
  } catch {
    return { ok: false, error: 'Échec du tri' }
  }
}

/**
 * Relit les captures pour faire APPARAÎTRE les transcripts dès qu'ils arrivent
 * (le worker transcrit en fond). Le conducteur ne réécoute jamais : il lit. On
 * ne montre jamais un nom de fichier audio.
 */
export async function refreshDebriefCapturesAction(reportId: string): Promise<VisitCaptureRow[]> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return []
  if (!z.string().uuid().safeParse(reportId).success) return []
  try {
    return await listVisitCaptures(reportId)
  } catch {
    return []
  }
}
