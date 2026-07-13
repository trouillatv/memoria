// « Partager → MemorIA » — ce qui doit être vrai pour que ça marche du tout.
//
// Deux choses se cassent en silence sur ce chemin :
//   1. le MANIFESTE — sans `share_target` correctement formé, MemorIA
//      n'apparaît même pas dans le menu Partager d'Android. Rien ne plante :
//      l'app est simplement absente. C'est le pire des échecs.
//   2. le TRI des fichiers — un partage refusé sans motif laisserait Guillaume
//      croire ses photos arrivées.

import { describe, it, expect } from 'vitest'
import manifest from '@/app/manifest'
import {
  acceptShared,
  isShareable,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from '@/lib/share/share-rules'

interface ShareTargetShape {
  action: string
  method: string
  enctype: string
  params: { files: Array<{ name: string; accept: string[] }> }
}

describe('Le manifeste — sans lui, MemorIA n’apparaît pas dans « Partager »', () => {
  const m = manifest() as unknown as { share_target?: ShareTargetShape; start_url: string }

  it('déclare une cible de partage', () => {
    expect(m.share_target).toBeDefined()
  })

  it('POST + multipart : les FICHIERS ne passent pas autrement', () => {
    // Un share_target en GET ne transporte que du texte. Les photos exigent
    // POST + multipart/form-data. Se tromper ici = partage silencieusement vide.
    expect(m.share_target?.method).toBe('POST')
    expect(m.share_target?.enctype).toBe('multipart/form-data')
  })

  it('le champ de fichiers s’appelle « files » — le handler lit ce nom-là', () => {
    const files = m.share_target?.params.files
    expect(files).toHaveLength(1)
    expect(files?.[0].name).toBe('files')
    expect(files?.[0].accept).toContain('image/*')
  })

  it('l’action pointe sur la porte réelle', () => {
    expect(m.share_target?.action).toBe('/api/partage')
  })
})

describe('La porte — ce qui entre, ce qui est refusé (et pourquoi)', () => {
  const photo = (size = 200_000) => ({ size, type: 'image/jpeg' })

  it('laisse passer les photos, dans l’ORDRE reçu', () => {
    // L'ordre de WhatsApp est souvent l'ordre chronologique de la visite : le
    // moteur d'ingestion s'en sert pour reconstituer la journée.
    const v = acceptShared([
      { size: 1, type: 'image/jpeg' },
      { size: 2, type: 'image/png' },
      { size: 3, type: 'application/pdf' },
    ])
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.files.map((f) => f.size)).toEqual([1, 2, 3])
  })

  it('un partage vide le DIT', () => {
    expect(acceptShared([])).toEqual({ ok: false, reason: 'vide' })
    expect(acceptShared([{ size: 0, type: 'image/jpeg' }])).toEqual({ ok: false, reason: 'vide' })
  })

  it('trop lourd → motif « trop-lourd », jamais un échec muet', () => {
    const v = acceptShared([{ size: MAX_TOTAL_BYTES + 1, type: 'image/jpeg' }])
    expect(v).toEqual({ ok: false, reason: 'trop-lourd' })
  })

  it('une vidéo est refusée avec un motif — elle a ses propres chemins', () => {
    expect(isShareable('video/mp4')).toBe(false)
    expect(acceptShared([{ size: 10, type: 'video/mp4' }])).toEqual({ ok: false, reason: 'type' })
  })

  it('un lot mixte garde ce qui est partageable', () => {
    const v = acceptShared([
      { size: 10, type: 'video/mp4' },
      { size: 20, type: 'image/jpeg' },
    ])
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.files).toEqual([{ size: 20, type: 'image/jpeg' }])
  })

  it('au-delà de 30 fichiers, on garde les 30 premiers', () => {
    const v = acceptShared(Array.from({ length: 40 }, () => photo(1)))
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.files).toHaveLength(MAX_FILES)
  })

  it('la taille se juge sur ce qui est RÉELLEMENT gardé', () => {
    // 40 photos de 200 Ko = 8 Mo bruts, mais on n'en garde que 30 (6 Mo) →
    // toujours trop lourd. Le refus doit rester cohérent avec ce qu'on garde.
    const v = acceptShared(Array.from({ length: 40 }, () => photo()))
    expect(v).toEqual({ ok: false, reason: 'trop-lourd' })
  })
})
