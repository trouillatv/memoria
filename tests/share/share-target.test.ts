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
  describeLot,
  describeLotFr,
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
    // Les VOCAUX aussi : c'est le second usage réel (« partage-moi la réunion »).
    expect(files?.[0].accept).toContain('audio/*')
    expect(files?.[0].accept).toContain('video/*')
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

  it('un vocal WhatsApp entre — il pèse quelques dizaines de Ko', () => {
    expect(isShareable('audio/ogg')).toBe(true)
    expect(isShareable('audio/mpeg')).toBe(true)
    const v = acceptShared([{ size: 40_000, type: 'audio/ogg' }])
    expect(v.ok).toBe(true)
  })

  it('une petite vidéo entre ; une grosse est refusée AVEC UN MOTIF', () => {
    expect(isShareable('video/mp4')).toBe(true)
    expect(acceptShared([{ size: 500_000, type: 'video/mp4' }]).ok).toBe(true)
    expect(acceptShared([{ size: 50_000_000, type: 'video/mp4' }])).toEqual({
      ok: false,
      reason: 'trop-lourd',
    })
  })

  it('un type inconnu est écarté, mais le reste du lot passe', () => {
    const v = acceptShared([
      { size: 10, type: 'application/x-zip' },
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


describe('Le lot se DIT en français — jamais « 5 fichiers »', () => {
  it('compte chaque nature', () => {
    const s = describeLot(['image/jpeg', 'image/png', 'audio/ogg', 'audio/ogg', 'video/mp4'])
    expect(s).toEqual({ photos: 2, audios: 2, videos: 1, documents: 0, total: 5 })
  })

  it('« 3 photos et 2 enregistrements »', () => {
    expect(describeLotFr(describeLot(['image/jpeg', 'image/jpeg', 'image/jpeg', 'audio/ogg', 'audio/ogg'])))
      .toBe('3 photos et 2 enregistrements')
  })

  it('un seul élément se dit au singulier', () => {
    expect(describeLotFr(describeLot(['audio/ogg']))).toBe('1 enregistrement')
  })

  it('trois natures s’énumèrent proprement', () => {
    expect(describeLotFr(describeLot(['image/jpeg', 'audio/ogg', 'application/pdf'])))
      .toBe('1 photo, 1 enregistrement et 1 document')
  })
})

// La destination n'est PLUS déduite du contenu : c'est l'utilisateur qui la
// choisit. Un vocal peut documenter une visite ; une photo peut illustrer une
// réunion. Aucune fonction ne doit plus deviner — d'où l'absence de test de
// « shareDestination » : la fonction elle-même a été SUPPRIMÉE.
