'use client'

// Carte Terrain — mémoire géographique brute du chantier (lot Terrain, mandat
// Vincent 2026-08-26) : TOUTES les preuves géolocalisées, toutes visites
// confondues, plein écran. Réutilise CaptureMap/resolveEffectivePosition/
// clusterMarkersByPixel — aucun second moteur cartographique, aucun second
// calcul de position.
//
// Filtres volontairement minimaux (doctrine Vincent : « ne construis pas un
// panneau de filtres pour anticiper des besoins que nous n'avons pas encore
// rencontrés ») : une visite ou toutes, photos et/ou vidéos. La période et les
// objets métier spatialisés sont explicitement hors périmètre V1.

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { CaptureMap, type MapCapture } from '@/components/CaptureMap'
import { CaptureClusterGallery } from '@/components/CaptureClusterGallery'
import { MapBaseLayerToggle } from '@/components/MapBaseLayerToggle'
import { useMapBaseLayer } from '@/lib/field/use-map-base-layer'

export interface TerrainVisitOption {
  id: string
  label: string
}

export function TerrainMap({ siteId, captures, visits, mapboxToken }: {
  siteId: string
  captures: MapCapture[]
  visits: TerrainVisitOption[]
  /** Résolu côté serveur (page Terrain) depuis MAPBOX_TOKEN — jamais un accès
   *  process.env direct ici : ce composant est client, et le jeton n'a pas
   *  besoin du préfixe NEXT_PUBLIC_ pour atteindre le navigateur, il transite
   *  par cette prop. */
  mapboxToken: string | null
}) {
  const router = useRouter()
  const { baseLayer, baseLayerId, satelliteAvailable, setBaseLayerId } = useMapBaseLayer(mapboxToken)

  const [selectedVisitId, setSelectedVisitId] = useState<string>('all')
  const [showPhotos, setShowPhotos] = useState(true)
  const [showVideos, setShowVideos] = useState(true)
  // Lot correctif Terrain (Vincent, 2026-08-26) : plus de popup Leaflet — un
  // marqueur seul navigue direct, un cluster ouvre cette galerie plein écran.
  // useCallback : CaptureMap réinitialise sa carte (perd zoom/position) si ces
  // callbacks changent d'identité à chaque rendu — cf. useEffect deps.
  const [galleryCaptures, setGalleryCaptures] = useState<MapCapture[] | null>(null)
  const openSingle = useCallback((c: MapCapture) => router.push(`/m/observation/${c.id}?from=terrain`), [router])
  const openCluster = useCallback((cs: MapCapture[]) => setGalleryCaptures(cs), [])

  const filtered = useMemo(() => captures.filter((c) => {
    if (selectedVisitId !== 'all' && c.reportId !== selectedVisitId) return false
    if (c.kind === 'photo' && !showPhotos) return false
    if (c.kind === 'video' && !showVideos) return false
    return true
  }), [captures, selectedVisitId, showPhotos, showVideos])

  if (captures.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/30 px-6 text-center">
        <MapPin className="h-6 w-6 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">Aucune observation géolocalisée</p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] text-muted-foreground">
          Activez la localisation des observations pendant vos visites pour voir le chantier se dessiner ici.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedVisitId}
          onChange={(e) => setSelectedVisitId(e.target.value)}
          className="rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground"
        >
          <option value="all">Toutes les visites</option>
          {visits.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setShowPhotos((v) => !v)}
            aria-pressed={showPhotos}
            className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${showPhotos ? 'bg-foreground text-background' : 'text-muted-foreground'}`}
          >
            Photos
          </button>
          <button
            type="button"
            onClick={() => setShowVideos((v) => !v)}
            aria-pressed={showVideos}
            className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${showVideos ? 'bg-foreground text-background' : 'text-muted-foreground'}`}
          >
            Vidéos
          </button>
        </div>

        {satelliteAvailable && (
          <MapBaseLayerToggle baseLayerId={baseLayerId} onChange={setBaseLayerId} variant="card" />
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <CaptureMap
          siteId={siteId}
          captures={filtered}
          heightClass="h-full"
          baseLayer={baseLayer}
          clusterByZoom
          onOpenSingle={openSingle}
          onOpenCluster={openCluster}
        />
        {filtered.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-full bg-background/90 px-3 py-1.5 text-[12px] font-medium text-muted-foreground shadow">
              Aucune preuve pour ce filtre
            </span>
          </div>
        )}
      </div>

      {galleryCaptures && (
        <CaptureClusterGallery captures={galleryCaptures} onClose={() => setGalleryCaptures(null)} linkContext="terrain" />
      )}
    </div>
  )
}
