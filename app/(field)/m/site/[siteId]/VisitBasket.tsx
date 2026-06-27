'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Camera, Mic, Pencil, Target, MapPin, Square, Radio, X, Trash2, Loader2, Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { endVisitAction } from './visit-actions'
import { uploadReportAttachmentAction } from './report-actions'
import {
  addNoteCaptureAction,
  addVerificationCaptureAction,
  addPhotoCaptureAction,
  addPositionCaptureAction,
  addVocalCaptureAction,
  removeCaptureAction,
  listVisitCapturesAction,
  revalidateSiteMobile,
} from './capture-actions'
import type { VisitCaptureRow, VisitCaptureKind } from '@/lib/db/visit-captures'

/**
 * « Visite en cours » — le PANIER terrain (temps 1 des 3, cf. [[visite-trois-temps]]).
 * On ne réfléchit pas : on collecte. 4 gestes + position, une pression, retour
 * immédiat. AUCUNE qualification ici (ni « passage/anomalie », ni destination) :
 * le tri se fait plus tard (voiture puis bureau). L'IA se tait.
 */
export function VisitBasket({
  reportId,
  siteId,
  startedAt,
  subjects,
  initialCaptures,
}: {
  reportId: string
  siteId: string
  startedAt: string | null
  subjects: Array<{ id: string; name: string }>
  initialCaptures: VisitCaptureRow[]
}) {
  const router = useRouter()
  const [captures, setCaptures] = useState<VisitCaptureRow[]>(initialCaptures)
  const [overlay, setOverlay] = useState<'none' | 'note' | 'verify'>('none')
  const [note, setNote] = useState('')
  const [verifSubject, setVerifSubject] = useState<{ id: string; name: string } | null>(null)
  const [verifNote, setVerifNote] = useState('')
  const [busy, startBusy] = useTransition()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const subjectName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? 'point suivi'
  const kept = captures.filter((c) => c.status !== 'discarded')

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

  async function refresh() {
    try { setCaptures(await listVisitCapturesAction(reportId)) } catch { /* silencieux */ }
  }

  // Le client DÉCLENCHE le worker, il ne traite jamais. `keepalive` : la requête
  // survit même si l'utilisateur quitte l'écran. Si elle n'aboutit pas, la capture
  // reste 'pending' en base et le cron de rattrapage s'en charge plus tard.
  function kickCaptureProcessing(captureId: string) {
    fetch('/api/visit-captures/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captureId }),
      keepalive: true,
    }).catch(() => { /* silencieux : le cron rattrapera */ })
  }

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

  // ── Photo ──────────────────────────────────────────────────────────────────
  function onPhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    startBusy(async () => {
      const fd = new FormData()
      fd.set('report_id', reportId)
      fd.set('kind', 'photo')
      fd.set('file', file)
      fd.set('client_uuid', crypto.randomUUID())
      const up = await uploadReportAttachmentAction(fd)
      if (!up.ok) { toast.error(up.error); return }
      const r = await addPhotoCaptureAction({ report_id: reportId, site_id: siteId, attachment_id: up.attachmentId })
      if (r.ok) { toast.success('Photo ajoutée', { duration: 1200 }); refresh() }
      else toast.error(r.error)
    })
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
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        startBusy(async () => {
          const fd = new FormData()
          fd.set('report_id', reportId)
          fd.set('site_id', siteId)
          fd.set('audio', blob, 'memo.webm')
          fd.set('audio_mime', blob.type || 'audio/webm')
          const r = await addVocalCaptureAction(fd)
          if (r.ok) {
            toast.success('Mémo vocal ajouté', { duration: 1200 })
            // Le client DÉCLENCHE le worker (il ne transcrit pas) : la route fait le
            // travail dans sa requête, la vérité est en base. Si ça échoue (app
            // fermée, réseau coupé), la capture reste 'pending' et le cron rattrape.
            // Le texte apparaîtra seul dans le journal (cf. polling ci-dessous).
            kickCaptureProcessing(r.id)
            refresh()
          } else toast.error(r.error)
        })
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
      const r = await addNoteCaptureAction({ report_id: reportId, site_id: siteId, body })
      if (r.ok) { setNote(''); setOverlay('none'); toast.success('Note ajoutée', { duration: 1200 }); refresh() }
      else toast.error(r.error)
    })
  }

  // ── Vérifier un point ──────────────────────────────────────────────────────
  function saveVerification() {
    if (!verifSubject) return
    startBusy(async () => {
      const r = await addVerificationCaptureAction({
        report_id: reportId, site_id: siteId, subject_id: verifSubject.id,
        body: verifNote.trim() || undefined,
      })
      if (r.ok) {
        setVerifSubject(null); setVerifNote(''); setOverlay('none')
        toast.success('Point vérifié', { duration: 1200 }); refresh()
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
    vocal: <Mic className="h-4 w-4" />,
    note: <Pencil className="h-4 w-4" />,
    verification: <Target className="h-4 w-4" />,
    position: <MapPin className="h-4 w-4" />,
  }
  // Ce qu'on lit dans le journal — pas « une capture », mais ce qu'on a vu/dit.
  function captureLabel(c: VisitCaptureRow): string {
    switch (c.kind) {
      case 'photo': return 'Photo'
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

      {/* Les 4 gestes (collecte sans friction) */}
      <div className="grid grid-cols-4 gap-2">
        <GestureButton icon={<Camera className="h-5 w-5" />} label="Photo" disabled={busy} onClick={() => fileRef.current?.click()} />
        <GestureButton
          icon={recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          label={recording ? 'Stop' : 'Vocal'}
          active={recording} disabled={busy && !recording}
          onClick={recording ? stopRec : startRec}
        />
        <GestureButton icon={<Pencil className="h-5 w-5" />} label="Note" disabled={busy} onClick={() => setOverlay('note')} />
        <GestureButton icon={<Target className="h-5 w-5" />} label="Vérifier" disabled={busy} onClick={() => setOverlay('verify')} />
      </div>
      <button
        type="button" onClick={capturePosition} disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 text-xs text-emerald-800/80 dark:text-emerald-300/80 py-1 disabled:opacity-50"
      >
        <MapPin className="h-3.5 w-3.5" /> Enregistrer ma position (facultatif)
      </button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhotoFile} className="hidden" />

      {/* Journal de terrain — « ce que j'ai vu », pas « mes captures ».
          L'heure est le fil du temps ; chaque ligne se lit comme un récit. */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-emerald-900/80 dark:text-emerald-200/80">
            {kept.length === 0 ? 'Rien encore — capturez en marchant.' : 'Pendant cette visite'}
          </span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-700" />}
        </div>
        {kept.length > 0 && (
          <ul className="space-y-px">
            {kept.map((c) => {
              const hint = captureHint(c)
              return (
                <li key={c.id} className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5">
                  <span className="w-9 shrink-0 pt-0.5 text-[11px] tabular-nums font-medium text-emerald-800/70 dark:text-emerald-300/70">
                    {hhmm(c.created_at)}
                  </span>
                  <span className="shrink-0 pt-0.5 text-emerald-700/80 dark:text-emerald-300/80">{KIND_ICON[c.kind]}</span>
                  <span className="min-w-0 flex-1 text-sm leading-snug">
                    {captureLabel(c)}
                    {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
                  </span>
                  <button type="button" onClick={() => remove(c.id)} disabled={busy} aria-label="Retirer" className="shrink-0 pt-0.5 text-muted-foreground/50 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="text-[11px] italic text-emerald-800/60 dark:text-emerald-300/60 leading-snug">
        On collecte. On décidera quoi en faire après la visite.
      </p>

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

      {/* Overlay : Vérifier un point */}
      {overlay === 'verify' && (
        <Overlay title="Vérifier un point suivi" icon={<Target className="h-4 w-4" />} onClose={() => { setOverlay('none'); setVerifSubject(null); setVerifNote('') }}>
          {subjects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Aucun point suivi sur ce chantier pour l&apos;instant.</p>
          ) : !verifSubject ? (
            <ul className="max-h-56 overflow-y-auto space-y-1">
              {subjects.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setVerifSubject(s)}
                    className="w-full text-left rounded-lg border bg-background px-3 py-2 text-sm active:bg-muted/40">
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">{verifSubject.name}</p>
              <textarea
                value={verifNote} onChange={(e) => setVerifNote(e.target.value)} rows={2} maxLength={2000}
                placeholder="Constat (facultatif)…"
                className="w-full rounded-lg border bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setVerifSubject(null)} className="rounded-lg border px-3 py-2 text-sm">Changer</button>
                <button type="button" onClick={saveVerification} disabled={busy}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-foreground text-background font-medium text-sm py-2.5 disabled:opacity-50">
                  <Check className="h-4 w-4" /> Marquer vérifié
                </button>
              </div>
            </div>
          )}
        </Overlay>
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
