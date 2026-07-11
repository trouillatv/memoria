// Chaînage PUR des points de repère photographiques (mig 195).
// Une série = une photo ANCRE (is_viewpoint) + ses REPRISES (viewpoint_of →
// ancre). Ce module regroupe des lignes en séries et désigne la photo la plus
// récente de chacune (celle qui servira de fantôme à la prochaine reprise).
// Aucune dépendance serveur : testable en CI (projet unit).

export interface ViewpointCaptureLite {
  id: string
  is_viewpoint: boolean
  viewpoint_of: string | null
  body: string | null
  captured_at: string | null
  created_at: string
}

export interface ViewpointChain<T extends ViewpointCaptureLite> {
  /** L'ancre de la série (capture épinglée). */
  anchorId: string
  /** Nom lisible : le commentaire de l'ancre, sinon null (l'UI dira « Photo de référence »). */
  label: string | null
  /** La photo la plus récente de la série — le futur fantôme. */
  last: T
  /** Nombre de photos dans la série (ancre comprise). */
  shots: number
  /** La série complète, du plus ancien au plus récent — l'écran « Évolution ». */
  serie: T[]
}

function instant(c: ViewpointCaptureLite): number {
  return new Date(c.captured_at ?? c.created_at).getTime()
}

/**
 * Regroupe ancres + reprises en séries. Une reprise orpheline (ancre supprimée
 * → viewpoint_of ON DELETE SET NULL, ou ancre écartée) est ignorée : une série
 * sans ancre n'a plus de sens à proposer.
 */
export function groupViewpointChains<T extends ViewpointCaptureLite>(rows: T[]): ViewpointChain<T>[] {
  const anchors = rows.filter((r) => r.is_viewpoint)
  if (anchors.length === 0) return []
  const byAnchor = new Map<string, T[]>(anchors.map((a) => [a.id, [a]]))
  for (const r of rows) {
    if (r.viewpoint_of && byAnchor.has(r.viewpoint_of)) byAnchor.get(r.viewpoint_of)!.push(r)
  }
  const chains: ViewpointChain<T>[] = []
  for (const anchor of anchors) {
    const serie = byAnchor.get(anchor.id)!
    serie.sort((a, b) => instant(a) - instant(b))
    chains.push({
      anchorId: anchor.id,
      label: anchor.body?.trim() || null,
      last: serie[serie.length - 1],
      shots: serie.length,
      serie,
    })
  }
  // Séries les plus récemment reprises d'abord — celles qu'on est en train de suivre.
  chains.sort((a, b) => instant(b.last) - instant(a.last))
  return chains
}
