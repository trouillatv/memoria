// Lot B — Registre mémoire des uploads directs (vidéos).
//
// Couvre le trou signalé : le header affichait « Tout est envoyé » alors qu'une
// vidéo montait en direct (hors file IndexedDB). Ce registre alimente désormais
// l'indicateur de synchro.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  beginLiveUpload,
  endLiveUpload,
  snapshotLiveUploads,
  subscribeLiveUploads,
} from '@/lib/field/live-uploads'

beforeEach(() => {
  // Nettoyage entre tests : le store est module-level.
  for (const u of snapshotLiveUploads()) endLiveUpload(u.id)
})

describe('live-uploads', () => {
  it('begin ajoute une entry visible dans le snapshot', () => {
    expect(snapshotLiveUploads()).toHaveLength(0)
    beginLiveUpload({ id: 'a', kind: 'video', previewUrl: null, takenAt: 1 })
    expect(snapshotLiveUploads()).toHaveLength(1)
    expect(snapshotLiveUploads()[0].id).toBe('a')
  })

  it('begin est idempotent sur le même id', () => {
    beginLiveUpload({ id: 'a', kind: 'video', previewUrl: null, takenAt: 1 })
    beginLiveUpload({ id: 'a', kind: 'video', previewUrl: null, takenAt: 2 })
    expect(snapshotLiveUploads()).toHaveLength(1)
    expect(snapshotLiveUploads()[0].takenAt).toBe(2)
  })

  it('end retire l’entry', () => {
    beginLiveUpload({ id: 'a', kind: 'video', previewUrl: null, takenAt: 1 })
    endLiveUpload('a')
    expect(snapshotLiveUploads()).toHaveLength(0)
  })

  it('notifie les abonnés sur begin et end', () => {
    let calls = 0
    const unsub = subscribeLiveUploads(() => { calls++ })
    beginLiveUpload({ id: 'a', kind: 'video', previewUrl: null, takenAt: 1 })
    endLiveUpload('a')
    expect(calls).toBe(2)
    // end sur un id absent ne notifie pas.
    endLiveUpload('a')
    expect(calls).toBe(2)
    unsub()
    beginLiveUpload({ id: 'b', kind: 'video', previewUrl: null, takenAt: 1 })
    expect(calls).toBe(2) // désabonné
  })
})
