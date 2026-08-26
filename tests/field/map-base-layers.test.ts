// Fonds de carte — primitive pure (lot Terrain, mandat Vincent 2026-08-26).
// Couvre la doctrine : un jeton absent/vide n'est JAMAIS un faux positif de
// disponibilité, et Satellite demandé sans jeton retombe sur Plan sans jamais
// appeler une tuile Mapbox sans access_token valide.

import { describe, it, expect } from 'vitest'
import { isSatelliteAvailable, resolveBaseLayer, PLAN_BASE_LAYER } from '@/lib/field/map-base-layers'

describe('isSatelliteAvailable', () => {
  it('false si le jeton est absent', () => {
    expect(isSatelliteAvailable(undefined)).toBe(false)
  })

  it('false si le jeton est null', () => {
    expect(isSatelliteAvailable(null)).toBe(false)
  })

  it('false si le jeton est une chaîne vide ou blanche', () => {
    expect(isSatelliteAvailable('')).toBe(false)
    expect(isSatelliteAvailable('   ')).toBe(false)
  })

  it('true si un jeton non vide est fourni', () => {
    expect(isSatelliteAvailable('pk.test-token')).toBe(true)
  })
})

describe('resolveBaseLayer', () => {
  it('retombe sur Plan si Satellite est demandé sans jeton', () => {
    expect(resolveBaseLayer('satellite', undefined)).toEqual(PLAN_BASE_LAYER)
  })

  it('retourne Plan tel quel si Plan est demandé', () => {
    expect(resolveBaseLayer('plan', 'pk.test-token')).toEqual(PLAN_BASE_LAYER)
  })

  it('retourne une config Mapbox avec le jeton inclus dans l’URL si Satellite est demandé avec un jeton', () => {
    const layer = resolveBaseLayer('satellite', 'pk.test-token')
    expect(layer.id).toBe('satellite')
    expect(layer.tileUrl).toContain('access_token=pk.test-token')
    expect(layer.attribution).toMatch(/Mapbox/)
    expect(layer.maxZoom).toBe(22)
  })
})
