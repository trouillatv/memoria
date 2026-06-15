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
  Sparkles, CheckCircle2, CalendarClock, FileAudio, Lightbulb,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  DbSiteAction, DbSiteReportProposal, SiteReportParticipant, SiteReportRisk,
} from '@/types/db'
import type { PriorActionUpdate } from '@/services/ai/site-report-analysis'
import {
  createReportDraftAction,
  uploadReportAttachmentAction,
  transcribeReportAction,
  analyzeReportAction,
  getReportCurationContextAction,
} from './report-actions'
import { SiteReportCuration } from './SiteReportCuration'

interface Props {
  reportType?: 'site' | 'contract'
  siteId?: string
  siteName?: string
  contractId?: string
  contractName?: string
  onClose: () => void
}

type Step = 'capture' | 'working' | 'saved' | 'curation' | 'done'

interface LocalAttachment {
  clientUuid: string
  kind: 'photo' | 'file'
  name: string
  isImage: boolean
  previewUrl: string | null
  uploaded: boolean
}

const FR = new Intl.NumberFormat('fr-FR')

export function SiteReportPanel({
  reportType = 'site', siteId, siteName, contractId, contractName, onClose,
}: Props) {
  const router = useRouter()
  const subjectName = reportType === 'contract' ? (contractName ?? 'Contrat') : (siteName ?? 'Chantier')
  const [step, setStep] = useState<Step>('capture')
  const [working, setWorking] = useState<string>('')
  const [reportId, setReportId] = useState<string | null>(null)

  // Capture
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioMime, setAudioMime] = useState<string>('audio/webm')
  const [audioName, setAudioName] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])

  // Écran « sauvegardé » (transcription/analyse indisponible — audio conservé)
  const [savedNote, setSavedNote] = useState('')

  // Curation
  const [proposals, setProposals] = useState<DbSiteReportProposal[]>([])
  const [missions, setMissions] = useState<Array<{ id: string; name: string }>>([])
  const [meetingNumber, setMeetingNumber] = useState(1)
  const [openActions, setOpenActions] = useState<DbSiteAction[]>([])
  const [reportDates, setReportDates] = useState<string[]>([])
  const [candidateSites, setCandidateSites] = useState<Array<{ id: string; name: string }>>([])
  const [participants, setParticipants] = useState<SiteReportParticipant[]>([])
  const [risks, setRisks] = useState<SiteReportRisk[]>([])
  const [priorUpdates, setPriorUpdates] = useState<PriorActionUpdate[]>([])

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
      setAudioName(null)
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

  // Importer un fichier audio existant → traité comme une note dictée
  // (uploadé + transcrit par l'IA, exactement comme un enregistrement).
  function importAudio(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('audio/')) { toast.error('Fichier audio attendu (mp3, m4a, wav…)'); return }
    if (recording) stopRecording()
    setAudioBlob(file)
    setAudioMime(file.type || 'audio/mpeg')
    setAudioName(file.name)
    setElapsed(0)
    try {
      const url = URL.createObjectURL(file)
      const probe = new Audio()
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => {
        const d = Number.isFinite(probe.duration) ? Math.min(600, Math.round(probe.duration)) : 0
        setElapsed(d)
        URL.revokeObjectURL(url)
      }
      probe.onerror = () => URL.revokeObjectURL(url)
      probe.src = url
    } catch { /* durée optionnelle */ }
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

  // Lance l'analyse IA sur un transcript/texte connus. true si réussie.
  async function runAnalysis(rid: string, transcriptText: string): Promise<boolean> {
    setWorking('Analyse en cours — détection des décisions…')
    const fd = new FormData()
    fd.set('report_id', rid)
    if (transcriptText.trim()) fd.set('transcript_corrected', transcriptText.trim())
    if (text.trim()) fd.set('text_input', text.trim())
    const res = await analyzeReportAction(fd)
    if (!res.ok) { toast.error(res.error); return false }
    const ctx = await getReportCurationContextAction(rid)
    setProposals(res.proposals)
    setParticipants(res.participants)
    setRisks(res.risks)
    setPriorUpdates(res.priorUpdates)
    setMissions(ctx.missions)
    setMeetingNumber(ctx.meetingNumber)
    setOpenActions(ctx.openActions)
    setReportDates(ctx.reportDates)
    setCandidateSites(ctx.candidateSites)
    return true
  }

  // ── Analyser : draft (audio sauvé EN PREMIER) → pièces → transcription →
  //    analyse → curation, d'un seul geste. Si la transcription ou l'analyse
  //    échoue (ex. clé IA absente en prod), l'audio est DÉJÀ sauvegardé : on
  //    bascule sur l'écran « sauvegardé » (réessai possible), rien n'est perdu.
  function handleAnalyze() {
    if (recording) stopRecording()
    startTransition(async () => {
      setStep('working')

      // 1. Brouillon (le texte ET l'audio partent EN PREMIER — persistés).
      setWorking('Enregistrement du compte-rendu…')
      const fd = new FormData()
      fd.set('report_type', reportType)
      if (reportType === 'contract' && contractId) fd.set('contract_id', contractId)
      else if (siteId) fd.set('site_id', siteId)
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
      }

      // 4. Rien à analyser (transcription échouée + pas de texte saisi) → on
      //    s'arrête proprement : l'audio est sauvegardé, on reprendra plus tard.
      const hasContent = transcriptText.trim().length > 0 || text.trim().length > 0
      if (!hasContent) {
        setSavedNote(
          draft.hasAudio
            ? "Audio enregistré, mais la transcription n'a pas pu se faire (service IA indisponible). Le compte-rendu est sauvegardé — vous pourrez le reprendre plus tard."
            : 'Compte-rendu sauvegardé.',
        )
        setStep('saved')
        return
      }

      // 5. Analyse directe → curation (plus d'écran de relecture).
      const ok = await runAnalysis(draft.reportId, transcriptText)
      if (!ok) {
        setSavedNote("Le compte-rendu et l'audio sont sauvegardés, mais l'analyse n'a pas pu se faire. Réessayez dans un moment.")
        setStep('saved')
        return
      }
      setStep('curation')
    })
  }

  // Réessayer depuis l'écran « sauvegardé » : re-transcrire (audio en base) puis analyser.
  function handleRetry() {
    if (!reportId) return
    startTransition(async () => {
      setStep('working')
      let transcriptText = ''
      setWorking('Nouvelle tentative de transcription…')
      const tr = await transcribeReportAction(reportId)
      if (tr.ok) transcriptText = tr.transcript
      const hasContent = transcriptText.trim().length > 0 || text.trim().length > 0
      if (!hasContent) {
        setSavedNote("Toujours indisponible. L'audio reste sauvegardé — réessayez plus tard.")
        setStep('saved')
        return
      }
      const ok = await runAnalysis(reportId, transcriptText)
      setStep(ok ? 'curation' : 'saved')
    })
  }

  const canAnalyze = !!audioBlob || text.trim().length > 0 || attachments.length > 0

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">
            {reportType === 'contract' ? 'Réunion de contrat' : 'Compte-rendu chantier'}
          </h2>
          <p className="text-xs text-muted-foreground">{subjectName}</p>
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
            <p className="text-xs text-muted-foreground tabular-nums text-center">
              {recording
                ? `Enregistrement… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                : audioName
                ? `Audio importé : ${audioName}`
                : audioBlob
                ? `Note enregistrée (${elapsed}s) — réenregistrer ?`
                : 'Dicter le compte-rendu'}
            </p>
            {!recording && (
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                <FileAudio className="h-3.5 w-3.5" />
                {audioName ? 'Changer le fichier audio' : 'Importer un fichier audio'}
                <input type="file" accept="audio/*" className="sr-only"
                  onChange={(e) => { importAudio(e.target.files?.[0] ?? null); e.target.value = '' }} />
              </label>
            )}

            {/* Aide-mémoire : ce qu'il faut penser à dire pour une bonne mémoire.
                Affiché tant qu'on n'a pas encore d'audio (sinon on libère la place). */}
            {!recording && !audioBlob && (
              <div className="mt-1 w-full rounded-lg bg-muted/30 px-3 py-2 text-left">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/70">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                  Pensez à dire, en parlant naturellement&nbsp;:
                </div>
                <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
                  <li>• La <span className="text-foreground/70">date</span> et qui était <span className="text-foreground/70">présent (ou absent)</span></li>
                  <li>• Les <span className="text-foreground/70">{reportType === 'contract' ? 'bâtiments / sites' : 'zones'}</span> concernés</li>
                  <li>• Les <span className="text-foreground/70">problèmes et blocages</span> (qui attend quoi)</li>
                  <li>• Les <span className="text-foreground/70">décisions</span> et ce qu&apos;il <span className="text-foreground/70">reste à faire</span></li>
                  <li>• Les <span className="text-foreground/70">livraisons</span> et <span className="text-foreground/70">contrôles</span> prévus (dates)</li>
                </ul>
              </div>
            )}
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
      {step === 'working' && <WorkingView message={working} />}

      {/* ── SAUVEGARDÉ (transcription/analyse indisponible — rien n'est perdu) ── */}
      {step === 'saved' && (
        <div className="space-y-4 py-4 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <p className="text-sm font-medium">Compte-rendu sauvegardé</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">{savedNote}</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-foreground/30 px-4 py-2.5 text-sm font-medium hover:bg-muted/40"
            >
              <Sparkles className="h-4 w-4" /> Réessayer maintenant
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-foreground text-background py-2.5 text-sm font-medium"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── CURATION ── */}
      {step === 'curation' && (
        <SiteReportCuration
          reportId={reportId!}
          siteId={siteId ?? null}
          candidateSites={candidateSites}
          proposals={proposals}
          existingMissions={missions}
          meetingNumber={meetingNumber}
          openActions={openActions}
          reportDates={reportDates}
          participants={participants}
          risks={risks}
          priorUpdates={priorUpdates}
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

// Vue d'attente avec barre de progression : l'IA peut mettre plusieurs secondes.
// La barre « monte » de façon temporelle (jamais un vrai % — on ne ment pas) et
// se cale sur la phase courante. Pendant l'analyse, on déroule les sous-étapes
// que l'IA traverse pour que l'utilisateur voie ce qui se passe.
const ANALYSIS_SUBSTEPS = [
  'Lecture du compte-rendu…',
  'Identification des présents…',
  'Détection des décisions…',
  'Routage par bâtiment / site…',
  'Repérage des blocages et dépendances…',
  'Comparaison avec la réunion précédente…',
]

function WorkingView({ message }: { message: string }) {
  const isAnalysis = message.toLowerCase().startsWith('analyse')
  const [pct, setPct] = useState(8)
  const [subIdx, setSubIdx] = useState(0)

  // Progression temporelle qui s'approche de ~92 % puis attend la fin réelle.
  useEffect(() => {
    const id = setInterval(() => {
      setPct((p) => (p < 92 ? p + Math.max(0.4, (92 - p) * 0.05) : p))
    }, 200)
    return () => clearInterval(id)
  }, [])

  // Défilement des sous-étapes pendant l'analyse IA.
  useEffect(() => {
    if (!isAnalysis) return
    const id = setInterval(() => setSubIdx((i) => (i + 1) % ANALYSIS_SUBSTEPS.length), 2200)
    return () => clearInterval(id)
  }, [isAnalysis])

  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{message}</p>

      <div className="w-full max-w-xs">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {isAnalysis && (
        <p className="text-xs text-muted-foreground text-center min-h-4 transition-opacity">
          {ANALYSIS_SUBSTEPS[subIdx]}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground/70 text-center max-w-xs">
        Quelques secondes — ne fermez pas la fenêtre.
      </p>
    </div>
  )
}
