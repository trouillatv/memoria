'use client'

// Capture multimodale d'un compte-rendu de chantier : voix + texte + photos +
// pièces jointes. Machine d'états : capture → transcription → relecture →
// analyse → curation → terminé.
//
// Fondation « la réunion est l'objet » (Vincent 2026-07-10) :
//   - la réunion EXISTE dès le premier geste (avant toute source) ;
//   - l'audio n'est pas UN fichier : une réunion accepte zéro, un ou plusieurs
//     enregistrements (segments in-app + enregistrement du téléphone), chacun
//     avec son origine et ses horaires ;
//   - le chrono est calculé sur HORODATAGES, jamais sur une minuterie qui
//     s'incrémente — c'est la minuterie qui gèle en arrière-plan, pas l'horloge.
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
  startMeetingAction,
  setReportTextInputAction,
  createReportAudioUploadAction,
  attachReportAudioAction,
  uploadReportAttachmentAction,
  transcribeReportAction,
  analyzeReportAction,
  getReportCurationContextAction,
} from './report-actions'
import { createClient } from '@/lib/supabase/client'
import { SiteReportCuration } from './SiteReportCuration'

interface Props {
  reportType?: 'site' | 'contract'
  siteId?: string
  siteName?: string
  contractId?: string
  contractName?: string
  /** Reprise d'une réunion déjà commencée (carte « en attente » du Journal). */
  initialReportId?: string | null
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

// Un ENREGISTREMENT de la réunion (segment in-app ou fichier ajouté). Chaque
// segment devient une SOURCE côté serveur : origine + horaires + durée + statut.
interface LocalAudioSegment {
  id: string
  blob: Blob
  mime: string
  /** Nom de fichier quand l'enregistrement vient du téléphone. */
  name: string | null
  origin: 'memoria' | 'import'
  /** Horaires réels de capture (ISO) — connus pour la capture in-app. */
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number
  uploaded: boolean
}

const FR = new Intl.NumberFormat('fr-FR')

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

// Wake Lock : type minimal pour ne pas dépendre de la présence de
// WakeLockSentinel dans la lib DOM du projet.
type WakeLockLike = { release: () => Promise<void> }

export function SiteReportPanel({
  reportType = 'site', siteId, siteName, contractId, contractName, initialReportId, onClose,
}: Props) {
  const router = useRouter()
  const subjectName = reportType === 'contract' ? (contractName ?? 'Contrat') : (siteName ?? 'Chantier')
  const [step, setStep] = useState<Step>('capture')
  const [working, setWorking] = useState<string>('')
  const [reportId, setReportId] = useState<string | null>(initialReportId ?? null)

  // Capture
  const [recording, setRecording] = useState(false)
  // Vrai dès que l'enregistrement a PU être interrompu (passage en arrière-plan
  // ou micro suspendu par l'OS). Sert à dire la vérité à l'utilisateur plutôt
  // que de lui laisser croire qu'une heure a été captée.
  const [interrupted, setInterrupted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [segments, setSegments] = useState<LocalAudioSegment[]>([])
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
  const wakeLockRef = useRef<WakeLockLike | null>(null)
  // Retrait des écouteurs d'interruption (visibilitychange + piste morte),
  // installés le temps d'un enregistrement.
  const recordingListenersRef = useRef<(() => void) | null>(null)
  // Chrono par HORODATAGE : l'instant de départ fait foi ; l'intervalle ne sert
  // qu'à rafraîchir l'affichage (il peut geler en arrière-plan, pas l'horloge).
  const recordStartRef = useRef<number | null>(null)
  // Les segments, en miroir hors-render : source de vérité pour l'upload (les
  // callbacks MediaRecorder et la transition async ne voient pas l'état frais).
  const segmentsRef = useRef<LocalAudioSegment[]>([])
  // La réunion est créée UNE fois, au premier geste — jamais en double.
  const reportIdRef = useRef<string | null>(initialReportId ?? null)
  const ensureReportPromiseRef = useRef<Promise<string | null> | null>(null)
  // Résolution d'un stop en attente : l'onstop du MediaRecorder est asynchrone,
  // « Analyser » doit attendre que le dernier segment soit réellement flushé.
  const stopWaitersRef = useRef<Array<() => void>>([])

  // La réunion EXISTE dès le premier geste (fondation « réunion = objet »).
  // Idempotent et partagé : enregistrement, photo, pièce → même création.
  function ensureReport(): Promise<string | null> {
    if (reportIdRef.current) return Promise.resolve(reportIdRef.current)
    if (!ensureReportPromiseRef.current) {
      ensureReportPromiseRef.current = startMeetingAction({
        report_type: reportType,
        site_id: reportType === 'site' ? siteId : undefined,
        contract_id: reportType === 'contract' ? contractId : undefined,
      })
        .then((r) => {
          if (r.ok) {
            reportIdRef.current = r.reportId
            setReportId(r.reportId)
            return r.reportId
          }
          ensureReportPromiseRef.current = null // nouvel essai au prochain geste
          return null
        })
        .catch(() => {
          ensureReportPromiseRef.current = null
          return null
        })
    }
    return ensureReportPromiseRef.current
  }

  function addSegment(seg: LocalAudioSegment) {
    segmentsRef.current = [...segmentsRef.current, seg]
    setSegments(segmentsRef.current)
  }
  function patchSegment(id: string, patch: Partial<LocalAudioSegment>) {
    segmentsRef.current = segmentsRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s))
    setSegments(segmentsRef.current)
  }
  function removeSegment(id: string) {
    segmentsRef.current = segmentsRef.current.filter((s) => s.id !== id)
    setSegments(segmentsRef.current)
  }

