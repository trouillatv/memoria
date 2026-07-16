import { describe, expect, it } from 'vitest'
import { computeSnapshotDelta, countSnapshotDelta, EMPTY_SNAPSHOT } from '@/lib/visits/source-snapshot'

// La règle partagée par le débrief et la fiche chantier : « la visite a-t-elle été
// enrichie depuis la synthèse ? ». Si ces deux écrans divergent, ils racontent deux
// histoires différentes de la même visite.

const snapshot = (photos: number, videos: number, vocals: number, notes: number) => ({
  photos, videos, vocals, notes, last_capture_at: null,
})

describe('computeSnapshotDelta', () => {
  it('ne signale rien quand la visite n’a pas bougé', () => {
    const delta = computeSnapshotDelta(snapshot(2, 1, 3, 4), snapshot(2, 1, 3, 4))
    expect(countSnapshotDelta(delta)).toBe(0)
  })

  it('compte ce qui a été ajouté depuis la synthèse', () => {
    const delta = computeSnapshotDelta(snapshot(2, 0, 1, 1), snapshot(4, 0, 1, 2))
    expect(delta).toEqual({ photos: 2, videos: 0, vocals: 0, notes: 1 })
    expect(countSnapshotDelta(delta)).toBe(3)
  })

  it('ne « dé-périme » jamais une synthèse quand un élément est supprimé', () => {
    // Une synthèse reste la lecture d'un état passé : retirer une photo ne la
    // rend pas plus à jour. Le delta ne descend jamais sous zéro.
    const delta = computeSnapshotDelta(snapshot(5, 0, 0, 0), snapshot(2, 0, 0, 0))
    expect(delta.photos).toBe(0)
    expect(countSnapshotDelta(delta)).toBe(0)
  })

  it('traite une synthèse sans snapshot comme n’ayant rien pris en compte', () => {
    // Synthèses d'avant le snapshot : tout ce qui existe est « ajouté depuis ».
    const delta = computeSnapshotDelta(null, snapshot(1, 0, 2, 0))
    expect(countSnapshotDelta(delta)).toBe(3)
  })

  it('part d’un snapshot vide neutre', () => {
    expect(countSnapshotDelta(computeSnapshotDelta(EMPTY_SNAPSHOT, EMPTY_SNAPSHOT))).toBe(0)
  })
})
