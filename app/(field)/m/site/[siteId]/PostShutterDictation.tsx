'use client'

// Micro juste après le shutter — la photo vient d'être prise, l'agent peut soit
// repartir immédiatement (✓ Continuer), soit dicter tant que le contexte est
// encore frais (🎙 Décrire), soit reprendre le cadrage (↶ Reprendre). Écran
// UNIQUE, jamais un pas modal forcé (Vincent, rework post-shutter 2026-08-26) :
// la photo reste affichée en permanence, le contrôle micro change simplement
// d'état sur place (idle → Préparation du micro… → Je vous écoute… → Je
// prépare la légende… → légende éditable). « Je vous écoute » ne s'affiche
// qu'une fois le moteur réellement prêt (onstart du hook, jamais un
// setTimeout de substitution — Vincent, fix timing micro 2026-09-30) ; la
// légende reste éditable en tout temps après une dictée, une édition
// manuelle est persistée sur blur et ne peut jamais être écrasée en silence.
//
// La dictée n'est PAS un vocal autonome : elle alimente body de LA capture qui
// vient d'être prise (par client_uuid), exactement le même champ que la légende
// écrite dans le triage (cf. [[reportage-photo-cr-editorial-valide]]). Le réseau
// terrain (mine/forêt) est mauvais : dès que l'audio est capturé, on peut
// continuer la visite — la transcription + l'attachement se terminent en fond,
// avec quelques tentatives, sans jamais perdre la photo ni bloquer l'agent.

import { useRef, useState } from 'react'
import { Mic, Square, Loader2, Check, X, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useCaptionDictation } from '@/lib/field/use-caption-dictation'
import type { GeoStatus } from '@/lib/field/geoloc-status'
import { formatPostShutterGpsChip } from '@/lib/visits/geo'
import { appendCaptionByClientUuidAction, setCaptionByClientUuidAction, correctCaptureLocationByClientUuidAction, revertCaptureLocationByClientUuidAction } from './capture-actions'
import { LocationCorrectionMap } from '@/components/LocationCorrectionMap'

// Position résolue en fond par VisitBasket (cf. formatPostShutterGpsChip,
// lib/visits/geo.ts) pour la puce GPS/altitude de cet écran — absence
// d'entrée pour un client_uuid = tentative encore en cours ('locating').
// lat/lng : mesure GPS brute d'origine, nécessaire pour ouvrir
// LocationCorrectionMap au tap sur la puce (repère fixe non modifiable) — null
// tant que status !== 'success'.
export interface PostShutterGpsInfo {
  status: GeoStatus
  lat: number | null
  lng: number | null
  accuracyM: number | null
  altitudeM: number | null
}

const MAX_ATTACH_ATTEMPTS = 3
// Plancher UX minimal entre le tap et « Je vous écoute » (Vincent, fix timing
// micro 2026-09-30) : appliqué APRÈS le signal réel `onstart` du hook, jamais
// en remplacement — évite un flash « Préparation… » si le moteur démarre
// exceptionnellement vite.
const MIN_PREPARING_MS = 1000

async function attachWithRetry(clientUuid: string, text: string): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  let lastError = 'Échec de l’enregistrement de la légende'
  for (let attempt = 1; attempt <= MAX_ATTACH_ATTEMPTS; attempt++) {
    try {
      const res = await appendCaptionByClientUuidAction({ client_uuid: clientUuid, text })
      if (res.ok) return res
      lastError = res.error
    } catch {
      // réseau coupé — on retente après un court délai
    }
    if (attempt < MAX_ATTACH_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * attempt))
  }
  return { ok: false, error: lastError }
}

// Édition manuelle de la légende : contrairement à la dictée (fusion), le
// texte tapé par l'agent EST la légende voulue — remplacement intégral.
async function persistEditWithRetry(clientUuid: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let lastError = 'Échec de l’enregistrement de la légende'
  for (let attempt = 1; attempt <= MAX_ATTACH_ATTEMPTS; attempt++) {
    try {
      const res = await setCaptionByClientUuidAction({ client_uuid: clientUuid, text })
      if (res.ok) return res
      lastError = res.error
    } catch {
      // réseau coupé — on retente après un court délai
    }
    if (attempt < MAX_ATTACH_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * attempt))
  }
  return { ok: false, error: lastError }
}