  // Empêche l'écran de s'éteindre pendant l'enregistrement : c'est le
  // déclencheur n°1 du gel de page (et donc de la perte d'audio) sur mobile.
  // Best-effort — absent de certains navigateurs, on dégrade proprement.
  async function acquireWakeLock() {
    try {
      const wl = (navigator as Navigator & {
        wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> }
      }).wakeLock
      if (wl && !wakeLockRef.current) wakeLockRef.current = await wl.request('screen')
    } catch { /* refusé ou non supporté — le bandeau d'honnêteté prend le relais */ }
  }
  function releaseWakeLock() {
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    recordingListenersRef.current?.()
    releaseWakeLock()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    attachments.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Le micro est ouvert : la réunion commence — l'objet existe dès maintenant
      // (visible au Journal, reprenable), avant même la première seconde d'audio.
      void ensureReport()
      streamRef.current = stream
      chunksRef.current = []
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'
      const mr = new MediaRecorder(stream, { mimeType: mime })
      mediaRecorderRef.current = mr
      const startedAtMs = Date.now()
      recordStartRef.current = startedAtMs
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        const endedAtMs = Date.now()
        const blob = new Blob(chunksRef.current, { type: mime })
        if (blob.size > 0) {
          // Ce segment devient un ENREGISTREMENT de la réunion, avec ses
          // horaires réels — s'il y a relais vers l'enregistreur du téléphone,
          // le chevauchement à la jonction restera détectable.
          addSegment({
            id: crypto.randomUUID(),
            blob,
            mime,
            name: null,
            origin: 'memoria',
            startedAt: new Date(startedAtMs).toISOString(),
            endedAt: new Date(endedAtMs).toISOString(),
            durationSeconds: Math.max(1, Math.round((endedAtMs - startedAtMs) / 1000)),
            uploaded: false,
          })
        } else {
          // Enregistrement vide (micro muet, ou MediaRecorder mobile capricieux).
          // On le dit clairement + on laisse les fallbacks : autre enregistrement / texte.
          toast.error('Enregistrement vide. Vérifiez le micro (autorisation), ou ajoutez l’enregistrement du téléphone / saisissez le texte.')
        }
        recordStartRef.current = null
        // Libère les « Analyser » en attente du flush.
        stopWaitersRef.current.forEach((resolve) => resolve())
        stopWaitersRef.current = []
      }
      // Sans timeslice : plus fiable sur iOS/Safari (les chunks arrivent au stop).
      mr.start()
      setRecording(true)
      setInterrupted(false)
      setElapsed(0)
      // Affichage recalculé depuis l'horodatage : après un gel en arrière-plan,
      // le chrono se recale tout seul au retour — il ne « perd » jamais de temps.
      timerRef.current = setInterval(() => {
        const start = recordStartRef.current
        if (start != null) setElapsed(Math.round((Date.now() - start) / 1000))
      }, 1000)

      // Garde-fous « arrière-plan » : on ne peut pas enregistrer de façon fiable
      // écran éteint / app en fond, mais on peut (1) empêcher l'écran de
      // s'éteindre, (2) sauver ce qui est capté si l'OS coupe le micro, et
      // (3) le dire honnêtement.
      await acquireWakeLock()

      const track = stream.getAudioTracks()[0]
      const onTrackEnded = () => {
        // L'OS a coupé le micro (verrouillage/arrière-plan prolongé). On ne peut
        // plus rien capter : on arrête pour FLUSHER l'audio déjà enregistré,
        // et on prévient. Le stop() ci-dessous délivre les chunks bufferisés.
        setInterrupted(true)
        toast.warning('Enregistrement interrompu (micro suspendu par le téléphone). Les minutes captées sont conservées comme enregistrement de la réunion — poursuivez avec l’enregistreur du téléphone si besoin.')
        stopRecording()
      }
      track?.addEventListener('ended', onTrackEnded)

      const onVisibility = () => {
        const active = mediaRecorderRef.current?.state === 'recording'
        if (!active) return
        if (document.hidden) {
          // Passage en arrière-plan : le navigateur PEUT geler la page et
          // suspendre le micro. On ne peut pas l'empêcher — on avertit.
          setInterrupted(true)
        } else {
          // Retour au premier plan : le Wake Lock est libéré automatiquement
          // quand la page est masquée, on le redemande.
          void acquireWakeLock()
        }
      }
      document.addEventListener('visibilitychange', onVisibility)

      recordingListenersRef.current = () => {
        track?.removeEventListener('ended', onTrackEnded)
        document.removeEventListener('visibilitychange', onVisibility)
        recordingListenersRef.current = null
      }
    } catch {
      toast.error('Micro inaccessible — autorisez le microphone, ou ajoutez l’enregistrement du téléphone / saisissez le texte.')
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    recordingListenersRef.current?.()
    releaseWakeLock()
    const mr = mediaRecorderRef.current
    if (mr?.state === 'recording') {
      try { mr.requestData() } catch { /* certains navigateurs n'exposent pas requestData */ }
      mr.stop()
    }
    setRecording(false)
  }

  // L'onstop du MediaRecorder est asynchrone : « Analyser » pendant un
  // enregistrement doit ATTENDRE le flush du segment, sinon il partirait sans.
  function stopRecordingAndWait(): Promise<void> {
    if (mediaRecorderRef.current?.state !== 'recording') {
      if (recording) setRecording(false)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      let settled = false
      const once = () => { if (!settled) { settled = true; resolve() } }
      stopWaitersRef.current.push(once)
      stopRecording()
      // Filet : si l'onstop ne vient jamais (navigateur capricieux), on repart
      // quand même — les segments déjà flushés partent, rien ne reste bloqué.
      setTimeout(once, 4000)
    })
  }

  // Ajouter l'enregistrement du téléphone (ou tout fichier audio) : une source
  // de plus pour la réunion — jamais un remplacement, jamais un « import ».
  function addExternalAudio(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('audio/')) { toast.error('Enregistrement audio attendu (mp3, m4a, wav…)'); return }
    if (recording) stopRecording()
    void ensureReport()
    const id = crypto.randomUUID()
    addSegment({
      id,
      blob: file,
      mime: file.type || 'audio/mpeg',
      name: file.name,
      origin: 'import',
      // Horaires inconnus pour un fichier ajouté — on ne les invente pas.
      startedAt: null,
      endedAt: null,
      durationSeconds: 0,
      uploaded: false,
    })
    try {
      const url = URL.createObjectURL(file)
      const probe = new Audio()
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => {
        // Durée réelle du fichier, sans plafond : une réunion peut durer 2 h.
        if (Number.isFinite(probe.duration)) {
          patchSegment(id, { durationSeconds: Math.round(probe.duration) })
        }
        URL.revokeObjectURL(url)
      }
      probe.onerror = () => URL.revokeObjectURL(url)
      probe.src = url
    } catch { /* durée optionnelle */ }
  }

  function addFiles(files: FileList | null, kind: 'photo' | 'file') {
    if (!files) return
    void ensureReport()
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

  // ── Analyser : la réunion existe déjà (ou est créée là) → texte d'abord →
  //    enregistrements (chacun = une source, avec origine et horaires) → pièces →
  //    transcription de toutes les sources → analyse → curation. Si la
  //    transcription ou l'IA échoue, tout est DÉJÀ sauvegardé : écran
  //    « sauvegardé » (réessai possible), rien n'est perdu.
  function handleAnalyze() {
    // Feedback INSTANTANÉ : on bascule sur l'écran de chargement avant même le
    // transition async, pour qu'un clic se voie toujours (jamais « rien »).
    setWorking('Enregistrement du compte-rendu…')
    setStep('working')
    startTransition(async () => {
      try {
        // 0. Si un enregistrement est en cours : attendre son flush — le dernier
        //    segment part avec le reste, jamais « oublié » par la course onstop.
        await stopRecordingAndWait()

        // 1. La réunion (créée au premier geste ; filet si le geste a échoué).
        const rid = reportIdRef.current ?? (await ensureReport())
        if (!rid) {
          toast.error('Connexion impossible — rien n’a été envoyé. Réessayez.')
          setStep('capture')
          return
        }
        setReportId(rid)

        // 2. Le texte saisi part EN PREMIER — persisté, jamais perdu.
        if (text.trim()) {
          await setReportTextInputAction({ report_id: rid, text_input: text.trim() })
        }

        // 3. Les enregistrements → upload DIRECT au stockage (URL signée, la
        //    limite 20 Mo des Server Actions ne s'applique pas). Chaque segment
        //    devient une SOURCE de la réunion. Best-effort par source.
        const segs = segmentsRef.current
        let hasAudio = false
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i]
          if (seg.uploaded) { hasAudio = true; continue }
          setWorking(segs.length > 1 ? `Envoi des enregistrements (${i + 1}/${segs.length})…` : 'Envoi de l’audio…')
          try {
            const prep = await createReportAudioUploadAction({ report_id: rid, mime: seg.mime })
            if (!prep.ok) continue
            const supa = createClient()
            const { error: upErr } = await supa.storage
              .from('site-reports')
              .uploadToSignedUrl(prep.storagePath, prep.token, seg.blob, { contentType: seg.mime })
            if (upErr) continue
            const reg = await attachReportAudioAction({
              report_id: rid,
              storage_path: prep.storagePath,
              mime: seg.mime,
              duration_seconds: seg.durationSeconds,
              size_bytes: seg.blob.size,
              label: seg.origin === 'memoria' ? 'Enregistré dans MemorIA' : (seg.name ?? 'Enregistrement du téléphone'),
              source_origin: seg.origin,
              recorded_started_at: seg.startedAt ?? undefined,
              recorded_ended_at: seg.endedAt ?? undefined,
            })
            if (reg.ok) {
              patchSegment(seg.id, { uploaded: true })
              hasAudio = true
            }
          } catch { /* audio best-effort — les autres sources continuent */ }
        }
        if (segs.length > 0 && !hasAudio) {
          toast.warning('Les enregistrements n’ont pas pu être envoyés — le compte-rendu texte est sauvegardé. Vous pourrez réessayer.')
        }

        // 4. Upload des pièces
        const pending = attachments.filter((a) => !a.uploaded)
        if (pending.length > 0) {
          setWorking(`Envoi des pièces (${pending.length})…`)
          for (const a of pending) {
            const file = filesRef.current.get(a.clientUuid)
            if (!file) continue
            const afd = new FormData()
            afd.set('report_id', rid)
            afd.set('kind', a.kind)
            afd.set('client_uuid', a.clientUuid)
            afd.set('file', file)
            await uploadReportAttachmentAction(afd)
          }
        }

        // 5. Transcription : toutes les sources de la réunion (y compris celles
        //    d'une réunion reprise, déjà en base).
        let transcriptText = ''
        if (hasAudio || initialReportId) {
          setWorking('Transcription des enregistrements…')
          const tr = await transcribeReportAction(rid)
          if (tr.ok) transcriptText = tr.transcript
        }

        // 6. Rien à analyser (transcription échouée + pas de texte saisi) → on
        //    s'arrête proprement : tout est sauvegardé, on reprendra plus tard.
        const hasContent = transcriptText.trim().length > 0 || text.trim().length > 0
        if (!hasContent) {
          setSavedNote(
            hasAudio
              ? "Enregistrements sauvegardés, mais la transcription n'a pas pu se faire (service IA indisponible). La réunion est conservée — vous pourrez la reprendre plus tard."
              : 'Compte-rendu sauvegardé.',
          )
          setStep('saved')
          return
        }

        // 7. Analyse directe → curation (plus d'écran de relecture).
        const ok = await runAnalysis(rid, transcriptText)
        if (!ok) {
          setSavedNote("Le compte-rendu et les enregistrements sont sauvegardés, mais l'analyse n'a pas pu se faire. Réessayez dans un moment.")
          setStep('saved')
          return
        }
        setStep('curation')
      } catch (e) {
        // Filet ultime : aucune erreur ne doit laisser le bouton « sans réponse ».
        toast.error(e instanceof Error ? e.message : 'Une erreur est survenue')
        if (reportIdRef.current) {
          setSavedNote("Une erreur est survenue, mais la réunion (et ses enregistrements envoyés) est sauvegardée. Réessayez dans un moment.")
          setStep('saved')
        } else {
          setStep('capture')
        }
      }
    })
  }

  // Réessayer depuis l'écran « sauvegardé » : re-transcrire (audio en base) puis analyser.
  function handleRetry() {
    if (!reportId) return
    startTransition(async () => {
      try {
        setStep('working')
        let transcriptText = ''
        setWorking('Nouvelle tentative de transcription…')
        const tr = await transcribeReportAction(reportId)
        if (tr.ok) transcriptText = tr.transcript
        const hasContent = transcriptText.trim().length > 0 || text.trim().length > 0
        if (!hasContent) {
          setSavedNote("Toujours indisponible. Les enregistrements restent sauvegardés — réessayez plus tard.")
          setStep('saved')
          return
        }
        const ok = await runAnalysis(reportId, transcriptText)
        setStep(ok ? 'curation' : 'saved')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Une erreur est survenue')
        setSavedNote("Une erreur est survenue. Les enregistrements restent sauvegardés — réessayez plus tard.")
        setStep('saved')
      }
    })
  }

  const totalRecorded = segments.reduce((s, x) => s + x.durationSeconds, 0)
  const canAnalyze = segments.length > 0 || text.trim().length > 0 || attachments.length > 0 || !!initialReportId

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
          {/* Réunion reprise depuis le Journal : elle n'a jamais cessé d'exister. */}
          {initialReportId && (
            <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-[11px] text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
              Votre réunion est toujours en cours. Ajoutez l’enregistrement réalisé avec votre téléphone (ou d’autres pièces), puis analysez.
            </div>
          )}

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
                ? `Enregistrement… ${fmtClock(elapsed)}`
                : segments.length > 0
                ? `${segments.length} enregistrement${segments.length > 1 ? 's' : ''} · ${fmtClock(totalRecorded)} — en ajouter un autre ?`
                : 'Dicter le compte-rendu'}
            </p>
            {recording && (
              <p className="text-[11px] text-muted-foreground text-center">
                Gardez l’écran allumé. Si la réunion se prolonge, poursuivez avec l’enregistreur du téléphone — vous ajouterez l’enregistrement au retour, et rien ne sera perdu : la réunion accepte plusieurs enregistrements.
              </p>
            )}
            {interrupted && (
              <div className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                L’enregistrement a pu être interrompu (écran verrouillé ou app en arrière-plan). Les minutes captées sont conservées ; au besoin, poursuivez avec l’enregistreur du téléphone et ajoutez son enregistrement — la réunion réunira les deux.
              </div>
            )}
            {!recording && (
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer">
                <FileAudio className="h-3.5 w-3.5" />
                {segments.length > 0 ? 'Ajouter un autre enregistrement' : 'Ajouter l’enregistrement du téléphone'}
                <input type="file" accept="audio/*" className="sr-only"
                  onChange={(e) => { addExternalAudio(e.target.files?.[0] ?? null); e.target.value = '' }} />
              </label>
            )}

            {/* Cette réunion contient — les enregistrements sont visibles et
                contrôlables (origine, durée, retrait avant envoi). */}
            {segments.length > 0 && (
              <div className="w-full rounded-lg bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium text-foreground/70">Cette réunion contient&nbsp;:</p>
                <ul className="mt-1 space-y-1">
                  {segments.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                      <FileAudio className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {s.origin === 'memoria' ? 'Enregistré dans MemorIA' : (s.name ?? 'Enregistrement du téléphone')}
                      </span>
                      <span>{s.durationSeconds > 0 ? fmtClock(s.durationSeconds) : '…'}</span>
                      {!s.uploaded && (
                        <button
                          type="button"
                          onClick={() => removeSegment(s.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Retirer cet enregistrement"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Aide-mémoire : ce qu'il faut penser à dire pour une bonne mémoire.
                Affiché tant qu'on n'a pas encore d'audio (sinon on libère la place). */}
            {!recording && segments.length === 0 && (
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

          {/* Pourquoi le bouton est inactif : il faut du contenu à analyser. */}
          {!canAnalyze && !recording && (
            <p className="text-[11px] text-center text-muted-foreground">
              Pour analyser : enregistrez une note vocale (autorisez le micro), <span className="font-medium">ajoutez l’enregistrement du téléphone</span>, ou saisissez du texte.
            </p>
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
