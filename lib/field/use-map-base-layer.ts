'use client'

// Fond de carte partagé — UN SEUL point de vérité pour la préférence Plan/
// Satellite (localStorage memoria.map.baseLayer, lot Terrain 2026-08-26) et
// sa résolution vers la config Leaflet réelle (map-base-layers.ts). Toute
// surface carte (Terrain, CR, fiche Observation, Corriger l'emplacement)
// doit passer par ce hook plutôt que reconstruire sa propre lecture
// localStorage/résolution — sinon deux implémentations peuvent diverger sur
// l'URL de tuile, l'attribution ou le zoom max (Vincent, 2026-08-26).

import { useEffect, useState } from 'react'
import { PLAN_BASE_LAYER, resolveBaseLayer, isSatelliteAvailable, type MapBaseLayerId, type MapBaseLayerConfig } from './map-base-layers'

// Exportée (Lot Carte PDF Plan/Satellite, 2026-08-26) : CrMapLayerControl.tsx
// lit cette même clé pour proposer une valeur initiale au contrôle PDF quand
// le rapport n'a jamais reçu de choix explicite — jamais une seconde clé qui
// pourrait diverger.
export const BASE_LAYER_STORAGE_KEY = 'memoria.map.baseLayer'

export function useMapBaseLayer(mapboxToken: string | null): {
  baseLayer: MapBaseLayerConfig
  baseLayerId: MapBaseLayerId
  satelliteAvailable: boolean
  setBaseLayerId: (id: MapBaseLayerId) => void
} {
  const satelliteAvailable = isSatelliteAvailable(mapboxToken)
  const [baseLayerId, setBaseLayerIdState] = useState<MapBaseLayerId>('plan')

  useEffect(() => {
    const stored = window.localStorage.getItem(BASE_LAYER_STORAGE_KEY)
    if (stored === 'satellite' && satelliteAvailable) setBaseLayerIdState('satellite')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setBaseLayerId = (id: MapBaseLayerId) => {
    setBaseLayerIdState(id)
    window.localStorage.setItem(BASE_LAYER_STORAGE_KEY, id)
  }

  const baseLayer = satelliteAvailable ? resolveBaseLayer(baseLayerId, mapboxToken) : PLAN_BASE_LAYER
  return { baseLayer, baseLayerId, satelliteAvailable, setBaseLayerId }
}