export function PostShutterDictation({
  siteId,
  clientUuid,
  previewUrl,
  gpsInfo,
  mapboxToken = null,
  onRetake,
  onDone,
}: {
  siteId: string
  clientUuid: string
  previewUrl: string | null
  /** Undefined tant que VisitBasket n'a pas encore posé d'entrée pour ce client_uuid (course normale, cf. enqueueMedia). */
  gpsInfo: PostShutterGpsInfo | undefined
  /** Résolu côté serveur depuis MAPBOX_TOKEN — même contrat que Terrain/CR,
   *  cf. use-map-base-layer.ts. */
  mapboxToken?: string | null
  onRetake: (clientUuid: string, previewUrl: string | null) => void
  onDone: () => void
}) {
  const dictation = useCaptionDictation(siteId)
  // État local, pas `dictation.state` : le contrôle micro de cet écran doit
  // rester prévisible même si l'arrêt vient du silence détecté (callback async
  // du hook) plutôt que d'un tap — un seul point de vérité pour les 4 phases
  // visibles (Décrire / Préparation du micro… / Je vous écoute… / Je prépare
  // la légende…).
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'recording' | 'transcribing'>('idle')
  // Légende éditable — la dernière valeur confirmée côté serveur (dictée ou
  // édition manuelle) sert de référence pour ne pas ré-écrire inutilement sur
  // blur si rien n'a changé.
  const [captionText, setCaptionText] = useState('')
  const lastPersistedCaptionRef = useRef('')
  const [showLocationMap, setShowLocationMap] = useState(false)
  // Reflète une correction validée pendant cette session d'écran — la capture
  // vient d'être prise, elle n'a jamais de correction préexistante au montage.
  const [correction, setCorrection] = useState<{ lat: number; lng: number } | null>(null)

  const gps = gpsInfo ?? { status: 'locating' as const, lat: null, lng: null, accuracyM: null, altitudeM: null }
  const gpsChipText = formatPostShutterGpsChip(gps.status, gps.accuracyM, gps.altitudeM)
  const gpsChipTappable = gps.status === 'success' && gps.lat != null && gps.lng != null

  function handleAttachResult(text: string | null) {
    if (!text) return
    void attachWithRetry(clientUuid, text).then((res) => {
      if (res.ok) {
        setCaptionText(res.body)
        lastPersistedCaptionRef.current = res.body
      } else {
        toast.error(`Légende non enregistrée — ${res.error}`)
      }
    })
  }

  // Arrêt automatique sur silence : invoqué par le hook lui-même, jamais par
  // un tap — doit ramener l'écran en phase idle exactement comme un arrêt
  // manuel, sans jamais dupliquer l'attache (une seule résolution possible).
  function handleAutoStop(text: string | null) {
    setPhase('idle')
    handleAttachResult(text)
  }

  async function handleMicTap() {
    if (phase === 'recording') {
      setPhase('transcribing')
      const text = await dictation.stop()
      setPhase('idle')
      handleAttachResult(text)
      return
    }
    if (phase === 'preparing' || phase === 'transcribing') return
    setPhase('preparing')
    const tapStartedAt = Date.now()
    const started = await dictation.start(handleAutoStop)
    if (!started) { setPhase('idle'); return }
    // Le moteur est réellement prêt (onstart reçu, cf. le hook) — on ne garde
    // qu'un plancher UX minimal, jamais une attente de substitution.
    const remaining = MIN_PREPARING_MS - (Date.now() - tapStartedAt)
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining))
    setPhase('recording')
  }

  // Sauvegarde une édition manuelle de la légende — jamais de fusion, le texte
  // tapé remplace intégralement (contrairement à une dictée). Ignoré si rien
  // n'a changé depuis la dernière valeur confirmée côté serveur.
  function handleCaptionBlur() {
    const text = captionText
    if (text === lastPersistedCaptionRef.current) return
    lastPersistedCaptionRef.current = text
    void persistEditWithRetry(clientUuid, text).then((res) => {
      if (!res.ok) toast.error(`Légende non enregistrée — ${res.error}`)
    })
  }

  function leave() {
    if (phase === 'recording' || phase === 'preparing') dictation.stop().then(handleAttachResult)
    onDone()
  }

  function handleRetake() {
    if (phase === 'recording' || phase === 'preparing') dictation.cancel()
    onRetake(clientUuid, previewUrl)
  }

  const micLabel =
    phase === 'preparing' ? 'Préparation du micro…' :
    phase === 'recording' ? 'Je vous écoute…' :
    phase === 'transcribing' ? 'Je prépare la légende…' :
    'Décrire'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/98">
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button" onClick={leave} aria-label="Fermer"
          className="rounded-full bg-black/10 p-2 text-foreground/70 active:scale-95 dark:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => gpsChipTappable && setShowLocationMap(true)}
          disabled={!gpsChipTappable}
          className="rounded-full bg-black/10 px-3 py-1.5 text-[11px] font-medium text-foreground/70 disabled:opacity-70 dark:bg-white/10"
        >
          {gpsChipText}
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-56 w-56 rounded-2xl border border-emerald-500/30 object-cover shadow-sm" />
        )}

        {captionText.length > 0 && (
          <textarea
            value={captionText}
            onChange={(e) => setCaptionText(e.target.value)}
            onBlur={handleCaptionBlur}
            rows={3}
            maxLength={500}
            placeholder="Légende de la photo"
            aria-label="Légende de la photo"
            className="w-full max-w-xs resize-none rounded-lg border border-border/60 bg-transparent px-3 py-2 text-xs text-foreground focus:border-emerald-600 focus:outline-none"
          />
        )}
        {dictation.error && phase === 'idle' && (
          <p className="max-w-xs text-xs text-destructive">{dictation.error}</p>
        )}

        <div className="grid w-full max-w-xs grid-cols-3 items-start gap-2">
          <button
            type="button" onClick={handleRetake}
            className="flex flex-col items-center gap-1 rounded-xl border border-border/60 py-3 text-[11px] font-medium text-muted-foreground active:scale-[0.98]"
          >
            <RotateCcw className="h-4 w-4" /> Reprendre
          </button>
          <button
            type="button" onClick={leave}
            className="flex flex-col items-center gap-1 rounded-xl bg-emerald-700 py-3 text-[11px] font-semibold text-white active:scale-[0.98]"
          >
            <Check className="h-4 w-4" /> Continuer
          </button>
          <button
            type="button" onClick={handleMicTap}
            disabled={phase === 'preparing' || phase === 'transcribing'}
            className="flex flex-col items-center gap-1 rounded-xl border border-emerald-600 bg-emerald-50 py-3 text-[11px] font-semibold text-emerald-800 active:scale-[0.98] disabled:opacity-70 dark:bg-emerald-950/30 dark:text-emerald-200"
          >
            {phase === 'recording' ? (
              <Square className="h-4 w-4" />
            ) : phase === 'preparing' || phase === 'transcribing' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            {micLabel}
          </button>
        </div>
      </div>

      {showLocationMap && gps.lat != null && gps.lng != null && (
        <LocationCorrectionMap
          lat={gps.lat}
          lng={gps.lng}
          correctedLat={correction?.lat ?? null}
          correctedLng={correction?.lng ?? null}
          gpsAccuracyM={gps.accuracyM}
          mapboxToken={mapboxToken}
          onCancel={() => setShowLocationMap(false)}
          onValidate={async (nextLat, nextLng) => {
            const r = await correctCaptureLocationByClientUuidAction({ client_uuid: clientUuid, lat: nextLat, lng: nextLng })
            if (!r.ok) { toast.error(r.error); return }
            setCorrection({ lat: nextLat, lng: nextLng })
            setShowLocationMap(false)
          }}
          onRevert={async () => {
            const r = await revertCaptureLocationByClientUuidAction({ client_uuid: clientUuid })
            if (!r.ok) { toast.error(r.error); return }
            setCorrection(null)
            setShowLocationMap(false)
          }}
        />
      )}
    </div>
  )
}
