'use client'

// SANTÉ DE LA MÉMOIRE + SOURCES AUDIO (mig 141, P2a). Zone SÉPARÉE des détecteurs
// chantier (Vincent : « les détecteurs parlent du chantier ; la couverture parle de
// la qualité de la mémoire »). Timeline des sources + couverture INDICATIVE (jamais
// bloquante) + ajout d'audio de secours (mémo, appel, débrief) fusionné au corpus.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, Plus, Loader2, Check, Activity, FileText, Sparkles, RefreshCw, History, Volume2, AlertTriangle } from 'lucide-react'
import { addMeetingAudioSourceAction, setEstimatedDurationAction, reanalyzeReportAction, getAudioSourceUrlAction, retranscribeSourceAction } from './memory-actions'
import { AUDIO_SOURCE_TYPES, AUDIO_SOURCE_LABEL, type AudioSourceType } from '@/lib/db/audio-source-constants'
import type { AudioSource, MemoryHealth } from '@/lib/db/report-audio-sources'
import type { AnalysisRun, AnalysisDelta } from '@/lib/db/report-analysis-runs'

function fmtDelta(d: AnalysisDelta): string {
  const parts = [
    d.newActions ? `+${d.newActions} action${d.newActions > 1 ? 's' : ''}` : null,
    d.newProposals - d.newActions > 0 ? `+${d.newProposals - d.newActions} proposition${d.newProposals - d.newActions > 1 ? 's' : ''}` : null,
    d.newParticipants ? `+${d.newParticipants} participant${d.newParticipants > 1 ? 's' : ''}` : null,
    d.newRisks ? `+${d.newRisks} risque${d.newRisks > 1 ? 's' : ''}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'aucun nouvel élément'
}

function Reanalyze({ reportId, runs }: { reportId: string; runs: AnalysisRun[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  function run() {
    setResult(null); setError(null)
    startTransition(async () => {
      try {
        const r = await reanalyzeReportAction(reportId)
        if (r.ok) { setResult(fmtDelta(r.delta)); router.refresh() }
        else setError(r.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }
  return (
    <div className="space-y-1.5 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted/40 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Ré-analyser le corpus
        </button>
        {result && <span className="text-xs font-medium text-emerald-700">Ré-analyse : {result}</span>}
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground">Relance l'analyse sur le corpus fusionné. Jamais destructif : les éléments existants sont conservés, seuls les nouveaux sont proposés à la curation.</p>
      {runs.length > 0 && (
        <div className="pt-1">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"><History className="h-3 w-3" /> Historique des analyses</p>
          <ul className="mt-1 space-y-0.5">
            {runs.map((r) => (
              <li key={r.id} className="text-[11px] text-muted-foreground">
                {new Date(r.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · {r.trigger === 'initial' ? 'Analyse initiale' : 'Ré-analyse'} — {fmtDelta(r.delta)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Une source audio : réécoute (URL signée) + relance de transcription si échec/vide.
function SourceRow({ source }: { source: AudioSource }) {
  const router = useRouter()
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loadingUrl, startLoadUrl] = useTransition()
  const [retrying, startRetry] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const needsTranscript = source.transcriptStatus === 'failed' || source.transcriptStatus === 'none' || !source.hasTranscript

  function toggleListen() {
    setMsg(null)
    if (audioUrl) { setAudioUrl(null); return }
    startLoadUrl(async () => {
      const r = await getAudioSourceUrlAction(source.id)
      if (r.ok) setAudioUrl(r.url)
      else setMsg({ ok: false, text: r.error })
    })
  }
  function retry() {
    setMsg(null)
    startRetry(async () => {
      const r = await retranscribeSourceAction(source.id)
      if (r.ok) { setMsg({ ok: true, text: `Transcription régénérée (${r.chars} car.)` }); router.refresh() }
      else setMsg({ ok: false, text: r.error })
    })
  }

  return (
    <li className="rounded-md border bg-card/40 px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <Mic className="h-3.5 w-3.5 shrink-0 text-sky-600" />
        <span className="min-w-0 flex-1 truncate">{source.label}<span className="text-muted-foreground"> · {AUDIO_SOURCE_LABEL[source.typeSource]}</span></span>
        {source.transcriptStatus === 'pending' && <span className="inline-flex items-center gap-1 text-[10px] text-amber-700"><Loader2 className="h-3 w-3 animate-spin" /> en cours</span>}
        {needsTranscript && source.transcriptStatus !== 'pending' && <span className="inline-flex items-center gap-1 text-[10px] text-rose-600"><AlertTriangle className="h-3 w-3" /> transcription manquante</span>}
        {!needsTranscript && source.transcriptStatus === 'done' && <span className="text-[10px] text-emerald-700">transcrit</span>}
        <span className="shrink-0 tabular-nums text-muted-foreground">{fmtDuration(source.durationSeconds)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggleListen} disabled={loadingUrl}
          className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] hover:bg-muted/40 disabled:opacity-50">
          {loadingUrl ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3 w-3" />} {audioUrl ? 'Masquer' : 'Réécouter'}
        </button>
        <button type="button" onClick={retry} disabled={retrying}
          className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] hover:bg-muted/40 disabled:opacity-50">
          {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {needsTranscript ? 'Relancer la transcription' : 'Régénérer la transcription'}
        </button>
        {msg && <span className={`text-[11px] ${msg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{msg.text}</span>}
      </div>
      {audioUrl && <audio controls preload="none" src={audioUrl} className="mt-1 h-9 w-full" />}
    </li>
  )
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

function CoverageBadge({ health }: { health: MemoryHealth }) {
  if (health.coveragePercent == null) {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Couverture : durée prévue non renseignée</span>
  }
  const green = health.level === 'green'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${green ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
      {green ? '🟢' : '🟠'} Couverture audio {health.coveragePercent}%{!green ? ' · réunion probablement incomplète' : ''}
    </span>
  )
}

function EstimatedDuration({ reportId, current }: { reportId: string; current: number | null }) {
  const router = useRouter()
  const [val, setVal] = useState(current ? String(current) : '')
  const [pending, startTransition] = useTransition()
  const dirty = (val.trim() === '' ? null : Number(val)) !== current
  function save() {
    startTransition(async () => {
      try { const r = await setEstimatedDurationAction(reportId, val.trim() === '' ? null : Number(val)); if (r.ok) router.refresh() } catch {}
    })
  }
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      Durée prévue
      <input type="number" min={1} value={val} onChange={(e) => setVal(e.target.value)} placeholder="min"
        className="w-16 rounded-md border bg-background px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
      min
      {dirty && (
        <button type="button" onClick={save} disabled={pending} className="ml-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted/40 disabled:opacity-50">
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </button>
      )}
    </label>
  )
}

