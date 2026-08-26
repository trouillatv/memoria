'use client'

// Carte du CR en plein écran (Lot 3, sous-point Vincent 2026-08-26) : simple
// réutilisation de CaptureMap, STRICTEMENT scopée à la visite courante (mêmes
// `captures` que la petite carte, aucune agrégation multi-visite) — pas la
// future Mémoire spatiale du chantier.
//
// Déclencheur déplacé hors de la zone Leaflet (Vincent, 2026-08-26) : un bug
// de peinture/compositing Chromium residuel fait que le bouton flottant
// posé sur la carte n'est parfois pas peint au premier rendu (voir
// audit-lot3-cr-map-agrandir-paint-bug.md, GELÉ, non corrigé). Plutôt que de
// contourner ce bug, le déclencheur est sorti de la zone qui chevauche
// Leaflet : il vit dans la ligne de titre de la Section (CrMapExploreButton),
// et le contexte partagé (CrMapExpandProvider) relie ce bouton à la carte
// rendue plus bas dans le même arbre React.
//
// Bug distinct corrigé (Vincent, recette terrain 2026-08-26) : deux surfaces
// Leaflet visibles simultanément après « Agrandir » — deux jeux de contrôles
// zoom, deux attributions, la carte peinte deux fois verticalement. Cause
// racine : la petite carte (h-60) restait montée SANS CONDITION pendant que
// l'overlay plein écran montait sa propre <CaptureMap>, donnant deux
// instances Leaflet vivantes en même temps — l'overlay `fixed inset-0` ne
// suffit pas à lui seul à garantir qu'une seule est visible (le fond restait
// scrollable, un défaut connu de dérive de position:fixed sur mobile quand
// la page sous l'overlay peut encore défiler). Invariant rétabli : jamais
// plus d'une <CaptureMap> montée à la fois (rendu mutuellement exclusif) +
// verrou de scroll du fond pendant l'overlay, en défense en profondeur.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, X } from 'lucide-react'
import { CaptureMap, type MapCapture } from '@/components/CaptureMap'
import { CaptureClusterGallery } from '@/components/CaptureClusterGallery'
import { MapBaseLayerToggle } from '@/components/MapBaseLayerToggle'
import { useMapBaseLayer } from '@/lib/field/use-map-base-layer'

const CrMapExpandContext = createContext<{ expanded: boolean; setExpanded: (v: boolean) => void } | null>(null)

export function CrMapExpandProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <CrMapExpandContext.Provider value={{ expanded, setExpanded }}>
      {children}
    </CrMapExpandContext.Provider>
  )
}

export function CrMapExploreButton() {
  const ctx = useContext(CrMapExpandContext)
  if (!ctx) return null
  return (
    <button
      type="button"
      onClick={() => ctx.setExpanded(true)}
      aria-label="Explorer la carte en plein écran"
      className="shrink-0 rounded-full p-1.5 text-muted-foreground active:opacity-70 hover:bg-muted"
    >
      <ArrowUpRight className="h-4 w-4" />
    </button>
  )
}

export function CrMapExpandable({ siteId, captures, mapboxToken }: {
  siteId: string
  captures: MapCapture[]
  /** Résolu côté serveur (page CR) depuis MAPBOX_TOKEN — même contrat que
   *  TerrainMap, cf. use-map-base-layer.ts. */
  mapboxToken: string | null
}) {
  const ctx = useContext(CrMapExpandContext)
  const expanded = ctx?.expanded ?? false
  const setExpanded = ctx?.setExpanded ?? (() => {})
  const { baseLayer, baseLayerId, satelliteAvailable, setBaseLayerId } = useMapBaseLayer(mapboxToken)

  // Lot correctif Observation (Vincent, 2026-08-26) : le cluster n'ouvre plus
  // le popup Leaflet volumineux (débordement à 11+ preuves) — même galerie
  // plein écran que Terrain, aucune variante dédiée.
  const [galleryCaptures, setGalleryCaptures] = useState<MapCapture[] | null>(null)
  const openCluster = useCallback((cs: MapCapture[]) => setGalleryCaptures(cs), [])

  useEffect(() => {
    if (!expanded) return
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [expanded])

  return (
    <>
      {!expanded && (
        <CaptureMap siteId={siteId} captures={captures} heightClass="h-60" linkContext="cr" baseLayer={baseLayer} onOpenCluster={openCluster} />
      )}

      {expanded && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black">
          <div className="flex items-center justify-between px-3 py-2 text-white">
            <button type="button" onClick={() => setExpanded(false)} aria-label="Fermer" className="rounded-full bg-white/10 p-2">
              <X className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium">Localisation des observations</span>
            {satelliteAvailable ? (
              <MapBaseLayerToggle baseLayerId={baseLayerId} onChange={setBaseLayerId} variant="overlay" />
            ) : (
              <span className="w-9" aria-hidden />
            )}
          </div>
          <div className="flex-1 overflow-hidden p-2 safe-bottom">
            <CaptureMap siteId={siteId} captures={captures} heightClass="h-full" linkContext="cr" baseLayer={baseLayer} onOpenCluster={openCluster} />
          </div>
        </div>
      )}

      {galleryCaptures && (
        <CaptureClusterGallery captures={galleryCaptures} onClose={() => setGalleryCaptures(null)} linkContext="cr" />
      )}
    </>
  )
}
