'use client'

// Micro juste après le shutter — la photo vient d'être prise, l'agent peut soit
// repartir immédiatement (✓ Continuer), soit dicter tant que le contexte est
// encore frais (🎙 Décrire). Optionnel, jamais un pas obligatoire de plus.
//
// La dictée n'est PAS un vocal autonome : elle alimente body de LA capture qui
// vient d'être prise (par client_uuid), exactement le même champ que la légende
// écrite dans le triage (cf. [[reportage-photo-cr-editorial-valide]]). Le réseau
// terrain (mine/forêt) est mauvais : dès que l'audio est capturé, on peut
// continuer la visite — la transcription + l'attachement se terminent en fond,
// avec quelques tentatives, sans jamais perdre la photo ni bloquer l'agent.

import { useRef, useState } from 'react'
import { Mic, Square, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useCaptionDictation } from '@/lib/field/use-caption-dictation'
import { appendCaptionByClientUuidAction } from './capture-actions'

const MAX_ATTACH_ATTEMPTS = 3

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

type Stage = 'choice' | 'recording' | 'transcribing'

export function PostShutterDictation({
  siteId,
  clientUuid,
  previewUrl,
  onDone,
}: {
  siteId: string
  clientUuid: string
  previewUrl: string | null
  onDone: () => void
}) {
  const [stage, setStage] = useState<Stage>('choice')
  const dictation = useCaptionDictation(siteId)
  const doneRef = useRef(false)

  const leave = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }

  async function handleDescribe() {
    setStage('recording')
    await dictation.start()
  }

  // Arrête l'enregistrement puis lance la transcription + l'attachement en
  // fond : la promesse continue même si l'agent quitte cet écran tout de suite
  // après (le texte capté ne doit jamais se perdre pour une histoire de réseau).
  function handleStop() {
    setStage('transcribing')
    dictation.stop().then((text) => {
      if (!text) return
      void attachWithRetry(clientUuid, text).then((res) => {
        if (!res.ok) toast.error(`Légende non enregistrée — ${res.error}`)
      })
    })
  }

  function handleCancelRecording() {
    dictation.cancel()
    leave()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background/98 p-6 text-center">
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="" className="h-40 w-40 rounded-2xl border border-emerald-500/30 object-cover shadow-sm" />
      )}

      {stage === 'choice' && (
        <>
          <p className="text-sm font-medium text-foreground">Photo enregistrée</p>
          <div className="flex w-full max-w-xs flex-col gap-2">
            <button
              type="button" onClick={handleDescribe}
              className="flex items-center justify-center gap-2 rounded-xl border border-emerald-600 bg-emerald-50 py-3 text-sm font-semibold text-emerald-800 active:scale-[0.98] dark:bg-emerald-950/30 dark:text-emerald-200"
            >
              <Mic className="h-4 w-4" /> Décrire
            </button>
            <button
              type="button" onClick={leave}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white active:scale-[0.98]"
            >
              <Check className="h-4 w-4" /> Continuer
            </button>
          </div>
        </>
      )}

      {stage === 'recording' && (
        <>
          <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            <Mic className="h-4 w-4 animate-pulse" /> Écoute…
          </p>
          <div className="flex w-full max-w-xs flex-col gap-2">
            <button
              type="button" onClick={handleStop}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white active:scale-[0.98]"
            >
              <Square className="h-4 w-4" /> Terminer
            </button>
            <button type="button" onClick={handleCancelRecording} className="py-2 text-xs text-muted-foreground underline underline-offset-2">
              Passer
            </button>
          </div>
        </>
      )}

      {stage === 'transcribing' && (
        <>
          <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            <Loader2 className="h-4 w-4 animate-spin" /> Transcription…
          </p>
          <button
            type="button" onClick={leave}
            className="flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-emerald-700 py-3 text-sm font-semibold text-white active:scale-[0.98]"
          >
            <Check className="h-4 w-4" /> Continuer
          </button>
          <p className="text-[11px] text-muted-foreground">La légende s&apos;attache en arrière-plan, même après ton départ de cet écran.</p>
        </>
      )}
    </div>
  )
}