function AddSource({ reportId }: { reportId: string }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<AudioSourceType>('debrief')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function pick(file: File) {
    setError(null)
    // Durée lue côté client depuis les métadonnées audio (sinon couverture partielle).
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => { send(file, Number.isFinite(audio.duration) ? audio.duration : 0); URL.revokeObjectURL(url) }
    audio.onerror = () => { send(file, 0); URL.revokeObjectURL(url) }
    audio.src = url
  }
  function send(file: File, durationSeconds: number) {
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('report_id', reportId)
        fd.set('file', file)
        if (label.trim()) fd.set('label', label)
        fd.set('type_source', type)
        if (durationSeconds > 0) fd.set('duration_seconds', String(durationSeconds))
        const res = await addMeetingAudioSourceAction(fd)
        if (res.ok) { setLabel(''); if (fileRef.current) fileRef.current.value = ''; router.refresh() }
        else setError(res.error)
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <p className="text-[11px] text-muted-foreground">Ajouter un audio de secours (mémo, appel, débrief) — fusionné au corpus de la réunion.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé (ex. « Débrief Guillaume »)"
          className="min-w-[10rem] flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <select value={type} onChange={(e) => setType(e.target.value as AudioSourceType)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300">
          {AUDIO_SOURCE_TYPES.filter((t) => t !== 'audio_meeting').map((t) => <option key={t} value={t}>{AUDIO_SOURCE_LABEL[t]}</option>)}
        </select>
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f) }} />
        <button type="button" disabled={pending} onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Audio
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  )
}

export function MeetingMemoryHealth({ reportId, sources, health, analysisRuns = [] }: { reportId: string; sources: AudioSource[]; health: MemoryHealth; analysisRuns?: AnalysisRun[] }) {
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-muted-foreground" /> Santé de la mémoire
        </h2>
        <EstimatedDuration reportId={reportId} current={health.estimatedMinutes} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CoverageBadge health={health} />
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${health.transcriptComplete ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          <FileText className="h-3 w-3" /> {health.transcriptComplete ? 'Transcription complète' : 'Transcription incomplète'}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${health.analysisGenerated ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          <Sparkles className="h-3 w-3" /> {health.analysisGenerated ? 'Analyse générée' : 'Analyse en attente'}
        </span>
      </div>

      {/* Timeline des sources (rassurant : on voit tout ce qui a été capté). */}
      {sources.length > 0 && (
        <div className="space-y-1">
          <ul className="space-y-1">
            {sources.map((s) => <SourceRow key={s.id} source={s} />)}
          </ul>
          <p className="text-[11px] text-muted-foreground">Total corpus : {fmtDuration(health.capturedSeconds)} · {sources.length} source{sources.length > 1 ? 's' : ''}</p>
        </div>
      )}

      <AddSource reportId={reportId} />
      <Reanalyze reportId={reportId} runs={analysisRuns} />
      <p className="text-[11px] italic text-muted-foreground/70">La couverture est indicative — une réunion peut être clôturée même avec une couverture faible.</p>
    </section>
  )
}
