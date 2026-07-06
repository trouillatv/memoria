'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Camera, Video, Mic, Pencil, Target, MapPin, Square, Radio, X, Trash2, Loader2, Check, ChevronLeft, ChevronRight, Star, HelpCircle, CloudUpload, AlertCircle, Play, ImagePlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { endVisitAction } from './visit-actions'
import {
  addNoteCaptureAction,
  addVerificationCaptureAction,
  addPositionCaptureAction,
  removeCaptureAction,
  setCaptureStarAction,
  addQuestionCaptureAction,
  listVisitCapturesAction,
  listVisitCapturePreviewsAction,
  revalidateSiteMobile,
  createVisitVideoUploadAction,
  registerVisitVideoAction,
  addPhotoCaptureAction,
} from './capture-actions'
import { uploadReportAttachmentAction } from './report-actions'
import { PhotoAnnotator } from './PhotoAnnotator'
import { queueVisitCapture, listQueuedVisitCapturesByReport } from '@/lib/field/visit-capture-queue'
import { compressImageFile } from '@/lib/field/image-compress'
import { useVisitCaptureUploader } from '@/lib/field/use-visit-capture-uploader'
import { createClient } from '@/lib/supabase/client'

// La vidéo s'upload en direct vers Supabase (URL signée), bornée par la limite du
// bucket (mig 181). Au-delà : message clair plutôt qu'un échec silencieux.
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
// Préférence géoloc mémorisée sur l'appareil : 'always' = ne plus demander.
const GEO_PREF_KEY = 'memoria.geoloc.captures'
import type { VisitCaptureRow, VisitCaptureKind } from '@/lib/db/visit-captures'

// Mémoire LITE d'un point suivi (read-only), surfacée pendant la vérification :
// « voilà ce qu'on sait déjà sur ce point ». Aucune donnée nouvelle, agrégée par
// listSubjectsBySite côté serveur.
export type SubjectMemoryLite = {
  lastActivityDays: number | null
  openReserves: number
  openActions: number
  lateActions: number
  decisions: number
  criticality: string
}

// Une capture média déposée localement, en attente de confirmation serveur (Lot B).
// previewUrl = objectURL pour la vignette photo/vidéo (null pour un vocal).
type PendingCapture = {
  clientUuid: string
  kind: 'photo' | 'video' | 'vocal'
  previewUrl: string | null
  takenAt: number
}

/**
 * « Visite en cours » — le PANIER terrain (temps 1 des 3, cf. [[visite-trois-temps]]).
 * On ne réfléchit pas : on collecte. 4 gestes + position, une pression, retour
 * immédiat. AUCUNE qualification ici (ni « passage/anomalie », ni destination) :
 * le tri se fait plus tard (voiture puis bureau). L'IA se tait.
 */
