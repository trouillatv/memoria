'use client'

// Caméra FANTÔME (mig 195) — « reprends exactement le même point de vue ».
// La photo précédente du point de repère s'affiche en surimpression translucide
// au-dessus du flux caméra : on se déplace jusqu'à ce que les deux images
// coïncident, on déclenche. Sans IA, sans calcul — juste l'œil du conducteur.
//
// Repli : si getUserMedia échoue (permission refusée, WebView restreinte), on
// bascule sur l'appareil natif via onFallbackNative — la reprise reste chaînée
// au point de repère, simplement sans fantôme.

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Zap } from 'lucide-react'

const OPACITIES = [0.35, 0.6, 0] as const

export function GhostCamera({
  ghostUrl,
  label,
  onCapture,
  onClose,
  onFallbackNative,
}: {
  /** URL (signée) de la dernière photo de la série — le fantôme. */
  ghostUrl: string
  /** Nom du point de repère (« Porte d'entrée »), ou null. */
  label: string | null
  /** Reçoit le fichier JPEG capturé — le parent l'enfile comme une photo normale. */
  onCapture: (file: File) => void
  onClose: () => void
  /** Caméra in-app indisponible → le parent ouvre l'appareil natif. */
  onFallbackNative: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [opacityIdx, setOpacityIdx] = useState(0)
  const [shooting, setShooting] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onFallbackNative()
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => { /* autoplay policy : l'utilisateur verra un écran noir → fallback */ })
        }
        setReady(true)
      })
      .catch(() => { if (!cancelled) onFallbackNative() })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // onFallbackNative volontairement hors deps : une seule tentative d'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shoot = useCallback(() => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || shooting) return
    setShooting(true)
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) { setShooting(false); return }
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(new File([blob], `reprise-${Date.now()}.jpg`, { type: 'image/jpeg' }))
          onClose()
        } else {
          setShooting(false)
        }
      },
      'image/jpeg',
      0.9,
    )
  }, [onCapture, onClose, shooting])

  const ghostOpacity = OPACITIES[opacityIdx]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" data-testid="ghost-camera">
      {/* En-tête : quoi reprendre + fermer. */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <span className="min-w-0 truncate text-sm font-medium">
          {label ?? 'Point de repère'} — alignez sur le fantôme
        </span>
        <button type="button" onClick={onClose} aria-label="Fermer" className="shrink-0 rounded-full bg-white/10 p-2">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Flux caméra + fantôme superposé. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {ghostOpacity > 0 && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ghostUrl}
            alt=""
            aria-hidden
            style={{ opacity: ghostOpacity }}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        )}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Ouverture de la caméra…
          </div>
        )}
      </div>

      {/* Commandes : opacité du fantôme + déclencheur (cible large, gants). */}
      <div className="flex items-center justify-between px-8 py-5">
        <button
          type="button"
          onClick={() => setOpacityIdx((i) => (i + 1) % OPACITIES.length)}
          className="rounded-full bg-white/10 px-3 py-2 text-xs font-medium text-white"
        >
          <Zap className="mr-1 inline h-3.5 w-3.5" />
          {ghostOpacity === 0 ? 'Fantôme masqué' : `Fantôme ${Math.round(ghostOpacity * 100)} %`}
        </button>
        <button
          type="button"
          onClick={shoot}
          disabled={!ready || shooting}
          aria-label="Prendre la photo"
          data-testid="ghost-shutter"
          className="h-16 w-16 rounded-full border-4 border-white bg-white/30 disabled:opacity-40"
        />
        <span className="w-[92px]" aria-hidden />
      </div>
    </div>
  )
}
