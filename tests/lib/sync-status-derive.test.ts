// Lot B — Agrégation de l'état de synchro (header).
//
// Régression ciblée : le badge du header restait vert (« Tout est envoyé »)
// pendant qu'une capture de VISITE (autre file) ou une VIDÉO (upload direct)
// était en attente. deriveState agrège désormais les trois canaux.

import { describe, it, expect } from 'vitest'
import { deriveState } from '@/lib/field/sync-status'
import type { QueuedPhoto } from '@/lib/field/photo-queue'
import type { QueuedVisitCapture } from '@/lib/field/visit-capture-queue'

function legacy(overrides: Partial<QueuedPhoto> = {}): QueuedPhoto {
  return {
    tempId: 't', blob: new Blob(), filename: 'p.jpg', mimeType: 'image/jpeg',
    interventionId: 'i', checklistItemId: null, kind: 'before',
    takenAt: 0, attempts: 0, ...overrides,
  }
}
function visit(overrides: Partial<QueuedVisitCapture> = {}): QueuedVisitCapture {
  return {
    tempId: 't', clientUuid: 'u', reportId: 'r', siteId: 's', kind: 'photo',
    blob: new Blob(), filename: 'p.jpg', mimeType: 'image/jpeg',
    takenAt: 0, attempts: 0, ...overrides,
  }
}

describe('deriveState', () => {
  it('tout vide → vert', () => {
    expect(deriveState([], [], 0)).toEqual({ state: 'green', pendingCount: 0, hasErrors: false })
  })

  it('capture de visite en attente → jaune (le header ne dit plus « tout envoyé »)', () => {
    const s = deriveState([], [visit()], 0)
    expect(s.state).toBe('yellow')
    expect(s.pendingCount).toBe(1)
  })

  it('vidéo en upload direct → jaune', () => {
    const s = deriveState([], [], 1)
    expect(s.state).toBe('yellow')
    expect(s.pendingCount).toBe(1)
  })

  it('total = somme des trois canaux', () => {
    const s = deriveState([legacy()], [visit(), visit()], 2)
    expect(s.pendingCount).toBe(5)
  })

  it('une entry ≥ 3 tentatives (legacy ou visite) → rouge', () => {
    expect(deriveState([legacy({ attempts: 3 })], [], 0).state).toBe('red')
    expect(deriveState([], [visit({ attempts: 4 })], 0).state).toBe('red')
  })

  it('un upload direct seul ne passe jamais en rouge (pas de compteur d’échec)', () => {
    expect(deriveState([], [], 3).state).toBe('yellow')
  })
})
