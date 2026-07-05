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

// Vocabulaire MÉTIER du traitement des captures (mig 182). « Cette capture montre… »
//   📚 Mémoire      → gardée, aucune suite (preuve, historique du chantier)
//   👀 À surveiller → gardée, remonte aux prochains débriefs
//   ⚠️ Réserve      → gardée, deviendra une réserve au bureau
//   ✅ Action       → gardée, deviendra une action au bureau
//   🗑 Supprimer    → geste VOLONTAIRE (photo floue) — le tri, lui, ne supprime jamais
export type TriageDecision = 'memoire' | 'surveiller' | 'reserve' | 'action' | 'delete'

// Décision métier → état technique (caché au terrain). AUCUN tag ne supprime :
// seul « delete » (volontaire) pose discarded.
const MAP: Record<TriageDecision, { status: 'kept' | 'discarded'; intent: CaptureTriageIntent }> = {
  memoire: { status: 'kept', intent: null },
  surveiller: { status: 'kept', intent: 'follow' },
  reserve: { status: 'kept', intent: 'reserve' },
  action: { status: 'kept', intent: 'action' },
  delete: { status: 'discarded', intent: null },
}

const schema = z.object({
  capture_id: z.string().uuid(),
  decision: z.enum(['memoire', 'surveiller', 'reserve', 'action', 'delete']),
  /** Commentaire « ce que la capture montre » — photo/vidéo uniquement. */
  comment: z.string().max(500).optional(),
})

export async function triageCaptureAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFieldAgent()
  if ('error' in auth) return { ok: false, error: 'Non autorisé' }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Paramètres invalides' }
  try {
    await setCaptureTriage(parsed.data.capture_id, {
      ...MAP[parsed.data.decision],
      ...(parsed.data.comment !== undefined ? { comment: parsed.data.comment } : {}),
    })
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
