// @vitest-environment node
/**
 * P3-B — fautes de transcription documentées dans le vocabulaire fermé.
 *
 * Ce fichier protège l'ALIAS lui-même : `transcript-normalizer.test.ts` prouve
 * que le normaliseur sait s'en servir, mais rien n'empêcherait l'entrée de
 * disparaître de la source de vocabulaire. Ici, c'est son existence qui est
 * verrouillée, pas le moteur.
 */
import { describe, it, expect } from 'vitest'
import { knownFormsFor } from '@/lib/ai/stt-vocabulary'

describe('knownFormsFor', () => {
  it('« Clim Expert » est une forme fausse connue de « Clim Expair »', () => {
    expect(knownFormsFor('Clim Expair')).toContain('Clim Expert')
  })

  it('reconnaît le terme quelle que soit sa casse, sa ponctuation ou ses accents', () => {
    expect(knownFormsFor('CLIM EXPAIR')).toContain('Clim Expert')
    expect(knownFormsFor('clim-expair')).toContain('Clim Expert')
  })

  it('ne rend rien pour un terme sans faute documentée', () => {
    expect(knownFormsFor('CEGELEC')).toEqual([])
    expect(knownFormsFor('Vincent Milon')).toEqual([])
  })

  it('ne documente jamais une forme fausse à la place de la canonique', () => {
    // Garde-fou de sens : si un jour quelqu'un inverse une entrée, la forme
    // fausse deviendrait la vérité écrite. « Clim Expert » n'a pas d'alias.
    expect(knownFormsFor('Clim Expert')).toEqual([])
  })
})
