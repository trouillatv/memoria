// ── « Ce que la synthèse a pris en compte » — LA règle, en un seul endroit ────
// La visite est la vérité ; la synthèse en est une lecture horodatée. Comparer le
// snapshot stocké dans la synthèse au snapshot courant répond à UNE question :
// « la visite a-t-elle été enrichie depuis ? »
//
// Cette règle est utilisée par DEUX appelants qui ne doivent jamais diverger :
//   - le débrief (loadOrRunVisitDebrief) : décide de proposer « Mettre à jour » ;
//   - le read model (getSiteOverview) : dit « synthèse dépassée, +1 note ».
// Module PUR (aucun accès données) : les deux couches partagent le sens, pas la
// plomberie.

import type { VisitSourceSnapshot } from '@/lib/db/visits'

/** Ce qui a été AJOUTÉ depuis la synthèse. Jamais négatif : une suppression ne
 *  « dé-périme » pas une synthèse — elle reste une lecture d'un état passé. */
export interface SnapshotDelta {
  photos: number
  videos: number
  vocals: number
  notes: number
}

export const EMPTY_SNAPSHOT: VisitSourceSnapshot = {
  photos: 0,
  videos: 0,
  vocals: 0,
  notes: 0,
  last_capture_at: null,
}

export function computeSnapshotDelta(
  old: VisitSourceSnapshot | null | undefined,
  cur: VisitSourceSnapshot,
): SnapshotDelta {
  const o = old ?? EMPTY_SNAPSHOT
  return {
    photos: Math.max(0, cur.photos - o.photos),
    videos: Math.max(0, cur.videos - o.videos),
    vocals: Math.max(0, cur.vocals - o.vocals),
    notes: Math.max(0, cur.notes - o.notes),
  }
}

/** Combien d'éléments ont été ajoutés depuis la synthèse (0 = à jour). */
export function countSnapshotDelta(delta: SnapshotDelta): number {
  return delta.photos + delta.videos + delta.vocals + delta.notes
}
