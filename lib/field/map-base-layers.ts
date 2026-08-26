// Fonds de carte — abstraction pure, pas de clé en dur, jamais de disponibilité
// simulée (lot Terrain, mandat Vincent 2026-08-26).
//
// Gate fournisseur Satellite (obligatoire avant tout code, mandat Vincent) :
// - Esri World Imagery : HARD STOPPÉ — CGU consultées (developers.arcgis.com,
//   page « Uses Permitted ») sans confirmation explicite d'un usage tiers hors
//   ArcGIS Online/Enterprise ; ambiguïté juridique/commerciale → écarté.
// - Mapbox Satellite : retenu — intégration Leaflet officiellement documentée
//   (docs.mapbox.com/help/dive-deeper/mapbox-in-leaflet), attribution requise
//   claire (« © Mapbox © Maxar »), maxZoom 22, 50 000 chargements gratuits/mois.
//   Nécessite un jeton public (MAPBOX_TOKEN, lu côté serveur puis transmis en
//   prop au composant client — pas de préfixe NEXT_PUBLIC_ requis) que Vincent
//   doit obtenir lui-même — sans jeton configuré, Satellite reste absent,
//   jamais affiché comme disponible.

export type MapBaseLayerId = 'plan' | 'satellite'

export interface MapBaseLayerConfig {
  id: MapBaseLayerId
  label: string
  tileUrl: string
  attribution: string
  maxZoom: number
}

export const PLAN_BASE_LAYER: MapBaseLayerConfig = {
  id: 'plan',
  label: 'Plan',
  tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap',
  maxZoom: 19,
}

function satelliteBaseLayer(token: string): MapBaseLayerConfig {
  return {
    id: 'satellite',
    label: 'Satellite',
    tileUrl: `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${token}`,
    attribution: '© Mapbox © Maxar',
    maxZoom: 22,
  }
}

/** Un jeton vide/absent = Satellite indisponible, jamais un faux positif. */
export function isSatelliteAvailable(token: string | undefined | null): boolean {
  return !!token && token.trim().length > 0
}

/** Résout l'identifiant choisi vers sa config réelle ; retombe sur Plan si Satellite
 *  demandé sans jeton — jamais une tuile Mapbox appelée sans access_token valide. */
export function resolveBaseLayer(id: MapBaseLayerId, token: string | undefined | null): MapBaseLayerConfig {
  if (id === 'satellite' && isSatelliteAvailable(token)) return satelliteBaseLayer(token as string)
  return PLAN_BASE_LAYER
}
