'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Camera, Video, Mic, Pencil, Target, MapPin, X, Bookmark, ListTodo, Eye, Check, ArrowRight, Star, HelpCircle, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { triageCaptureAction, refreshDebriefCapturesAction, type TriageDecision } from './debrief-actions'
import type { VisitCaptureRow, VisitCaptureKind } from '@/lib/db/visit-captures'

/**
 * Débrief express (temps 2 — la voiture). Écran TRÈS simple. Une seule question
 * par élément : « est-ce que ça mérite une suite ? ». 4 choix métier — pas 7
 * destinations, pas de vocabulaire technique. Le tri ENREGISTRE la décision ;
 * le bureau matérialisera les suites. Cf. [[visite-trois-temps]].
 */
export function DebriefExpress({
  reportId,
  siteId,
  siteName,
  dossierId,
  questionsCount,
  initialCaptures,
}: {
  reportId: string
  siteId: string
  siteName: string
  /** Le dossier d'opération de la prévisite — cible du CTA « Préparer l'AO ». */
  dossierId: string | null
  /** ❓ « à vérifier » posées pendant la visite (hors captures). */
  questionsCount: number
  initialCaptures: VisitCaptureRow[]
}) {
  const router = useRouter()
  const [captures, setCaptures] = useState<VisitCaptureRow[]>(initialCaptures)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startBusy] = useTransition()

  const total = captures.length
  const triaged = captures.filter((c) => c.status !== 'captured').length

  // Récap de fin de prévisite : la composition par type + ⭐ + ❓. L'agent voit
  // d'un coup ce qu'il a ramené, avant de passer à la préparation de l'AO.
  const tally = {
    photo: captures.filter((c) => c.kind === 'photo').length,
    video: captures.filter((c) => c.kind === 'video').length,
    vocal: captures.filter((c) => c.kind === 'vocal').length,
    note: captures.filter((c) => c.kind === 'note').length,
    starred: captures.filter((c) => c.starred).length,
  }
  const summaryChips: Array<{ icon: typeof Camera; n: number; cls?: string }> = [
    { icon: Camera, n: tally.photo },
    { icon: Video, n: tally.video },
    { icon: Mic, n: tally.vocal },
    { icon: Pencil, n: tally.note },
    { icon: Star, n: tally.starred, cls: 'text-amber-500' },
    { icon: HelpCircle, n: questionsCount, cls: 'text-amber-600' },
  ].filter((c) => c.n > 0)

  // Le transcript arrive en fond : on le fait APPARAÎTRE tant qu'un vocal est en
  // cours. On ne fusionne QUE le texte (body/transcript_status) — jamais le
  // status/intent, pour ne pas écraser un tri en cours côté conducteur.
  const hasPendingTranscript = captures.some((c) => c.kind === 'vocal' && c.transcript_status === 'pending')
  useEffect(() => {
    if (!hasPendingTranscript) return
    const id = setInterval(() => {
      refreshDebriefCapturesAction(reportId).then((fresh) => {
        if (!fresh.length) return
        setCaptures((cur) => cur.map((c) => {
          const f = fresh.find((x) => x.id === c.id)
          return f ? { ...c, body: f.body, transcript_status: f.transcript_status } : c
        }))
      }).catch(() => { /* silencieux */ })
    }, 4000)
    return () => clearInterval(id)
  }, [hasPendingTranscript, reportId])

  function decide(c: VisitCaptureRow, decision: TriageDecision) {
    const prev = c
    // Optimiste : on reflète tout de suite le choix, on confirme en base derrière.
    const next: VisitCaptureRow = {
      ...c,
      status: decision === 'ignore' ? 'discarded' : 'kept',
      triage_intent: decision === 'action' ? 'action' : decision === 'follow' ? 'follow' : null,
    }
    setCaptures((cs) => cs.map((x) => (x.id === c.id ? next : x)))
    setBusyId(c.id)
    startBusy(async () => {
      const r = await triageCaptureAction({ capture_id: c.id, decision })
      setBusyId(null)
      if (!r.ok) {
        setCaptures((cs) => cs.map((x) => (x.id === c.id ? prev : x)))
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-28">
      {/* En-tête : on a fini de marcher, on relit vite. */}
      <header className="space-y-2 pt-2">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Fin de prévisite</p>
          <h1 className="text-xl font-semibold">Visite terminée</h1>
          <p className="text-sm text-muted-foreground">
            {siteName} · {total} élément{total > 1 ? 's' : ''} relevé{total > 1 ? 's' : ''}
          </p>
        </div>
        {/* Composition de la prévisite — ce que l'agent a ramené, d'un coup d'œil. */}
        {summaryChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm">
            {summaryChips.map((c, i) => {
              const Icon = c.icon
              return (
                <span key={i} className="inline-flex items-center gap-1">
                  <Icon className={`h-4 w-4 ${c.cls ?? 'text-muted-foreground'}`} />
                  <span className="tabular-nums font-medium">{c.n}</span>
                </span>
              )
            })}
          </div>
        )}
      </header>

      {total === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Rien n&apos;a été capté pendant cette visite.
        </p>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">À relire rapidement</h2>
            <span className="text-xs tabular-nums text-muted-foreground">{triaged}/{total} triés</span>
          </div>

          <ul className="space-y-2">
            {captures.map((c) => (
              <CaptureCard key={c.id} capture={c} busy={busyId === c.id} onDecide={(d) => decide(c, d)} />
            ))}
          </ul>
        </section>
      )}

      {/* Barre de fin — on ne FORCE pas à tout trier. Si un dossier d'affaire est
          rattaché, on enchaîne naturellement sur la préparation de l'AO ; sinon on
          revient au chantier. */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-md space-y-2">
          {dossierId ? (
            <>
              <Link
                href={`/dossiers/${dossierId}`}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background"
              >
                <FileText className="h-4 w-4" /> Préparer l&apos;appel d&apos;offres <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => router.push(`/m/site/${siteId}`)}
                className="w-full rounded-xl border px-4 py-2 text-sm font-medium text-muted-foreground"
              >
                Plus tard — revenir au chantier
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-xs text-muted-foreground">Le reste sera préparé au bureau.</p>
              <button
                type="button"
                onClick={() => router.push(`/m/site/${siteId}`)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background"
              >
                Terminé <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const KIND_ICON: Record<VisitCaptureKind, React.ReactNode> = {
  photo: <Camera className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  vocal: <Mic className="h-4 w-4" />,
  note: <Pencil className="h-4 w-4" />,
  verification: <Target className="h-4 w-4" />,
  position: <MapPin className="h-4 w-4" />,
}

function captureLabel(c: VisitCaptureRow): string {
  switch (c.kind) {
    case 'photo': return 'Photo'
    case 'video': return 'Vidéo'
    case 'vocal': return c.body?.trim() ? `« ${c.body.trim()} »` : 'Mémo vocal'
    case 'note': return c.body ?? 'Note'
    case 'verification': return c.body?.trim() ? `Point vérifié — ${c.body.trim()}` : 'Point vérifié'
    case 'position': return 'Position enregistrée'
  }
}

function currentDecision(c: VisitCaptureRow): TriageDecision | null {
  if (c.status === 'discarded') return 'ignore'
  if (c.status === 'kept') {
    if (c.triage_intent === 'action') return 'action'
    if (c.triage_intent === 'follow') return 'follow'
    return 'keep'
  }
  return null
}

function CaptureCard({
  capture, busy, onDecide,
}: {
  capture: VisitCaptureRow
  busy: boolean
  onDecide: (d: TriageDecision) => void
}) {
  const chosen = currentDecision(capture)
  const ignored = chosen === 'ignore'

  return (
    <li className={`rounded-xl border p-3 transition-opacity ${ignored ? 'opacity-50' : ''} ${busy ? 'opacity-70' : ''}`}>
      {/* La ligne relevée — se lit comme un récit, pas comme un fichier. */}
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 pt-0.5 text-emerald-700/80">{KIND_ICON[capture.kind]}</span>
        <p className="min-w-0 flex-1 text-sm leading-snug">
          {captureLabel(capture)}
          {capture.kind === 'vocal' && capture.transcript_status === 'pending' && (
            <span className="block text-[11px] text-muted-foreground">transcription…</span>
          )}
        </p>
      </div>

      {/* Une seule question : est-ce que ça mérite une suite ? */}
      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
        <DecisionButton label="Ignorer" icon={<X className="h-4 w-4" />} active={chosen === 'ignore'} tone="muted" onClick={() => onDecide('ignore')} />
        <DecisionButton label="Garder" icon={<Bookmark className="h-4 w-4" />} active={chosen === 'keep'} tone="neutral" onClick={() => onDecide('keep')} />
        <DecisionButton label="À traiter" icon={<ListTodo className="h-4 w-4" />} active={chosen === 'action'} tone="accent" onClick={() => onDecide('action')} />
        <DecisionButton label="Suivre" icon={<Eye className="h-4 w-4" />} active={chosen === 'follow'} tone="accent" onClick={() => onDecide('follow')} />
      </div>
    </li>
  )
}

function DecisionButton({
  label, icon, active, tone, onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  tone: 'muted' | 'neutral' | 'accent'
  onClick: () => void
}) {
  const activeCls =
    tone === 'accent' ? 'border-emerald-600 bg-emerald-600 text-white'
    : tone === 'muted' ? 'border-foreground/30 bg-muted text-foreground'
    : 'border-foreground bg-foreground text-background'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium active:scale-[0.97] transition ${
        active ? activeCls : 'border-border bg-background text-foreground/80'
      }`}
    >
      {active ? <Check className="h-4 w-4" /> : icon}
      {label}
    </button>
  )
}
