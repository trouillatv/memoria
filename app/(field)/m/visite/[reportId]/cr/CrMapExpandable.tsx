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

import { createContext, useCallback, useContext, useEffect, useState, useTransition, type ReactNode } from 'react'
import { ArrowUpRight, Loader2, AlertTriangle, X } from 'lucide-react'
import { CaptureMap, type MapCapture } from '@/components/CaptureMap'
import { CaptureClusterGallery } from '@/components/CaptureClusterGallery'
import { MapBaseLayerToggle } from '@/components/MapBaseLayerToggle'
import { useMapBaseLayer } from '@/lib/field/use-map-base-layer'
import type { MapBaseLayerId } from '@/lib/field/map-base-layers'
import type { CrMapBaseLayerStatus } from '@/lib/pdf/cr-map-snapshot'
import { setCrMapBaseLayerAction } from './map-snapshot-actions'

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

export function CrMapExpandable({ siteId, captures, mapboxToken, reportId, initialStatus }: {
  siteId: string
  captures: MapCapture[]
  /** Résolu côté serveur (page CR) depuis MAPBOX_TOKEN — même contrat que
   *  TerrainMap, cf. use-map-base-layer.ts. */
  mapboxToken: string | null
  /** Persistance du fond choisi pour ce rapport (PDF) — même geste que celui
   *  qui pilote la carte affichée (correctif Observation, 2026-08-26) :
   *  Vincent avait deux contrôles Plan/Satellite déconnectés, l'un ne
   *  changeait jamais la carte visible. UN SEUL contrôle fait les deux. */
  reportId: string
  initialStatus: CrMapBaseLayerStatus
}) {
  const ctx = useContext(CrMapExpandContext)
  const expanded = ctx?.expanded ?? false
  const setExpanded = ctx?.setExpanded ?? (() => {})
  const { baseLayer, baseLayerId, satelliteAvailable, setBaseLayerId, setBaseLayerIdLocal } = useMapBaseLayer(mapboxToken)

  // Persistance PDF (site_reports.cr_map_base_layer) — état séparé de la
  // carte affichée (pilotée par baseLayerId ci-dessus), mais déclenché par le
  // MÊME tap : cf. handleLayerChange.
  const [status, setStatus] = useState(initialStatus)
  const [pending, startTransition] = useTransition()
  const stale = status.explicit && status.snapshotLayer != null && status.snapshotLayer !== status.chosen
  const staleLabel = stale
    ? `${status.chosen === 'satellite' ? 'Satellite' : 'Plan'} demandé — carte du rapport non mise à jour`
    : null

  // Doctrine fond CR (Vincent, 2026-08-27) : `memoria.map.baseLayer` (hint
  // localStorage partagé) est la préférence interactive COURANTE de
  // l'utilisateur, pas la préférence du rapport. `cr_map_base_layer` est le
  // choix FIGÉ propre à ce rapport, qui ne doit plus jamais varier avec la
  // préférence globale une fois posé (visite en Satellite hier, passage en
  // Plan aujourd'hui sur un autre chantier → le CR d'hier reste Satellite).
  //
  // - Rapport déjà explicite (`initialStatus.explicit`) : la carte affichée
  //   suit STRICTEMENT ce choix figé, jamais le hint ambiant —
  //   `setBaseLayerIdLocal` (état local seul, n'écrit jamais localStorage)
  //   pour ne pas écraser la préférence d'appareil réelle posée ailleurs
  //   (ex. Terrain) avec la valeur figée de CE rapport.
  // - Rapport jamais réglé : on fige UNE SEULE FOIS, à cette première
  //   ouverture, la préférence interactive courante — la carte l'affiche déjà
  //   nativement (effet interne de useMapBaseLayer lit ce même hint), il ne
  //   reste qu'à la persister en base et déclencher l'instantané PDF
  //   correspondant, pour que la carte visible et le PDF ne divergent jamais.
  //   Cette branche ne s'exécute plus au prochain montage : une fois figé,
  //   `explicit` devient vrai côté serveur.
  //
  // Toujours Plan au premier figeage (Vincent, 2026-08-27) : la préférence
  // ambiante `memoria.map.baseLayer` reflète l'écran précédent (souvent
  // Terrain) et n'a aucun rapport avec CE rapport — l'hériter faisait
  // atterrir certains CR en Satellite sans que personne ne l'ait choisi pour
  // eux, hors du contrôle exposé (MapBaseLayerToggle) sur cette page.
  // `setBaseLayerIdLocal('plan')` écrase ici l'effet propre de
  // `useMapBaseLayer` (qui lit ce même hint ambiant à son propre montage) :
  // sans cet appel, la carte affichée aurait pu partir en Satellite pendant
  // que le PDF se figeait en Plan, provoquant l'état « périmé » dès l'ouverture.
  useEffect(() => {
    if (initialStatus.explicit) {
      setBaseLayerIdLocal(initialStatus.chosen)
      return
    }
    setBaseLayerIdLocal('plan')
    startTransition(async () => {
      const next = await setCrMapBaseLayerAction(reportId, 'plan')
      setStatus(next)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLayerChange = (layer: MapBaseLayerId) => {
    setBaseLayerId(layer)
    startTransition(async () => {
      const next = await setCrMapBaseLayerAction(reportId, layer)
      setStatus(next)
    })
  }

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
        <>
          {(satelliteAvailable || status.chosen === 'satellite') && (
            <div className="mb-2 flex flex-col items-end gap-1 px-3 pt-3">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">Carte du rapport</span>
                <div className="flex items-center gap-1.5">
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Génération de l’instantané" />}
                  {!pending && stale && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />}
                  {satelliteAvailable ? (
                    <MapBaseLayerToggle baseLayerId={baseLayerId} onChange={handleLayerChange} variant="card" />
                  ) : (
                    <span className="text-[12px] text-muted-foreground">Satellite indisponible — carte en Plan</span>
                  )}
                </div>
              </div>
              {!pending && staleLabel && (
                <span className="text-[11px] font-medium text-amber-600">{staleLabel}</span>
              )}
            </div>
          )}
          <CaptureMap siteId={siteId} captures={captures} heightClass="h-60" linkContext="cr" baseLayer={baseLayer} onOpenCluster={openCluster} />
        </>
      )}

      {expanded && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-black">
          <div className="flex items-center justify-between px-3 py-2 text-white">
            <button type="button" onClick={() => setExpanded(false)} aria-label="Fermer" className="rounded-full bg-white/10 p-2">
              <X className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium">Localisation des observations</span>
            {satelliteAvailable ? (
              <MapBaseLayerToggle baseLayerId={baseLayerId} onChange={handleLayerChange} variant="overlay" />
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
