'use client'

// Capture multimodale d'un compte-rendu de chantier : voix + texte + photos +
// pièces jointes. Machine d'états : capture → transcription → relecture →
// analyse → curation → terminé. Réutilise le pattern MediaRecorder des notes
// vocales d'intervention (cap 30s relâché : on compte vers le HAUT).
//
// Doctrine : rien n'est perdu — le texte saisi part en premier ; si la
// transcription ou l'IA échoue, l'artefact reste.

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Mic, Square, Camera, Paperclip, Loader2, X, FileText, Image as ImageIcon,
  Sparkles, CheckCircle2, CalendarClock,
} from 'lucide-react'
import { toast } from 'sonner'
import type { DbSiteAction, DbSiteReportProposal } from '@/types/db'
import {
  createReportDraftAction,
  uploadReportAttachmentAction,
  transcribeReportAction,
  analyzeReportAction,
  getReportCurationContextAction,
} from './report-actions'
import { SiteReportCuration } from './SiteReportCuration'

interface Props {
  siteId: string
  siteName: string
  onClose: () => void
}

type Step = 'capture' | 'working' | 'review' | 'curation' | 'done'

interface LocalAttachment {
  clientUuid: string
  kind: 'photo' | 'file'
  name: string
  isImage: boolean
  previewUrl: string | null
  uploaded: boolean
}

const FR = new Intl.NumberFormat('fr-FR')

