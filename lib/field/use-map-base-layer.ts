'use client'

// Fond de carte partagé — UN SEUL point de vérité pour la préférence Plan/
// Satellite (localStorage memoria.map.baseLayer, lot Terrain 2026-08-26) et
// sa résolution vers la config Leaflet réelle (map-base-layers.ts). Toute
// surface carte (Terrain, CR, fiche Observation, Corriger l'emplacement)
// doit passer par ce hook plutôt que reconstruire sa propre lecture
// localStorage/résolution — sinon deux implémentations peuvent diverger sur
// l'URL de tuile, l'attribution ou le zoom max (Vincent, 2026-08-26).

import { useEffect, useMemo, useState } from 'react'
import { PLAN_BASE_LAYER, resolveBaseLayer, isSatelliteAvailable, type MapBaseLayerId, type MapBaseLayerConfig } from './map-base-layers'

// Exportée (Lot Carte PDF Plan/Satellite, 2026-08-26) : toute surface qui a
// besoin de connaître la préférence persistée (ex. CrMapExpandable.tsx pour
// le contrôle Plan/Satellite du CR) lit cette même clé — jamais une seconde
// clé qui pourrait diverger.
export const BASE_LAYER_STORAGE_KEY = 'memoria.map.baseLayer'

export function useMapBaseLayer(mapboxToken: string | null): {
  baseLayer: MapBaseLayerConfig
  baseLayerId: MapBaseLayerId
  satelliteAvailable: boolean
  setBaseLayerId: (id: MapBaseLayerId) => void
  setBaseLayerIdLocal: (id: MapBaseLayerId) => void
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

  // État local SEULEMENT — n'écrit jamais le hint localStorage partagé entre
  // surfaces. Réservé à la synchronisation d'une carte sur une préférence
  // propre à SON contexte (ex. CrMapExpandable synchronisé sur
  // cr_map_base_layer) : la version complète `setBaseLayerId` propagerait par
  // erreur ce choix contextuel comme préférence d'appareil, écrasant celle
  // que l'utilisateur a réellement posée ailleurs (ex. Terrain) — correctif
  // divergence carte CR/PDF, 2026-08-27.
  const setBaseLayerIdLocal = (id: MapBaseLayerId) => {
    setBaseLayerIdState(id)
  }

  // Mémoïsé : resolveBaseLayer() fabrique un nouvel objet à chaque appel côté
  // Satellite — sans ce useMemo, chaque re-rendu (même sans changement de
  // fond) recrée la référence, ce qui refait tourner l'effet de swap de
  // tuiles dans CaptureMap.tsx et interrompt le chargement des tuiles Mapbox
  // en cours (carte Satellite blanche, bug remonté par Vincent 2026-08-26).
  const baseLayer = useMemo(
    () => (satelliteAvailable ? resolveBaseLayer(baseLayerId, mapboxToken) : PLAN_BASE_LAYER),
    [satelliteAvailable, baseLayerId, mapboxToken],
  )
  return { baseLayer, baseLayerId, satelliteAvailable, setBaseLayerId, setBaseLayerIdLocal }
}
