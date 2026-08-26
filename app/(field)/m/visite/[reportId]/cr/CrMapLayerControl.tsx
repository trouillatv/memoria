'use client'

// Contrôle DISCRET « Carte du rapport : Plan | Satellite » (Vincent, Lot Carte
// PDF Plan/Satellite, 2026-08-26). État SÉPARÉ de la préférence interactive
// memoria.map.baseLayer : ce composant persiste le choix propre à CE rapport
// (site_reports.cr_map_base_layer) — la préférence interactive ne sert QUE de
// valeur initiale PROPOSÉE côté client, et seulement tant qu'aucun choix
// explicite n'existe encore pour ce rapport (jamais écrite en base sans tap).

import { useEffect, useState, useTransition } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { MapBaseLayerToggle } from '@/components/MapBaseLayerToggle'
import { BASE_LAYER_STORAGE_KEY } from '@/lib/field/use-map-base-layer'
import type { MapBaseLayerId } from '@/lib/field/map-base-layers'
import type { CrMapBaseLayerStatus } from '@/lib/pdf/cr-map-snapshot'
import { setCrMapBaseLayerAction } from './map-snapshot-actions'

export function CrMapLayerControl({ reportId, initialStatus }: {
  reportId: string
  initialStatus: CrMapBaseLayerStatus
}) {
  const [status, setStatus] = useState(initialStatus)
  const [displayLayer, setDisplayLayer] = useState<MapBaseLayerId>(initialStatus.chosen)
  const [pending, startTransition] = useTransition()

  // Hint client uniquement — jamais écrit en base tant que l'utilisateur n'a
  // pas tapé. Ne s'applique que si ce rapport n'a jamais reçu de choix
  // explicite (sinon le choix du rapport prime toujours).
  useEffect(() => {
    if (initialStatus.explicit) return
    const stored = window.localStorage.getItem(BASE_LAYER_STORAGE_KEY)
    if (stored === 'satellite' && initialStatus.satelliteAvailable) setDisplayLayer('satellite')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Périmé au sens strict : un choix EXPLICITE existe et diverge du fond avec
  // lequel le dernier PNG stocké a réellement été produit (régénération en
  // cours ou échouée) — jamais dérivé du simple hint d'affichage non persisté,
  // qui produirait un faux positif au premier rendu.
  const stale = status.explicit && status.snapshotLayer != null && status.snapshotLayer !== status.chosen
  const showToggle = status.satelliteAvailable
  const showUnavailableNotice = !status.satelliteAvailable && status.chosen === 'satellite'
  if (!showToggle && !showUnavailableNotice) return null

  const handleChange = (layer: MapBaseLayerId) => {
    if (layer === displayLayer && status.explicit) return
    setDisplayLayer(layer)
    startTransition(async () => {
      const next = await setCrMapBaseLayerAction(reportId, layer)
      setStatus(next)
      setDisplayLayer(next.chosen)
    })
  }

  // Message VISIBLE (pas seulement aria-label) : Vincent a explicitement
  // rejeté une substitution silencieuse — si le fond demandé n'a pas encore
  // d'instantané à jour, ça doit se lire à l'écran, pas seulement au lecteur
  // d'écran (Vincent, correction doctrine snapshot, 2026-08-26).
  const staleLabel = stale
    ? `${status.chosen === 'satellite' ? 'Satellite' : 'Plan'} demandé — carte du rapport non mise à jour`
    : null

  return (
    <div className="mb-2 flex flex-col items-end gap-1">
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-muted-foreground">Carte du rapport</span>
        <div className="flex items-center gap-1.5">
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Génération de l’instantané" />}
          {!pending && stale && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />}
          {showToggle ? (
            <MapBaseLayerToggle baseLayerId={displayLayer} onChange={handleChange} variant="card" />
          ) : (
            <span className="text-[12px] text-muted-foreground">Satellite indisponible — carte en Plan</span>
          )}
        </div>
      </div>
      {!pending && staleLabel && (
        <span className="text-[11px] font-medium text-amber-600">{staleLabel}</span>
      )}
    </div>
  )
}