export function SiteReportPanel({ siteId, siteName, onClose }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('capture')
  const [working, setWorking] = useState<string>('')
  const [reportId, setReportId] = useState<string | null>(null)

  // Capture
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioMime, setAudioMime] = useState<string>('audio/webm')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])

  // Review
  const [transcript, setTranscript] = useState('')

  // Curation
  const [proposals, setProposals] = useState<DbSiteReportProposal[]>([])
  const [missions, setMissions] = useState<Array<{ id: string; name: string }>>([])
  const [meetingNumber, setMeetingNumber] = useState(1)
  const [openActions, setOpenActions] = useState<DbSiteAction[]>([])

  // Done
  const [doneSummary, setDoneSummary] = useState<{ created: number; hasTomorrowIntervention: boolean } | null>(null)

  const [, startTransition] = useTransition()
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'
      setAudioMime(mime)
      const mr = new MediaRecorder(stream, { mimeType: mime })
      mediaRecorderRef.current = mr
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: mime }))
        streamRef.current?.getTracks().forEach((t) => t.stop())
      }
      mr.start(250)
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } catch {
      toast.error('Micro inaccessible. Vérifiez les permissions.')
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    setRecording(false)
  }

  function addFiles(files: FileList | null, kind: 'photo' | 'file') {
    if (!files) return
    const next: LocalAttachment[] = []
    for (const f of Array.from(files)) {
      const isImage = f.type.startsWith('image/')
      next.push({
        clientUuid: crypto.randomUUID(),
        kind,
        name: f.name,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(f) : null,
        uploaded: false,
      })
      // Stocker le File réel pour l'upload différé
      filesRef.current.set(next[next.length - 1].clientUuid, f)
    }
    setAttachments((prev) => [...prev, ...next])
  }
  const filesRef = useRef<Map<string, File>>(new Map())

  function removeAttachment(clientUuid: string) {
    setAttachments((prev) => {
      const a = prev.find((x) => x.clientUuid === clientUuid)
      if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl)
      return prev.filter((x) => x.clientUuid !== clientUuid)
    })
    filesRef.current.delete(clientUuid)
  }

  // ── Analyse : crée le brouillon, upload, transcrit, analyse ───────────────
  function handleAnalyze() {
    if (recording) stopRecording()
    startTransition(async () => {
      setStep('working')

      // 1. Brouillon (le texte part EN PREMIER)
      setWorking('Enregistrement du compte-rendu…')
      const fd = new FormData()
      fd.set('site_id', siteId)
      if (text.trim()) fd.set('text_input', text.trim())
      if (audioBlob) {
        fd.set('audio', audioBlob, 'note.webm')
        fd.set('audio_mime', audioMime)
        fd.set('audio_duration_seconds', String(elapsed))
      }
      const draft = await createReportDraftAction(fd)
      if (!draft.ok) { toast.error(draft.error); setStep('capture'); return }
      setReportId(draft.reportId)

      // 2. Upload des pièces
      if (attachments.length > 0) {
        setWorking(`Envoi des pièces (${attachments.length})…`)
        for (const a of attachments) {
          const file = filesRef.current.get(a.clientUuid)
          if (!file) continue
          const afd = new FormData()
          afd.set('report_id', draft.reportId)
          afd.set('kind', a.kind)
          afd.set('client_uuid', a.clientUuid)
          afd.set('file', file)
          await uploadReportAttachmentAction(afd)
        }
      }

      // 3. Transcription (si audio)
      let transcriptText = ''
      if (draft.hasAudio) {
        setWorking('Transcription de la note vocale…')
        const tr = await transcribeReportAction(draft.reportId)
        if (tr.ok) transcriptText = tr.transcript
        else toast.message('Transcription indisponible — saisie manuelle possible.')
      }
      setTranscript(transcriptText)
      setStep('review')
    })
  }

  // ── Relecture → lance l'analyse IA ────────────────────────────────────────
  function handleRunAnalysis() {
    if (!reportId) return
    startTransition(async () => {
      setStep('working')
      setWorking('Analyse en cours — détection des décisions…')
      const fd = new FormData()
      fd.set('report_id', reportId)
      if (transcript.trim()) fd.set('transcript_corrected', transcript.trim())
      if (text.trim()) fd.set('text_input', text.trim())
      const res = await analyzeReportAction(fd)
      if (!res.ok) { toast.error(res.error); setStep('review'); return }
      const ctx = await getReportCurationContextAction(siteId)
      setProposals(res.proposals)
      setMissions(ctx.missions)
      setMeetingNumber(ctx.meetingNumber)
      setOpenActions(ctx.openActions)
      setStep('curation')
    })
  }

  const canAnalyze = !!audioBlob || text.trim().length > 0 || attachments.length > 0

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Compte-rendu chantier</h2>
          <p className="text-xs text-muted-foreground">{siteName}</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fermer">
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* ── CAPTURE ── */}
      {step === 'capture' && (
        <div className="space-y-4">
          {/* Micro */}
          <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-4">
            {!recording ? (
              <button
                type="button"
                onClick={startRecording}
                className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background active:scale-95 transition-transform"
              >
                <Mic className="h-7 w-7" />
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white animate-pulse"
              >
                <Square className="h-6 w-6" />
              </button>
            )}
            <p className="text-xs text-muted-foreground tabular-nums">
              {recording
                ? `Enregistrement… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                : audioBlob
                ? `Note enregistrée (${elapsed}s) — réenregistrer ?`
                : 'Dicter le compte-rendu'}
            </p>
          </div>

          {/* Texte */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="…ou saisir / corriger au clavier"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />

          {/* Photos + fichiers */}
          <div className="flex items-center gap-2">
            <label className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-sm text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
              <Camera className="h-4 w-4" />
              Photo
              <input type="file" accept="image/*" capture="environment" multiple className="sr-only"
                onChange={(e) => { addFiles(e.target.files, 'photo'); e.target.value = '' }} />
            </label>
            <label className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2.5 text-sm text-muted-foreground cursor-pointer hover:text-foreground hover:border-foreground/40">
              <Paperclip className="h-4 w-4" />
              Fichier
              <input type="file" accept="image/*,application/pdf" multiple className="sr-only"
                onChange={(e) => { addFiles(e.target.files, 'file'); e.target.value = '' }} />
            </label>
          </div>

          {/* Galerie des pièces */}
          {attachments.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {attachments.map((a) => (
                <div key={a.clientUuid} className="relative aspect-square rounded-md border bg-muted/30 overflow-hidden">
                  {a.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.previewUrl} alt={a.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1 p-1 text-center">
                      {a.isImage ? <ImageIcon className="h-5 w-5 text-muted-foreground" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
                      <span className="text-[8px] text-muted-foreground truncate w-full">{a.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.clientUuid)}
                    className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white"
                    aria-label="Retirer"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background py-3 text-sm font-medium disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            Analyser et proposer
          </button>
        </div>
      )}

      {/* ── WORKING ── */}
      {step === 'working' && (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{working}</p>
        </div>
      )}

      {/* ── REVIEW transcript ── */}
      {step === 'review' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Relisez et corrigez la transcription avant l&apos;analyse.
          </p>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={6}
            placeholder="Transcription… (vide ? saisissez le compte-rendu à la main)"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            onClick={handleRunAnalysis}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-foreground text-background py-3 text-sm font-medium"
          >
            <Sparkles className="h-4 w-4" />
            Détecter les décisions
          </button>
        </div>
      )}

      {/* ── CURATION ── */}
      {step === 'curation' && (
        <SiteReportCuration
          reportId={reportId!}
          proposals={proposals}
          existingMissions={missions}
          meetingNumber={meetingNumber}
          openActions={openActions}
          onDone={(r) => { setDoneSummary(r); setStep('done'); router.refresh() }}
        />
      )}

      {/* ── DONE ── */}
      {step === 'done' && doneSummary && (
        <div className="space-y-4 py-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="text-sm font-medium">
            {FR.format(doneSummary.created)} élément{doneSummary.created > 1 ? 's' : ''} créé{doneSummary.created > 1 ? 's' : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            Le compte-rendu et ses pièces sont archivés dans le journal du chantier.
          </p>
          {doneSummary.hasTomorrowIntervention && (
            <Link
              href="/briefing"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-foreground/30 px-4 py-2.5 text-sm font-medium hover:bg-muted/40"
            >
              <CalendarClock className="h-4 w-4" />
              Générer le briefing de demain
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            className="block w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium"
          >
            Terminer
          </button>
        </div>
      )}
    </div>
  )
}
