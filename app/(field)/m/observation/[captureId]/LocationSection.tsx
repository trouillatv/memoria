'use client'

// Localisation de la fiche d'observation (Lot 3) — carte réduite existante +
// action « Corriger l'emplacement » pour photo/vidéo uniquement (cf.
// isMappableVisualCapture). Vocal/note n'ont pas cette action : ils n'ont rien
// à recadrer visuellement, la position n'y est qu'un repère.

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { CaptureMap } from '@/components/CaptureMap'
import { LocationCorrectionMap } from '@/components/LocationCorrectionMap'
import { resolveEffectivePosition, isMappableVisualCapture, formatObservationLocationLine } from '@/lib/visits/geo'
import { correctCaptureLocationAction, revertCaptureLocationAction } from '@/app/(field)/m/site/[siteId]/capture-actions'

export function LocationSection({
  captureId,
  siteId,
  kind,
  lat,
  lng,
  correctedLat,
  correctedLng,
  gpsAccuracyM,
  altitudeM,
  createdAt,
  body,
  reportId,
}: {
  captureId: string
  siteId: string
  kind: string
  lat: number
  lng: number
  correctedLat: number | null
  correctedLng: number | null
  gpsAccuracyM: number | null
  /** Mesurée au moment de la capture — une correction lat/lng ne la change
   *  jamais (cf. formatObservationLocationLine). */
  altitudeM: number | null
  createdAt: string
  body: string | null
  reportId: string
}) {
  const router = useRouter()
  const [correcting, setCorrecting] = useState(false)
  const position = resolveEffectivePosition({ lat, lng, correctedLat, correctedLng })
  if (!position) return null

  const canCorrect = isMappableVisualCapture(kind)

  return (
    <section className="space-y-1.5">
      {!correcting && (
        <CaptureMap
          siteId={siteId}
          heightClass="h-52"
          linkPopups={false}
          captures={[{
            id: captureId,
            kind,
            lat: position.lat,
            lng: position.lng,
            created_at: createdAt,
            body,
            reportId,
            subjectName: null,
          }]}
        />
      )}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-xs text-muted-foreground">
          {formatObservationLocationLine(position.source, gpsAccuracyM, altitudeM)}
        </span>
        {canCorrect && (
          <button
            type="button"
            onClick={() => setCorrecting(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary active:opacity-70"
          >
            <Pencil className="h-3 w-3" /> Corriger l&apos;emplacement
          </button>
        )}
      </div>

      {correcting && (
        <LocationCorrectionMap
          lat={lat}
          lng={lng}
          correctedLat={correctedLat}
          correctedLng={correctedLng}
          gpsAccuracyM={gpsAccuracyM}
          onCancel={() => setCorrecting(false)}
          onValidate={async (nextLat, nextLng) => {
            const r = await correctCaptureLocationAction({ capture_id: captureId, lat: nextLat, lng: nextLng })
            if (r.ok) { setCorrecting(false); router.refresh() }
          }}
          onRevert={async () => {
            const r = await revertCaptureLocationAction({ capture_id: captureId })
            if (r.ok) { setCorrecting(false); router.refresh() }
          }}
        />
      )}
    </section>
  )
}
