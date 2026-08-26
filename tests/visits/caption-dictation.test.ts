// Fusion de légende dictée — jamais d'écrasement silencieux (test #6/#8).

import { describe, it, expect } from 'vitest'
import { mergeCaption } from '@/lib/visits/caption-dictation'

describe('mergeCaption', () => {
  it('légende vide + dictée → la dictée seule', () => {
    expect(mergeCaption(null, 'Fissure au plafond')).toBe('Fissure au plafond')
    expect(mergeCaption(undefined, 'Fissure au plafond')).toBe('Fissure au plafond')
    expect(mergeCaption('', 'Fissure au plafond')).toBe('Fissure au plafond')
  })

  it('légende existante + dictée → ajoutée à la suite, jamais remplacée (test #6)', () => {
    expect(mergeCaption('Fissure au plafond', 'chambre 2')).toBe('Fissure au plafond chambre 2')
  })

  it('transcription vide → la légende existante reste inchangée (test #8)', () => {
    expect(mergeCaption('Fissure au plafond', '')).toBe('Fissure au plafond')
    expect(mergeCaption('Fissure au plafond', '   ')).toBe('Fissure au plafond')
  })

  it('deux légendes vides → chaîne vide', () => {
    expect(mergeCaption(null, '')).toBe('')
    expect(mergeCaption('', '   ')).toBe('')
  })

  it('rogne les espaces superflus sans en ajouter entre les segments', () => {
    expect(mergeCaption('  Fissure  ', '  chambre 2  ')).toBe('Fissure chambre 2')
  })

  it('post-shutter puis triage sur la même légende — deux dictées s’enchaînent (test #2/#5)', () => {
    const afterPostShutter = mergeCaption(null, 'Fissure au plafond')
    const afterTriage = mergeCaption(afterPostShutter, 'chambre 2')
    expect(afterTriage).toBe('Fissure au plafond chambre 2')
  })
})
