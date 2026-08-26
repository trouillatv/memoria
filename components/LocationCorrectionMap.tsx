'use client'

// Correction manuelle de position d'une preuve (Lot 3, mig 351). Surface DÉDIÉE
// à UNE capture : jamais la mémoire spatiale du chantier (cf. doctrine trois
// usages distincts de la carte, Vincent 2026-08-26). Repère GPS d'origine fixe
// + cercle d'incertitude si `gpsAccuracyM` existe, marqueur EFFECTIF déplaçable
// (glisser ne sauvegarde rien : « Valider cet emplacement » commit explicite).
// « GPS capturé = mesure originale immuable. Correction humaine = position
// effective distincte. » — lat/lng ne sont jamais réécrites depuis ce composant.
//
// Redirection UX (Vincent, 2026-08-26) : UNE seule carte, jamais deux superposées
// — le GPS d'origine reste une référence secondaire discrète (petit encart en
// coin d'écran, visible seulement une fois qu'il y a quelque chose à comparer),
// jamais un second repère flottant qui concurrence visuellement le marqueur
// bleu déplaçable. Feedback « Déplacé de N m » calculé en direct par
// distanceMeters (purement géométrique, jamais d'IA) ; au-delà de
// LARGE_CORRECTION_MOVE_M, avertissement discret et NON bloquant — la
// validation reste toujours possible.

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import type { Map as LeafletMap, Marker } from 'leaflet'
import { X, Check, Loader2, RotateCcw, AlertTriangle } from 'lucide-react'
import { formatGpsAccuracyCaption, formatCompactGpsAccuracy, distanceMeters, LARGE_CORRECTION_MOVE_M } from '@/lib/visits/geo'

export function LocationCorrectionMap({
  lat,
  lng,
  correctedLat,
  correctedLng,
  gpsAccuracyM,
  onCancel,
  onValidate,
  onRevert,
}: {
  /** Mesure GPS brute d'origine — jamais modifiée par ce composant. */
  lat: number
  lng: number
  correctedLat: number | null
  correctedLng: number | null
  gpsAccuracyM: number | null
  onCancel: () => void
  onValidate: (lat: number, lng: number) => Promise<void>
  onRevert: () => Promise<void>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const draggableRef = useRef<Marker | null>(null)
  const hasExistingCorrection = correctedLat != null && correctedLng != null
  const [draft, setDraft] = useState<{ lat: number; lng: number }>({
    lat: correctedLat ?? lat,
    lng: correctedLng ?? lng,
  })
  const [saving, setSaving] = useState<'validate' | 'revert' | null>(null)
  const moved = draft.lat !== lat || draft.lng !== lng
  // Feedback géométrique EN DIRECT, pur (haversine) — jamais d'IA, jamais bloquant
  // (Vincent, redirection UX 2026-08-26) : « Déplacé de 42 m par rapport au GPS ».
  const movedDistanceM = moved ? distanceMeters(lat, lng, draft.lat, draft.lng) : 0
  const largeMove = moved && movedDistanceM > LARGE_CORRECTION_MOVE_M

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((mod) => {
      const L = mod.default
      if (cancelled || !ref.current || mapRef.current) return
      const map = L.map(ref.current, { zoomControl: true })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)

      // Repère GPS d'origine — fixe, jamais déplaçable : la mesure brute reste visible
      // pour comparer, même une fois une correction posée.
      L.circleMarker([lat, lng], { radius: 6, color: '#64748b', fillColor: '#94a3b8', fillOpacity: 0.9, weight: 2 })
        .bindTooltip('Position GPS d’origine', { direction: 'top', opacity: 0.9 })
        .addTo(map)

      if (gpsAccuracyM != null) {
        L.circle([lat, lng], { radius: gpsAccuracyM, color: '#64748b', weight: 1, fillColor: '#64748b', fillOpacity: 0.08, dashArray: '4' }).addTo(map)
      }

      const icon = L.divIcon({
        className: '',
        html: '<div style="width:28px;height:28px;border-radius:14px 14px 14px 0;transform:rotate(45deg);background:#0284c7;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      })
      const marker = L.marker([draft.lat, draft.lng], { icon, draggable: true })
      marker.addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        setDraft({ lat: p.lat, lng: p.lng })
      })
      draggableRef.current = marker

      const bounds = L.latLngBounds([[lat, lng], [draft.lat, draft.lng]])
      if (lat === draft.lat && lng === draft.lng) map.setView([lat, lng], 18)
      else map.fitBounds(bounds.pad(0.6), { maxZoom: 19 })
    })
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; draggableRef.current = null }
    // Un seul montage : le marqueur se déplace ensuite via Leaflet directement
    // (dragend), jamais en reconstruisant la carte à chaque changement de `draft`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetDraftToGps = () => {
    setDraft({ lat, lng })
    draggableRef.current?.setLatLng([lat, lng])
    mapRef.current?.setView([lat, lng], 18)
  }

  const handleValidate = async () => {
    setSaving('validate')
    try {
      await onValidate(draft.lat, draft.lng)
    } finally {
      setSaving(null)
    }
  }

  const handleRevert = async () => {
    setSaving('revert')
    try {
      await onRevert()
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black">
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <button type="button" onClick={onCancel} aria-label="Annuler" className="rounded-full bg-white/10 p-2"><X className="h-5 w-5" /></button>
        <span className="text-sm font-medium">Corriger l&apos;emplacement</span>
        <span className="w-9" aria-hidden />
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div ref={ref} className="h-full w-full" />

        {/* Encart discret, coin de l'écran — le GPS d'origine reste une référence
            secondaire, jamais un second repère flottant au centre qui concurrence
            le marqueur bleu (Vincent, redirection UX 2026-08-26). N'apparaît que
            s'il y a quelque chose à comparer/annuler. */}
        {moved && (
          <div className="absolute right-2.5 top-2.5 z-[1000] max-w-[180px] rounded-lg bg-black/70 px-2.5 py-2 text-white backdrop-blur">
            <p className="flex items-center gap-1 text-[11px] font-medium">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-white/70 bg-slate-400" aria-hidden />
              Position GPS d&apos;origine
            </p>
            {formatCompactGpsAccuracy(gpsAccuracyM) && (
              <p className="mt-0.5 text-[11px] text-white/70">{formatCompactGpsAccuracy(gpsAccuracyM)}</p>
            )}
            <button
              type="button"
              onClick={hasExistingCorrection ? handleRevert : resetDraftToGps}
              disabled={saving !== null}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 disabled:opacity-50"
            >
              {saving === 'revert' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Revenir ici
            </button>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-white/10 p-3 safe-bottom">
        {!moved ? (
          <p className="text-center text-[11px] text-white/70">
            {formatGpsAccuracyCaption(gpsAccuracyM)
              ? `${formatGpsAccuracyCaption(gpsAccuracyM)} — glissez le repère bleu, puis validez.`
              : 'Glissez le repère bleu jusqu’au bon emplacement, puis validez.'}
          </p>
        ) : (
          <div className="text-center">
            <p className="text-[11px] text-white/70">Déplacé de {Math.round(movedDistanceM)} m par rapport au GPS</p>
            {largeMove && (
              <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-amber-300">
                <AlertTriangle className="h-3 w-3" /> Déplacement important par rapport à la mesure GPS
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={handleValidate}
          disabled={saving !== null}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving === 'validate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Valider cet emplacement
        </button>
      </div>
    </div>
  )
}
