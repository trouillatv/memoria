'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Mic, Square, Check, X, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  uploadVoiceNoteAction,
  extractVoiceNoteAction,
  validateFragmentAction,
  ignoreVoiceNoteAction,
} from './voice-note-actions'
import type { ExtractionProposed } from './voice-note-actions'

interface Props {
  interventionId: string
  open: boolean
  onClose: () => void
}

type Step =
  | 'ready'            // prêt à enregistrer
  | 'recording'        // en cours
  | 'uploading'        // upload + transcription
  | 'review'           // transcription disponible — humain corrige
  | 'extracting'       // extraction IA en cours
  | 'fragment_review'  // éléments proposés + fragment — humain valide
  | 'done'             // validé, fermeture imminente

const MAX_SECONDS = 30

export function VoiceNoteModal({ interventionId, open, onClose }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('ready')
  const [secondsLeft, setSecondsLeft] = useState(MAX_SECONDS)
  const [noteId, setNoteId] = useState<string | null>(null)
  const [transcription, setTranscription] = useState('')
  const [corrected, setCorrected] = useState('')
  const [extraction, setExtraction] = useState<ExtractionProposed | null>(null)
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set())
  const [fragment, setFragment] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  function reset() {
    stopRecording()
    setStep('ready')
    setSecondsLeft(MAX_SECONDS)
    setNoteId(null)
    setTranscription('')
    setCorrected('')
    setExtraction(null)
    setSelectedElements(new Set())
    setFragment('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  useEffect(() => {
    if (!open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'

      const mr = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mr

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const duration = MAX_SECONDS - secondsLeftRef.current
        handleUpload(blob, mimeType, Math.max(1, duration))
      }

      mr.start(250)
      setStep('recording')
      setSecondsLeft(MAX_SECONDS)

      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            stopRecording()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch {
      toast.error('Micro inaccessible. Vérifiez les permissions.')
    }
  }

  const secondsLeftRef = useRef(MAX_SECONDS)
  useEffect(() => { secondsLeftRef.current = secondsLeft }, [secondsLeft])

  async function handleUpload(blob: Blob, mimeType: string, duration: number) {
    setStep('uploading')

    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('duration_seconds', String(duration))
    fd.set('mime_type', mimeType)
    fd.set('audio', blob, 'voice.webm')

    const result = await uploadVoiceNoteAction(fd)
    if ('error' in result) {
      toast.error(result.error)
      reset()
      return
    }

    setNoteId(result.noteId)

    // Si la transcription a échoué ou est vide : note sauvegardée, on ferme sans passer par les écrans IA.
    if (!result.transcription) {
      if ('transcriptionError' in result && result.transcriptionError) {
        console.error('[VoiceNote] transcription error:', result.transcriptionError)
      }
      toast.success('Note enregistrée', { duration: 1500 })
      setTimeout(() => {
        router.refresh()
        onClose()
      }, 1000)
      return
    }

    setTranscription(result.transcription)
    setCorrected(result.transcription)
    setStep('review')
  }

  async function handleExtract() {
    if (!noteId || !corrected.trim()) return
    setStep('extracting')

    const fd = new FormData()
    fd.set('note_id', noteId)
    fd.set('corrected_text', corrected.trim())

    const result = await extractVoiceNoteAction(fd)

    // Qu'il y ait eu une erreur ou non, on passe toujours à fragment_review.
    // Si extraction vide → l'humain saisit le fragment manuellement.
    const ext: ExtractionProposed = 'error' in result
      ? { lieux: [], problemes: [], equipements: [], statut: null, fragment: '' }
      : result.extraction

    // Pré-sélectionner tous les éléments extraits
    const keys = new Set<string>()
    ext.lieux.forEach((l) => keys.add(`lieu:${l}`))
    ext.problemes.forEach((p) => keys.add(`probleme:${p}`))
    ext.equipements.forEach((e) => keys.add(`equipement:${e}`))
    if (ext.statut) keys.add(`statut:${ext.statut}`)

    setExtraction(ext)
    setSelectedElements(keys)
    setFragment('fragment' in result ? result.fragment : '')
    setStep('fragment_review')
  }

  function toggleElement(key: string, checked: boolean) {
    setSelectedElements((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function handleValidateFragment() {
    if (!noteId || !fragment.trim()) return

    const validatedExtraction = extraction
      ? {
          lieux: extraction.lieux.filter((l) => selectedElements.has(`lieu:${l}`)),
          problemes: extraction.problemes.filter((p) => selectedElements.has(`probleme:${p}`)),
          equipements: extraction.equipements.filter((e) => selectedElements.has(`equipement:${e}`)),
          statut: extraction.statut && selectedElements.has(`statut:${extraction.statut}`)
            ? extraction.statut
            : null,
        }
      : null

    const fd = new FormData()
    fd.set('note_id', noteId)
    fd.set('elements', JSON.stringify(validatedExtraction))
    fd.set('fragment', fragment.trim())

    const result = await validateFragmentAction(fd)
    if ('error' in result) {
      toast.error(result.error)
      return
    }

    setStep('done')
    toast.success('Fragment mémoire enregistré', { duration: 1500 })
    setTimeout(() => {
      router.refresh()
      handleClose()
    }, 1200)
  }

  async function handleIgnore() {
    if (noteId) await ignoreVoiceNoteAction(noteId)
    reset()
    onClose()
  }

  if (!open) return null

  const hasElements = extraction
    ? extraction.lieux.length + extraction.problemes.length + extraction.equipements.length > 0 || extraction.statut !== null
    : false

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
      <header className="sticky top-0 z-10 bg-background border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex items-center gap-1 text-sm active:text-muted-foreground"
            style={{ minHeight: 44 }}
          >
            <ArrowLeft className="h-4 w-4" />
            Retour
          </button>
          <span className="text-sm font-semibold">Note terrain</span>
          <span className="w-12" aria-hidden />
        </div>
      </header>

      <div className="p-6 space-y-6 max-w-md mx-auto">

        {/* ÉTAPE 1 : prêt */}
        {step === 'ready' && (
          <div className="flex flex-col items-center gap-6 pt-8">
            <p className="text-sm text-muted-foreground text-center">
              Dites ce que vous observez. Max {MAX_SECONDS} secondes.
            </p>
            <button
              type="button"
              onClick={startRecording}
              className="h-24 w-24 rounded-full bg-foreground text-background flex items-center justify-center active:scale-95 transition-transform"
            >
              <Mic className="h-10 w-10" />
            </button>
            <p className="text-xs text-muted-foreground">Appuyez pour commencer</p>
          </div>
        )}

        {/* ÉTAPE 2 : enregistrement */}
        {step === 'recording' && (
          <div className="flex flex-col items-center gap-6 pt-8">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
              <button
                type="button"
                onClick={() => { stopRecording() }}
                className="relative h-24 w-24 rounded-full bg-red-500 text-white flex items-center justify-center active:scale-95 transition-transform"
              >
                <Square className="h-10 w-10 fill-white" />
              </button>
            </div>
            <div className="text-center space-y-1">
              <p className="text-2xl font-semibold tabular-nums">{secondsLeft}s</p>
              <p className="text-sm text-muted-foreground">Appuyez pour arrêter</p>
            </div>
          </div>
        )}

        {/* ÉTAPE 3 : upload / transcription */}
        {step === 'uploading' && (
          <div className="flex flex-col items-center gap-4 pt-12">
            <div className="h-10 w-10 rounded-full border-2 border-foreground border-t-transparent animate-spin" />
            <p className="text-sm text-muted-foreground">Transcription en cours…</p>
          </div>
        )}

        {/* ÉTAPE 4 : review transcription */}
        {step === 'review' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">Ce que le système a compris :</p>
              <textarea
                value={corrected}
                onChange={(e) => setCorrected(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder={transcription ? undefined : 'Saisissez ce que vous avez dit…'}
                className="w-full rounded-xl border p-4 text-base resize-none bg-muted/20"
              />
              {!transcription && (
                <p className="text-xs text-destructive italic">
                  Transcription indisponible — saisissez manuellement ce que vous avez dit.
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Corrigez si nécessaire, puis continuez pour extraire les éléments mémoire.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleIgnore}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-base py-4 active:bg-muted/40"
                style={{ minHeight: 64 }}
              >
                <X className="h-4 w-4" />
                Ignorer
              </button>
              <button
                type="button"
                onClick={handleExtract}
                disabled={!corrected.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background text-base py-4 active:bg-foreground/90 disabled:opacity-50"
                style={{ minHeight: 64 }}
              >
                Continuer
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ÉTAPE 5 : extraction IA en cours */}
        {step === 'extracting' && (
          <div className="flex flex-col items-center gap-4 pt-12">
            <div className="h-10 w-10 rounded-full border-2 border-foreground border-t-transparent animate-spin" />
            <p className="text-sm text-muted-foreground">Extraction des éléments mémoire…</p>
          </div>
        )}

        {/* ÉTAPE 6 : review extraction + fragment */}
        {step === 'fragment_review' && (
          <div className="space-y-6">

            {/* Éléments proposés */}
            <div className="space-y-4">
              <p className="text-sm font-medium">Éléments proposés</p>

              {!hasElements && (
                <p className="text-xs text-muted-foreground italic">
                  Aucun élément extrait — saisissez directement le fragment mémoire.
                </p>
              )}

              {extraction && extraction.lieux.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Lieux</p>
                  {extraction.lieux.map((l) => (
                    <label key={`lieu:${l}`} className="flex items-center gap-3 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedElements.has(`lieu:${l}`)}
                        onChange={(e) => toggleElement(`lieu:${l}`, e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      {l}
                    </label>
                  ))}
                </div>
              )}

              {extraction && extraction.problemes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Problèmes</p>
                  {extraction.problemes.map((p) => (
                    <label key={`probleme:${p}`} className="flex items-center gap-3 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedElements.has(`probleme:${p}`)}
                        onChange={(e) => toggleElement(`probleme:${p}`, e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      {p}
                    </label>
                  ))}
                </div>
              )}

              {extraction && extraction.equipements.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Équipements</p>
                  {extraction.equipements.map((e) => (
                    <label key={`equipement:${e}`} className="flex items-center gap-3 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedElements.has(`equipement:${e}`)}
                        onChange={(e) => toggleElement(`equipement:${e}`, e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      {e}
                    </label>
                  ))}
                </div>
              )}

              {extraction?.statut && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Statut</p>
                  <label className="flex items-center gap-3 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedElements.has(`statut:${extraction.statut}`)}
                      onChange={(e) => toggleElement(`statut:${extraction.statut!}`, e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    {extraction.statut}
                  </label>
                </div>
              )}
            </div>

            {/* Fragment mémoire */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Fragment mémoire</p>
              <textarea
                value={fragment}
                onChange={(e) => setFragment(e.target.value)}
                rows={2}
                maxLength={200}
                placeholder="ex : bloc B revient — humidité"
                className="w-full rounded-xl border p-4 text-base resize-none bg-muted/20"
              />
              <p className="text-xs text-muted-foreground">
                Ce fragment sera mémorisé. Corrigez si nécessaire.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleIgnore}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card text-base py-4 active:bg-muted/40"
                style={{ minHeight: 64 }}
              >
                <X className="h-4 w-4" />
                Ignorer
              </button>
              {fragment.trim() ? (
                <button
                  type="button"
                  onClick={handleValidateFragment}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background text-base py-4 active:bg-foreground/90"
                  style={{ minHeight: 64 }}
                >
                  <Check className="h-4 w-4" />
                  Valider la mémoire
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    toast.success('Note enregistrée', { duration: 1500 })
                    setTimeout(() => { router.refresh(); onClose() }, 1000)
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background text-base py-4 active:bg-foreground/90"
                  style={{ minHeight: 64 }}
                >
                  <Check className="h-4 w-4" />
                  Enregistrer
                </button>
              )}
            </div>
          </div>
        )}

        {/* ÉTAPE 7 : confirmé */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 pt-12">
            <div className="h-16 w-16 rounded-full bg-foreground text-background flex items-center justify-center">
              <Check className="h-8 w-8" />
            </div>
            <p className="text-sm text-muted-foreground">Fragment mémoire enregistré</p>
          </div>
        )}

      </div>
    </div>
  )
}