export function VisitBasket({
  reportId,
  siteId,
  userId,
  startedAt,
  subjects,
  subjectMemory,
  initialCaptures,
}: {
  reportId: string
  siteId: string
  /** L'agent courant — tague les dépôts locaux (anti cross-compte au drain). */
  userId: string
  startedAt: string | null
  subjects: Array<{ id: string; name: string }>
  subjectMemory: Record<string, SubjectMemoryLite>
  initialCaptures: VisitCaptureRow[]
}) {
  const router = useRouter()
  const [captures, setCaptures] = useState<VisitCaptureRow[]>(initialCaptures)
  // Aperçus signés (photo/vidéo) — la mémoire VISUELLE de la visite : une vignette
  // rappelle « la façade » d'un coup d'œil, sans lire une liste d'horodatages.
  const [previews, setPreviews] = useState<Record<string, { url: string; mime: string | null }>>({})
  // Plein écran d'une capture (standard : un clic = grand). null = fermé.
  const [lightbox, setLightbox] = useState<VisitCaptureRow | null>(null)
  // Photo en cours d'annotation (URL signée) — l'annotée s'ajoute EN PLUS.
  const [annotate, setAnnotate] = useState<{ id: string; url: string } | null>(null)
  // Lot B — captures déposées localement, pas encore confirmées par le serveur.
  // Affichées en optimiste DANS la timeline pour que la collecte ne s'arrête jamais.
  const [pending, setPending] = useState<PendingCapture[]>([])
  const [overlay, setOverlay] = useState<'none' | 'note' | 'verify' | 'question'>('none')
  const [note, setNote] = useState('')
  // ❓ Question ouverte (« à vérifier ») : sur une capture (questionCaptureId) ou libre.
  const [questionText, setQuestionText] = useState('')
  const [questionCaptureId, setQuestionCaptureId] = useState<string | null>(null)
  const [questionCount, setQuestionCount] = useState(0)
  const [verifIndex, setVerifIndex] = useState(0)
  const [verifNote, setVerifNote] = useState('')
  const touchStartX = useRef<number | null>(null)
  const [busy, startBusy] = useTransition()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Géoloc des OBSERVATIONS (jamais de la personne) : position PONCTUELLE par
  // capture, best-effort, jamais bloquante, jamais de trace continue. Le choix se
  // fait UNE fois (prompt), et « Toujours oui » est mémorisé sur l'appareil — on
  // ne repose plus la question. Cf. [[ouverture-contextuelle-gps]].
  const [geoTag, setGeoTag] = useState(false)
  const [geoDecided, setGeoDecided] = useState(false)
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(GEO_PREF_KEY) === 'always') {
        setGeoTag(true)
        setGeoDecided(true)
      }
    } catch { /* localStorage indisponible → on demandera cette visite */ }
  }, [])
  function chooseGeo(mode: 'session' | 'always' | 'no') {
    if (mode === 'always') {
      try { window.localStorage.setItem(GEO_PREF_KEY, 'always') } catch { /* ignore */ }
      setGeoTag(true)
    } else {
      setGeoTag(mode === 'session')
    }
    setGeoDecided(true)
  }
  function disableGeo() {
    try { window.localStorage.removeItem(GEO_PREF_KEY) } catch { /* ignore */ }
    setGeoTag(false)
  }
  function getOneShotPosition(): Promise<{ lat: number; lng: number } | null> {
    if (!geoTag || typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 },
      )
    })
  }

  const subjectName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? 'point suivi'
  const kept = captures.filter((c) => c.status !== 'discarded')
  // Compteurs clairs par type — « 3 photos · 1 vidéo » plutôt qu'une liste.
  const mediaCount = {
    photo: kept.filter((c) => c.kind === 'photo').length,
    video: kept.filter((c) => c.kind === 'video').length,
    vocal: kept.filter((c) => c.kind === 'vocal').length,
    note: kept.filter((c) => c.kind === 'note').length,
  }
  // Dé-doublonnage optimiste : une capture en attente disparaît dès que sa vraie
  // ligne (même client_uuid) revient du serveur.
  const serverUuids = new Set(kept.map((c) => c.client_uuid).filter((u): u is string => !!u))
  const visiblePending = pending.filter((p) => !serverUuids.has(p.clientUuid))
  const pendingSyncCount = visiblePending.length

  // État d'un dépôt en attente, lu sur la file + le drain en cours.
  function pendingStatus(p: PendingCapture): 'uploading' | 'failed' | 'queued' {
    if (uploadingUuid === p.clientUuid) return 'uploading'
    const q = queued.find((x) => x.clientUuid === p.clientUuid)
    if (q && q.attempts > 0) return 'failed'
    if (!q) return 'uploading' // retiré de la file : confirmation serveur imminente
    return 'queued'
  }
  // Points suivis déjà vérifiés pendant CETTE visite (progression + ✓). Dérivé des
  // captures : aucune donnée nouvelle.
  const verifiedSubjectIds = new Set(
    kept.filter((c) => c.kind === 'verification' && c.subject_id).map((c) => c.subject_id as string),
  )

  // Chrono de la visite.
  useEffect(() => {
    if (!startedAt) return
    const start = new Date(startedAt).getTime()
    const tick = () => {
      const m = Math.max(0, Math.floor((Date.now() - start) / 60000))
      setElapsed(m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`)
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [startedAt])

  const refresh = useCallback(async () => {
    try {
      const [caps, prev] = await Promise.all([
        listVisitCapturesAction(reportId),
        listVisitCapturePreviewsAction(reportId).catch(() => ({})),
      ])
      setCaptures(caps)
      setPreviews(prev)
    } catch { /* silencieux */ }
  }, [reportId])

  // Dès que le serveur a confirmé une capture (drain réussi), on retire sa
  // vignette « en attente » et on tire la vraie ligne depuis la base. Le drain
  // (file IndexedDB → serveur) tourne en fond ici ET globalement (layout).
  const onUploaded = useCallback((clientUuid: string) => {
    setPending((prev) => {
      const found = prev.find((p) => p.clientUuid === clientUuid)
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl)
      return prev.filter((p) => p.clientUuid !== clientUuid)
    })
    void refresh()
  }, [refresh])

  const { queued, uploadingUuid, syncNow } = useVisitCaptureUploader({ reportId, userId, onUploaded })

  // Libère les object URLs des vignettes encore en attente quand on quitte le
  // panier (la file IndexedDB, elle, persiste : le drain global continue).
  const pendingRef = useRef<PendingCapture[]>([])
  useEffect(() => { pendingRef.current = pending }, [pending])
  useEffect(() => () => {
    pendingRef.current.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl) })
  }, [])

  // REPRISE APRÈS FERMETURE DE L'APP : on reconstitue l'état « en attente » du
  // panier depuis la file persistante. L'optimiste en mémoire (vignettes) est
  // perdu à la fermeture, mais les médias, eux, sont en sécurité dans IndexedDB.
  // Sans ça, une photo prise à 8h et pas encore montée restait invisible à la
  // réouverture jusqu'à sa synchro (data SAFE, mais panier incomplet). On
  // régénère les vignettes depuis les blobs stockés.
  useEffect(() => {
    let alive = true
    listQueuedVisitCapturesByReport(reportId).then((entries) => {
      if (!alive || entries.length === 0) return
      setPending((prev) => {
        const known = new Set(prev.map((p) => p.clientUuid))
        const confirmed = new Set(initialCaptures.map((c) => c.client_uuid).filter((u): u is string => !!u))
        const additions: PendingCapture[] = entries
          .filter((e) => !known.has(e.clientUuid) && !confirmed.has(e.clientUuid))
          .map((e) => ({
            clientUuid: e.clientUuid,
            kind: e.kind,
            previewUrl: e.kind === 'vocal' ? null : URL.createObjectURL(e.blob),
            takenAt: e.takenAt,
          }))
        return additions.length ? [...prev, ...additions] : prev
      })
    }).catch(() => { /* IndexedDB indispo : on s'appuie sur le serveur seul */ })
    return () => { alive = false }
  }, [reportId, initialCaptures])

  // Le transcript d'un vocal arrive en arrière-plan : tant qu'un mémo est en cours
  // de transcription, on rafraîchit doucement pour le faire apparaître tout seul.
  const hasPendingTranscript = kept.some((c) => c.kind === 'vocal' && c.transcript_status === 'pending')
  useEffect(() => {
    if (!hasPendingTranscript) return
    const id = setInterval(() => {
      listVisitCapturesAction(reportId).then(setCaptures).catch(() => { /* silencieux */ })
    }, 4000)
    return () => clearInterval(id)
  }, [hasPendingTranscript, reportId])

  // ── Dépôt local d'un média (photo/vidéo/vocal) — LA CAPTURE NE BLOQUE JAMAIS ──
  // Règle d'or du Lot B : on affiche la capture immédiatement (optimiste), on la
  // pousse dans la file IndexedDB, et le drain de fond la monte avec retry réseau.
  // Aucun `await` réseau dans le geste : on rend la main tout de suite.
  function enqueueMedia(file: File, kind: 'photo' | 'video' | 'vocal') {
    const clientUuid = crypto.randomUUID()
    const previewUrl = kind === 'vocal' ? null : URL.createObjectURL(file)
    // 1) Optimiste, SYNCHRONE : la vignette apparaît dans la timeline sur-le-champ.
    setPending((prev) => [...prev, { clientUuid, kind, previewUrl, takenAt: Date.now() }])
    // 2) Persistance locale + position (opt-in) en tâche de fond — jamais bloquant.
    ;(async () => {
      const pos = await getOneShotPosition()
      // Photo : compression/redimensionnement AVANT la file (50 photos plein
      // format satureraient IndexedDB + upload + PDF). Non bloquant, non destructif.
      const blob = kind === 'photo' ? await compressImageFile(file) : file
      const ext = kind === 'photo' ? 'jpg' : kind === 'video' ? 'mp4' : 'webm'
      await queueVisitCapture({
        clientUuid, userId, reportId, siteId, kind,
        blob,
        filename: `${kind}-${clientUuid}.${ext}`,
        mimeType: blob.type || (kind === 'photo' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/webm'),
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
      })
      void syncNow()
    })().catch(() => {
      // Échec d'écriture locale (très rare) : on retire l'optimiste et on prévient.
      setPending((prev) => prev.filter((p) => p.clientUuid !== clientUuid))
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      toast.error('Échec de l’enregistrement local')
    })
  }

  // ── Photo ──────────────────────────────────────────────────────────────────
  function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    enqueueMedia(file, 'photo')
  }

  // ── Vidéo ──────────────────────────────────────────────────────────────────
  // PAS la file IndexedDB (trop lourde) ni le Server Action (limite 20 Mo) : la
  // vidéo s'envoie EN DIRECT au stockage via URL signée. Le geste reste non
  // bloquant (optimiste tout de suite, envoi en arrière-plan).
  function uploadVideoFile(file: File) {
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error('Vidéo trop lourde (max 50 Mo) — filme une séquence plus courte.')
      return
    }
    const clientUuid = crypto.randomUUID()
    const previewUrl = URL.createObjectURL(file)
    setPending((prev) => [...prev, { clientUuid, kind: 'video', previewUrl, takenAt: Date.now() }])
    const dropPending = () => setPending((prev) => {
      const f = prev.find((p) => p.clientUuid === clientUuid)
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl)
      return prev.filter((p) => p.clientUuid !== clientUuid)
    })
    ;(async () => {
      const pos = await getOneShotPosition()
      const prep = await createVisitVideoUploadAction({ report_id: reportId, client_uuid: clientUuid })
      if (!prep.ok) throw new Error(prep.error)
      if (!prep.alreadyDone) {
        const supa = createClient()
        const { error: upErr } = await supa.storage
          .from('site-reports')
          .uploadToSignedUrl(prep.storagePath, prep.token, file, { contentType: file.type || 'video/mp4' })
        if (upErr) throw new Error(upErr.message)
        const reg = await registerVisitVideoAction({
          report_id: reportId, site_id: siteId, client_uuid: clientUuid,
          storage_path: prep.storagePath, mime: file.type || 'video/mp4', size_bytes: file.size,
          lat: pos?.lat, lng: pos?.lng,
        })
        if (!reg.ok) throw new Error(reg.error)
      }
      dropPending()
      void refresh()
    })().catch(() => {
      dropPending()
      toast.error('Échec de l’envoi de la vidéo — réessaie.')
    })
  }

  function onVideoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) uploadVideoFile(file)
  }

  // ── Ajouter un média (galerie / fichier) ─────────────────────────────────────
  // Le conducteur n'a pas TOUJOURS l'appli pendant la visite : il reçoit des
  // photos/vidéos sur WhatsApp, prend des captures d'écran, etc. On accepte de
  // les IMPORTER dans la visite. Multi-sélection ; chaque fichier suit le même
  // pipeline que la capture live (photo → file IndexedDB, vidéo → envoi direct).
  function onGalleryFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    let added = 0
    for (const file of files) {
      if (file.type.startsWith('image/')) { enqueueMedia(file, 'photo'); added++ }
      else if (file.type.startsWith('video/')) { uploadVideoFile(file); added++ }
    }
    const skipped = files.length - added
    if (added > 0) toast.success(`${added} média${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}`, { duration: 1500 })
    if (skipped > 0) toast.error(`${skipped} fichier${skipped > 1 ? 's' : ''} ignoré${skipped > 1 ? 's' : ''} (photo/vidéo uniquement pour l'instant)`)
  }

  // ── Annotation ───────────────────────────────────────────────────────────────
  // L'image annotée s'ajoute EN PLUS de l'original (nouvelle capture photo) — on
  // ne détruit jamais la preuve. Upload direct (pièce du report) + capture.
  async function saveAnnotation(file: File, replaceOriginal: boolean) {
    if (!annotate) return
    try {
      const pos = geoTag ? await getOneShotPosition() : null
      const fd = new FormData()
      fd.set('report_id', reportId)
      fd.set('kind', 'photo')
      fd.set('client_uuid', crypto.randomUUID())
      fd.set('file', file)
      const up = await uploadReportAttachmentAction(fd)
      if (!up.ok) { toast.error(up.error); return }
      const cap = await addPhotoCaptureAction({
        report_id: reportId, site_id: siteId, attachment_id: up.attachmentId,
        // Photo annotée = photo clé d'office (prioritaire dans le CR).
        starred: true,
        // « Remplacer l'affichage » → archive l'original (jamais supprimé).
        ...(replaceOriginal ? { replaces_capture_id: annotate.id } : {}),
        lat: pos?.lat, lng: pos?.lng,
      })
      if (!cap.ok) { toast.error(cap.error); return }
      setAnnotate(null)
      setLightbox(null)
      toast.success('Photo annotée ajoutée', { duration: 1500 })
      void refresh()
    } catch {
      toast.error('Échec de l’enregistrement de l’annotation')
    }
  }

  // ── Vocal ──────────────────────────────────────────────────────────────────
  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const mime = rec.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mime })
        // Même règle que photo/vidéo : dépôt local immédiat, montée en fond. La
        // transcription est déclenchée par le drain après confirmation serveur.
        enqueueMedia(new File([blob], 'memo.webm', { type: mime }), 'vocal')
      }
      rec.start()
      recorderRef.current = rec
      setRecording(true)
    } catch {
      toast.error('Micro indisponible')
    }
  }
  function stopRec() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  // ── Note ───────────────────────────────────────────────────────────────────
  function saveNote() {
    const body = note.trim()
    if (body.length < 1) return
    startBusy(async () => {
      const pos = await getOneShotPosition()
      const r = await addNoteCaptureAction({ report_id: reportId, site_id: siteId, body, lat: pos?.lat, lng: pos?.lng })
      if (r.ok) { setNote(''); setOverlay('none'); toast.success('Note ajoutée', { duration: 1200 }); refresh() }
      else toast.error(r.error)
    })
  }

  // ── Question ouverte (❓ « à vérifier ») — sur une capture ou libre ──────────
  function openQuestion(captureId: string | null) {
    setQuestionCaptureId(captureId)
    setQuestionText('')
    setOverlay('question')
  }
  function saveQuestion() {
    const body = questionText.trim()
    if (body.length < 1) return
    startBusy(async () => {
      const r = await addQuestionCaptureAction({
        report_id: reportId, site_id: siteId, body,
        capture_id: questionCaptureId ?? undefined,
      })
      if (r.ok) {
        setQuestionText(''); setQuestionCaptureId(null); setOverlay('none')
        setQuestionCount((n) => n + 1)
        toast.success('À vérifier — noté', { duration: 1200 })
      } else toast.error(r.error)
    })
  }

  // ── Vérifier les points suivis — parcours séquentiel ────────────────────────
  // ERGONOMIE seulement : on enchaîne les points (suivant/suivant…, swipe) au lieu
  // de revenir à la liste. MÉTIER INCHANGÉ : même capture de vérification ; aucun
  // statut conforme/non-conforme, aucun constat ici (gated, cf. [[visite-trois-temps]]).
  function openVerify() {
    const firstTodo = subjects.findIndex((s) => !verifiedSubjectIds.has(s.id))
    setVerifIndex(firstTodo >= 0 ? firstTodo : 0)
    setVerifNote('')
    setOverlay('verify')
  }
  function gotoVerif(i: number) {
    if (i < 0 || i >= subjects.length) return
    setVerifIndex(i)
    setVerifNote('')
  }
  function saveVerification() {
    const subject = subjects[verifIndex]
    if (!subject) return
    startBusy(async () => {
      const r = await addVerificationCaptureAction({
        report_id: reportId, site_id: siteId, subject_id: subject.id,
        body: verifNote.trim() || undefined,
      })
      if (r.ok) {
        toast.success('Point vérifié', { duration: 1000 })
        setVerifNote('')
        refresh()
        // Fluide : on enchaîne sur le point suivant s'il en reste.
        if (verifIndex < subjects.length - 1) setVerifIndex(verifIndex + 1)
      } else toast.error(r.error)
    })
  }

  // ── Position ───────────────────────────────────────────────────────────────
  function capturePosition() {
    if (!navigator.geolocation) { toast.error('Position indisponible'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        startBusy(async () => {
          const r = await addPositionCaptureAction({
            report_id: reportId, site_id: siteId,
            lat: pos.coords.latitude, lng: pos.coords.longitude,
          })
          if (r.ok) { toast.success('Position enregistrée', { duration: 1200 }); refresh() }
          else toast.error(r.error)
        })
      },
      () => toast.error('Position refusée'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    )
  }

  // ── Marquer ⭐ « à réutiliser dans le mémoire technique » (optimiste, optionnel) ──
  function toggleStar(c: VisitCaptureRow) {
    const next = !c.starred
    setCaptures((prev) => prev.map((x) => (x.id === c.id ? { ...x, starred: next } : x)))
    setCaptureStarAction({ capture_id: c.id, starred: next })
      .then((r) => { if (!r.ok) { toast.error(r.error); refresh() } })
      .catch(() => refresh())
  }

  // ── Retirer une capture (faux geste) ────────────────────────────────────────
  function remove(id: string) {
    startBusy(async () => {
      const r = await removeCaptureAction({ capture_id: id })
      if (r.ok) refresh()
      else toast.error(r.error)
    })
  }

  // ── Terminer la visite ──────────────────────────────────────────────────────
  function end() {
    startBusy(async () => {
      const r = await endVisitAction({ report_id: reportId, site_id: siteId })
      if (r.ok) {
        await revalidateSiteMobile(siteId)
        toast.success('Visite terminée — relisons vite', { duration: 1800 })
        // Temps 2 : on enchaîne sur le débrief express (la voiture).
        router.push(`/m/visite/${reportId}`)
      } else toast.error(r.error)
    })
  }

  const KIND_ICON: Record<VisitCaptureKind, React.ReactNode> = {
    photo: <Camera className="h-4 w-4" />,
    video: <Video className="h-4 w-4" />,
    vocal: <Mic className="h-4 w-4" />,
    note: <Pencil className="h-4 w-4" />,
    verification: <Target className="h-4 w-4" />,
    position: <MapPin className="h-4 w-4" />,
  }
  // Ce qu'on lit dans le journal — pas « une capture », mais ce qu'on a vu/dit.
  function captureLabel(c: VisitCaptureRow): string {
    switch (c.kind) {
      case 'photo': return 'Photo'
      case 'video': return 'Vidéo'
      // Dès qu'il est transcrit, le vocal SE LIT (ce qui a été dit), il ne se nomme plus.
      case 'vocal': return c.body?.trim() ? `« ${c.body.trim()} »` : 'Mémo vocal'
      case 'note': return c.body ?? 'Note'
      case 'verification': return `${subjectName(c.subject_id)}${c.body ? ` — ${c.body}` : ''}`
      case 'position': return 'Position enregistrée'
    }
  }
  // Précision discrète sous la ligne (jamais un statut technique).
  function captureHint(c: VisitCaptureRow): string | null {
    if (c.kind === 'vocal') {
      if (c.transcript_status === 'pending') return 'transcription…'
      if (c.transcript_status === 'failed') return 'transcription indisponible'
      return null
    }
    if (c.kind === 'verification') return 'point suivi vérifié'
    return null
  }
  function hhmm(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-50/60 p-4 dark:bg-emerald-950/20">
      {/* Bandeau : chrono + Terminer */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-900 dark:text-emerald-200">
          <Radio className="h-4 w-4 animate-pulse text-emerald-600" />
          Visite en cours{elapsed ? ` · ${elapsed}` : ''}
        </div>
        <button
          type="button" onClick={end} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Square className="h-4 w-4" /> Terminer
        </button>
      </div>

      {/* Les gestes de collecte sans friction */}
      <div className="grid grid-cols-5 gap-2">
        {/* Médias : JAMAIS désactivés — la capture ne s'arrête pas pour un envoi. */}
        <GestureButton icon={<Camera className="h-5 w-5" />} label="Photo" onClick={() => fileRef.current?.click()} />
        <GestureButton icon={<Video className="h-5 w-5" />} label="Vidéo" onClick={() => videoRef.current?.click()} />
        <GestureButton
          icon={recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          label={recording ? 'Stop' : 'Vocal'}
          active={recording}
          onClick={recording ? stopRec : startRec}
        />
        <GestureButton icon={<Pencil className="h-5 w-5" />} label="Note" disabled={busy} onClick={() => setOverlay('note')} />
        <GestureButton icon={<Target className="h-5 w-5" />} label="Vérifier" disabled={busy} onClick={openVerify} />
      </div>
      {/* Importer des médias DÉJÀ sur le téléphone (WhatsApp, captures d'écran,
          photos reçues) — le conducteur n'a pas toujours l'appli pendant la visite. */}
      <button
        type="button" onClick={() => galleryRef.current?.click()}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-emerald-300 py-2 text-xs font-medium text-emerald-800/90 active:scale-[0.99] transition-transform dark:border-emerald-800 dark:text-emerald-300/90"
      >
        <ImagePlus className="h-4 w-4" /> Ajouter depuis la galerie / un fichier
      </button>
      <button
        type="button" onClick={capturePosition} disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 text-xs text-emerald-800/80 dark:text-emerald-300/80 py-1 disabled:opacity-50"
      >
        <MapPin className="h-3.5 w-3.5" /> Enregistrer ma position (facultatif)
      </button>
      <button
        type="button" onClick={() => openQuestion(null)} disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 py-1 text-xs text-amber-800/90 dark:text-amber-300/90 disabled:opacity-50"
      >
        <HelpCircle className="h-3.5 w-3.5" /> + À vérifier{questionCount > 0 ? ` · ${questionCount} noté${questionCount > 1 ? 's' : ''}` : ''}
      </button>
      {/* Géoloc des OBSERVATIONS : demandée UNE fois, « Toujours oui » mémorisé.
          On localise l'observation, jamais la personne, jamais en continu. */}
      {!geoDecided ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-900 dark:text-emerald-200">
            <MapPin className="h-4 w-4 shrink-0" /> Localiser les observations ?
          </p>
          <p className="mt-1 text-[12px] leading-snug text-emerald-900/80 dark:text-emerald-200/80">
            Les photos, vidéos et notes pourront être replacées sur le plan du chantier.
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">La position des observations est enregistrée, jamais vos déplacements.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" onClick={() => chooseGeo('session')} className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-800 active:scale-95 dark:border-emerald-800 dark:text-emerald-200">
              Oui, pour cette visite
            </button>
            <button type="button" onClick={() => chooseGeo('always')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white active:scale-95">
              Toujours oui sur cet appareil
            </button>
          </div>
          <button type="button" onClick={() => chooseGeo('no')} className="mt-1.5 text-[11px] text-muted-foreground underline underline-offset-2">
            Pas maintenant
          </button>
        </div>
      ) : geoTag ? (
        <p className="flex items-center justify-center gap-1.5 px-1 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
          <MapPin className="h-3.5 w-3.5" /> Observations géolocalisées ·
          <button type="button" onClick={disableGeo} className="underline underline-offset-2">Désactiver</button>
        </p>
      ) : (
        <button type="button" onClick={() => setGeoDecided(false)} className="flex w-full items-center justify-center gap-1.5 px-1 py-1 text-[11px] text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" /> Localiser les observations
        </button>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhotoFile} className="hidden" />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" onChange={onVideoFile} className="hidden" />
      {/* Galerie / fichier : PAS de `capture` → ouvre le sélecteur du téléphone
          (photos reçues, captures d'écran…). Multi-sélection. */}
      <input ref={galleryRef} type="file" accept="image/*,video/*" multiple onChange={onGalleryFiles} className="hidden" />

      {/* Journal de terrain — « ce que j'ai vu », pas « mes captures ».
          L'heure est le fil du temps ; chaque ligne se lit comme un récit. */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-emerald-900/80 dark:text-emerald-200/80">
            {kept.length === 0 && visiblePending.length === 0 ? 'Rien encore — capturez en marchant.' : 'Pendant cette visite'}
          </span>
          {pendingSyncCount > 0 ? (
            <button
              type="button" onClick={() => { void syncNow() }}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300"
              title="Synchroniser maintenant"
            >
              <CloudUpload className="h-3.5 w-3.5" />
              {pendingSyncCount} en attente d&apos;envoi
            </button>
          ) : busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-700" />
          ) : null}
        </div>
        {kept.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1 text-[13px] font-medium text-emerald-900/80 dark:text-emerald-200/80">
            {mediaCount.photo > 0 && <span className="inline-flex items-center gap-1.5"><Camera className="h-4 w-4" /> {mediaCount.photo} photo{mediaCount.photo > 1 ? 's' : ''}</span>}
            {mediaCount.video > 0 && <span className="inline-flex items-center gap-1.5"><Video className="h-4 w-4" /> {mediaCount.video} vidéo{mediaCount.video > 1 ? 's' : ''}</span>}
            {mediaCount.vocal > 0 && <span className="inline-flex items-center gap-1.5"><Mic className="h-4 w-4" /> {mediaCount.vocal} vocal{mediaCount.vocal > 1 ? 'aux' : ''}</span>}
            {mediaCount.note > 0 && <span className="inline-flex items-center gap-1.5"><Pencil className="h-4 w-4" /> {mediaCount.note} note{mediaCount.note > 1 ? 's' : ''}</span>}
          </div>
        )}
        {kept.length > 0 && (
          <ul className="space-y-px">
            {kept.map((c) => {
              const hint = captureHint(c)
              return (
                <li key={c.id} className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5">
                  <span className="w-9 shrink-0 pt-0.5 text-[11px] tabular-nums font-medium text-emerald-800/70 dark:text-emerald-300/70">
                    {hhmm(c.created_at)}
                  </span>
                  {(c.kind === 'photo' || c.kind === 'video') && previews[c.id]?.url ? (
                    <button
                      type="button" onClick={() => setLightbox(c)} aria-label="Agrandir"
                      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-emerald-500/20 bg-black/5"
                    >
                      {c.kind === 'photo' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previews[c.id]!.url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <>
                          <video src={previews[c.id]!.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                          <span className="absolute inset-0 flex items-center justify-center text-white"><Play className="h-4 w-4 drop-shadow" fill="currentColor" /></span>
                        </>
                      )}
                    </button>
                  ) : (
                    <span className="shrink-0 pt-0.5 text-emerald-700/80 dark:text-emerald-300/80">{KIND_ICON[c.kind]}</span>
                  )}
                  <span className="min-w-0 flex-1 text-sm leading-snug">
                    {captureLabel(c)}
                    {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
                  </span>
                  <button
                    type="button" onClick={() => openQuestion(c.id)}
                    aria-label="À vérifier au retour" title="À vérifier au retour"
                    className="shrink-0 pt-0.5"
                  >
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/40 hover:text-amber-600" />
                  </button>
                  <button
                    type="button" onClick={() => toggleStar(c)}
                    aria-label={c.starred ? 'Retirer « important »' : 'Important — à réutiliser'}
                    title={c.starred ? 'Important' : 'Marquer comme important (à réutiliser)'}
                    className="shrink-0 pt-0.5"
                  >
                    <Star className={`h-3.5 w-3.5 ${c.starred ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40 hover:text-amber-500'}`} />
                  </button>
                  <button type="button" onClick={() => remove(c.id)} disabled={busy} aria-label="Retirer" className="shrink-0 pt-0.5 text-muted-foreground/50 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {/* Captures encore en attente d'envoi — affichées en optimiste, elles
            laissent place à la vraie ligne dès que le serveur confirme. */}
        {visiblePending.length > 0 && (
          <ul className="space-y-px">
            {visiblePending.map((p) => {
              const st = pendingStatus(p)
              return (
                <li key={p.clientUuid} className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5">
                  <span className="w-9 shrink-0 pt-0.5 text-[11px] tabular-nums font-medium text-emerald-800/70 dark:text-emerald-300/70">
                    {hhmm(new Date(p.takenAt).toISOString())}
                  </span>
                  <span className="shrink-0 pt-0.5 text-emerald-700/80 dark:text-emerald-300/80">{KIND_ICON[p.kind]}</span>
                  <span className="min-w-0 flex-1 text-sm leading-snug">
                    {p.kind === 'photo' ? 'Photo' : p.kind === 'video' ? 'Vidéo' : 'Mémo vocal'}
                    <span className="mt-0.5 flex items-center gap-1 text-[11px]">
                      {st === 'uploading' ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> envoi…</span>
                      ) : st === 'failed' ? (
                        <button type="button" onClick={() => { void syncNow() }} className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                          <AlertCircle className="h-3 w-3" /> à renvoyer — réessayer
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700/90 dark:text-amber-300/80"><CloudUpload className="h-3 w-3" /> en attente d&apos;envoi</span>
                      )}
                    </span>
                  </span>
                  {p.kind === 'photo' && p.previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.previewUrl} alt="" className="h-9 w-9 shrink-0 rounded-md border border-emerald-500/20 object-cover" />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Filet de réassurance UNIQUEMENT quand il y a de l'attente : hors réseau,
          rien n'est perdu. Le « tout est synchronisé » est retiré — le conducteur
          suppose que ça marche, on ne le félicite pas d'un état normal. */}
      {pendingSyncCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <CloudUpload className="h-4 w-4 shrink-0 mt-px" />
          <span>
            {pendingSyncCount} capture{pendingSyncCount > 1 ? 's' : ''} en attente — envoyée{pendingSyncCount > 1 ? 's' : ''} automatiquement dès que le réseau revient. Rien n&apos;est perdu.
          </span>
        </div>
      )}

      <p className="text-[11px] italic text-emerald-800/60 dark:text-emerald-300/60 leading-snug">
        On collecte. On décidera quoi en faire après la visite.
      </p>

      {/* Plein écran d'une capture — un clic = grand (standard mobile). */}
      {lightbox && previews[lightbox.id]?.url && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" onClick={() => setLightbox(null)}>
          <div className="flex items-center justify-between p-3" onClick={(e) => e.stopPropagation()}>
            {lightbox.kind === 'photo' ? (
              <button
                type="button"
                onClick={() => setAnnotate({ id: lightbox.id, url: previews[lightbox.id]!.url })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white"
              >
                <Pencil className="h-4 w-4" /> Annoter
              </button>
            ) : <span />}
            <button type="button" onClick={() => setLightbox(null)} aria-label="Fermer" className="rounded-full bg-white/10 p-2 text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
            {lightbox.kind === 'photo' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previews[lightbox.id]!.url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
            ) : (
              <video src={previews[lightbox.id]!.url} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg" />
            )}
          </div>
        </div>
      )}

      {/* Annotation plein écran — l'image annotée s'ajoute EN PLUS de l'original. */}
      {annotate && (
        <PhotoAnnotator
          imageUrl={annotate.url}
          onCancel={() => setAnnotate(null)}
          onSave={saveAnnotation}
        />
      )}

      {/* Overlay : Note */}
      {overlay === 'note' && (
        <Overlay title="Note" icon={<Pencil className="h-4 w-4" />} onClose={() => { setOverlay('none'); setNote('') }}>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus maxLength={2000}
            placeholder="Ce que vous voyez, en une phrase…"
            className="w-full rounded-lg border bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="button" onClick={saveNote} disabled={busy || note.trim().length < 1}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground text-background font-medium text-sm py-2.5 disabled:opacity-50">
            <Check className="h-4 w-4" /> Ajouter au panier
          </button>
        </Overlay>
      )}

      {/* Overlay : Question à vérifier (❓) — sur une capture ou libre. */}
      {overlay === 'question' && (
        <Overlay title="À vérifier au retour" icon={<HelpCircle className="h-4 w-4" />} onClose={() => { setOverlay('none'); setQuestionText(''); setQuestionCaptureId(null) }}>
          <textarea
            value={questionText} onChange={(e) => setQuestionText(e.target.value)} rows={2} autoFocus maxLength={500}
            placeholder="Ex : diamètre canalisation à confirmer · où passe le réseau ?…"
            className="w-full rounded-lg border bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button type="button" onClick={saveQuestion} disabled={busy || questionText.trim().length < 1}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground text-background font-medium text-sm py-2.5 disabled:opacity-50">
            <Check className="h-4 w-4" /> Ajouter
          </button>
        </Overlay>
      )}

      {/* Overlay : Vérifier les points suivis — PARCOURS séquentiel (swipe / suivant).
          Ergonomie pure ; aucun changement de données ni de métier. */}
      {overlay === 'verify' && (
        <Overlay title="Vérifier les points suivis" icon={<Target className="h-4 w-4" />} onClose={() => { setOverlay('none'); setVerifNote('') }}>
          {subjects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Aucun point suivi sur ce chantier pour l&apos;instant.</p>
          ) : (
            <div
              className="space-y-3"
              onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null }}
              onTouchEnd={(e) => {
                if (touchStartX.current == null) return
                const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
                touchStartX.current = null
                if (dx <= -50) gotoVerif(verifIndex + 1)
                else if (dx >= 50) gotoVerif(verifIndex - 1)
              }}
            >
              {/* Compteur + barre de progression */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="tabular-nums">{verifIndex + 1} / {subjects.length}</span>
                  <span className="tabular-nums">{verifiedSubjectIds.size} / {subjects.length} vérifiés</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-emerald-600 transition-all"
                    style={{ width: `${subjects.length ? (verifiedSubjectIds.size / subjects.length) * 100 : 0}%` }} />
                </div>
              </div>

              {/* Le point courant */}
              <div className="rounded-xl border bg-background p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Target className="h-4 w-4 shrink-0 mt-0.5 text-emerald-700/80" />
                  <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{subjects[verifIndex]?.name}</p>
                  {verifiedSubjectIds.has(subjects[verifIndex]?.id) && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" /> vérifié
                    </span>
                  )}
                </div>
                {/* La mémoire du point — « ce qu'on sait déjà » au moment d'agir. */}
                <SubjectMemoryBlock mem={subjectMemory[subjects[verifIndex]?.id ?? '']} />
                <textarea
                  value={verifNote} onChange={(e) => setVerifNote(e.target.value)} rows={2} maxLength={2000}
                  placeholder="Constat (facultatif)…"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button type="button" onClick={saveVerification} disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground text-background font-medium text-sm py-2.5 disabled:opacity-50">
                  <Check className="h-4 w-4" />
                  {verifIndex >= subjects.length - 1 ? 'Valider' : 'Valider et suivant'}
                  {verifIndex < subjects.length - 1 && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>

              {/* Navigation séquentielle */}
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => gotoVerif(verifIndex - 1)} disabled={verifIndex === 0}
                  className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" /> Précédent
                </button>
                <button type="button" onClick={() => gotoVerif(verifIndex + 1)} disabled={verifIndex >= subjects.length - 1}
                  className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-40">
                  Suivant <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </Overlay>
      )}
    </div>
  )
}

// La mémoire d'un point suivi pendant la vérification (read-only). NARRATIF, pas
// tableau de bord : une seule ligne de SENS (« pourquoi je reviens voir ce point »)
// + l'ancienneté. Pas de pastilles façon dashboard.
function SubjectMemoryBlock({ mem }: { mem: SubjectMemoryLite | undefined }) {
  if (!mem) return null
  const empty = mem.lastActivityDays == null && !mem.openReserves && !mem.openActions && !mem.lateActions && !mem.decisions
  if (empty) {
    return <p className="text-xs italic text-muted-foreground">Première fois sur ce point — aucune trace antérieure.</p>
  }
  let lead: string | null = null
  if (mem.openReserves) lead = mem.openReserves > 1 ? `${mem.openReserves} réserves non levées` : 'Réserve non levée'
  else if (mem.lateActions) lead = mem.lateActions > 1 ? `${mem.lateActions} actions en retard` : 'Action en retard'
  else if (mem.openActions) lead = mem.openActions > 1 ? `${mem.openActions} actions en cours` : 'Action en cours'
  else if (mem.decisions) lead = 'Déjà documenté'
  const stale = mem.lastActivityDays != null && mem.lastActivityDays >= 30
  const hot = mem.criticality === 'haute'
  return (
    <div className={`rounded-lg px-2.5 py-2 text-xs space-y-0.5 ${hot ? 'bg-red-50 dark:bg-red-950/30' : 'bg-muted/40'}`}>
      {lead && <p className={`font-medium ${hot ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>{lead}</p>}
      {mem.lastActivityDays != null && (
        <p className="text-muted-foreground">
          {stale ? '⚠ ' : ''}Dernière trace il y a {mem.lastActivityDays} j{stale ? ' — à reconfirmer' : ''}
        </p>
      )}
    </div>
  )
}

function GestureButton({
  icon, label, onClick, disabled, active,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1 rounded-xl border py-3 text-xs font-medium active:scale-[0.98] transition-transform disabled:opacity-50 ${
        active ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30' : 'border-border bg-background'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function Overlay({
  title, icon, onClose, children,
}: {
  title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 space-y-3 border-t bg-background p-4 safe-bottom">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">{icon} {title}</span>
        <button type="button" onClick={onClose} aria-label="Fermer" className="text-muted-foreground"><X className="h-5 w-5" /></button>
      </div>
      {children}
    </div>
  )
}
