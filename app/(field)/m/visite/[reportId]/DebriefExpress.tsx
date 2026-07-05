'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Camera, Video, Mic, Pencil, Target, MapPin, BookMarked, AlertTriangle, Eye, Check, CheckCircle2, ArrowRight, ChevronRight, Trash2, Star, HelpCircle, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { triageCaptureAction, refreshDebriefCapturesAction, setVisitObjectiveAction, type TriageDecision } from './debrief-actions'
import { CaptureTriage } from './CaptureTriage'
import { VisitOutputActions } from './VisitOutputActions'
import type { VisitCaptureRow, VisitCaptureKind } from '@/lib/db/visit-captures'
import type { VisitImpact } from '@/lib/db/visits'

/**
 * Débrief express (temps 2 — la voiture). Écran TRÈS simple. Une seule question
 * par élément : « est-ce que ça mérite une suite ? ». 4 choix métier — pas 7
 * destinations, pas de vocabulaire technique. Le tri ENREGISTRE la décision ;
 * le bureau matérialisera les suites. Cf. [[visite-trois-temps]].
 */
export type CapturePreview = { url: string; mime: string | null }

export function DebriefExpress({
  reportId,
  siteId,
  siteName,
  dossierId,
  questionsCount,
  initialObjective,
  initialCaptures,
  previews,
  impact,
}: {
  reportId: string
  siteId: string
  siteName: string
  /** Le dossier d'opération de la prévisite — cible du CTA « Préparer l'AO ». */
  dossierId: string | null
  /** ❓ « à vérifier » posées pendant la visite (hors captures). */
  questionsCount: number
  /** Objet de la visite déjà saisi (le CR l'affiche) — éditable ici. */
  initialObjective: string | null
  initialCaptures: VisitCaptureRow[]
  /** Aperçus signés (captureId → url/mime) pour trier en voyant le contenu. */
  previews: Record<string, CapturePreview>
  /** Impact sur la mémoire du chantier — « ce que cette visite change ». */
  impact: VisitImpact | null
}) {
  const router = useRouter()
  const [captures, setCaptures] = useState<VisitCaptureRow[]>(initialCaptures)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startBusy] = useTransition()
  // Traitement photo par photo (écran 2) : index de départ, null = fermé.
  const [triageStart, setTriageStart] = useState<number | null>(null)
  // Objet de la visite — éditable, enregistré au blur (aucun autre champ touché).
  const [objective, setObjective] = useState(initialObjective ?? '')
  const [savedObjective, setSavedObjective] = useState(initialObjective ?? '')

  function saveObjective() {
    const v = objective.trim()
    if (v === savedObjective.trim()) return
    startBusy(async () => {
      const r = await setVisitObjectiveAction({ report_id: reportId, objective: v })
      if (r.ok) { setSavedObjective(v); toast.success('Objet enregistré', { duration: 1200 }) }
      else toast.error(r.error)
    })
  }

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

  function decide(c: VisitCaptureRow, decision: TriageDecision, comment?: string) {
    const prev = c
    const canComment = c.kind === 'photo' || c.kind === 'video'
    // Optimiste : on reflète tout de suite le choix, on confirme en base derrière.
    const next: VisitCaptureRow = {
      ...c,
      status: decision === 'delete' ? 'discarded' : 'kept',
      triage_intent:
        decision === 'action' ? 'action'
        : decision === 'surveiller' ? 'follow'
        : decision === 'reserve' ? 'reserve'
        : null,
      ...(comment !== undefined && canComment ? { body: comment.trim() || null } : {}),
    }
    setCaptures((cs) => cs.map((x) => (x.id === c.id ? next : x)))
    setBusyId(c.id)
    startBusy(async () => {
      const r = await triageCaptureAction({ capture_id: c.id, decision, ...(comment !== undefined && canComment ? { comment } : {}) })
      setBusyId(null)
      if (!r.ok) {
        setCaptures((cs) => cs.map((x) => (x.id === c.id ? prev : x)))
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-48">
      {/* En-tête : la visite a une VRAIE fin — le cerveau doit sentir que c'est
          terminé et rangé. Affirmation « enregistrée » + réassurance mémoire. */}
      <header className="space-y-2 pt-2">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            {dossierId ? 'Fin de prévisite' : 'Fin de visite'}
          </p>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
            Visite enregistrée
          </h1>
          <p className="text-sm text-muted-foreground">
            {siteName} · {total} élément{total > 1 ? 's' : ''} relevé{total > 1 ? 's' : ''}
          </p>
        </div>
        {/* Composition de la visite — ce que l'agent a ramené, d'un coup d'œil. */}
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
        <p className="text-[13px] text-muted-foreground">Tout est enregistré dans MemorIA.</p>
      </header>

      {/* Objet de la visite — « pourquoi je suis venu ». Facultatif, apparaît dans
          le CR. Enregistré à la sortie du champ (aucun autre champ touché). */}
      <div className="space-y-1">
        <label htmlFor="visit-objective" className="text-xs font-medium text-muted-foreground">
          Objet de la visite <span className="font-normal text-muted-foreground/70">(facultatif)</span>
        </label>
        <input
          id="visit-objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onBlur={saveObjective}
          placeholder="ex. Contrôle étanchéité avant fermeture"
          maxLength={300}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Impact métier — la visite n'est pas juste enregistrée,
          elle a enrichi le chantier. 3-4 lignes, jamais un module lourd. */}
      {impact && <VisitImpactCard impact={impact} total={total} />}

      {total === 0 ? (
        <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Rien n&apos;a été capté pendant cette visite.
        </p>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Traiter les captures</h2>
            <span className="text-xs tabular-nums text-muted-foreground">{triaged}/{total} triés</span>
          </div>

          {/* Chemin rapide : photo par photo, 1 geste par capture (objectif < 2 min). */}
          <button
            type="button"
            onClick={() => {
              const first = captures.findIndex((c) => c.status === 'captured')
              setTriageStart(first === -1 ? 0 : first)
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white active:scale-[0.99] transition"
          >
            {triaged >= total
              ? 'Revoir les captures'
              : `Traiter ${total - triaged} capture${total - triaged > 1 ? 's' : ''}`}
            <ArrowRight className="h-4 w-4" />
          </button>

          <ul className="space-y-2">
            {captures.map((c, i) => (
              <CaptureCard key={c.id} capture={c} preview={previews[c.id]} busy={busyId === c.id} onOpen={() => setTriageStart(i)} />
            ))}
          </ul>
        </section>
      )}

      {/* Barre de fin — la question à cet instant est « qu'est-ce que je fais de ma
          visite ? ». On mène donc avec les SORTIES (voir / CR-PDF / ordinateur).
          Une vraie prévisite AO peut ENSUITE enchaîner sur l'AO — option secondaire,
          jamais le CTA dominant (sinon on donne l'impression de « lancer un AO »). */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-md space-y-2">
          <VisitOutputActions reportId={reportId} siteId={siteId} />
          {dossierId && (
            <Link
              href={`/dossiers/${dossierId}`}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-600/60 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-300"
            >
              <FileText className="h-4 w-4" /> Enchaîner : préparer l&apos;appel d&apos;offres <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          <button
            type="button"
            onClick={() => router.push(`/m/site/${siteId}`)}
            className="w-full rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground"
          >
            Retour au chantier
          </button>
        </div>
      </div>

      {/* Écran 2 — traitement photo par photo, plein écran (le vrai accélérateur). */}
      {triageStart !== null && (
        <CaptureTriage
          captures={captures}
          previews={previews}
          startIndex={triageStart}
          onDecide={(c, d, comment) => decide(c, d, comment)}
          onClose={() => setTriageStart(null)}
        />
      )}
    </div>
  )
}

/**
 * « Votre visite a fait avancer le chantier » — l'IMPACT métier, pas un inventaire.
 * On répond à « en quoi le chantier est-il différent maintenant ? » : points de
 * vigilance mis à jour, réserve à traiter, suivi enrichi — orienté CONSÉQUENCE,
 * puis la prochaine étape. Truthful : une ligne n'apparaît que si elle a de la
 * matière ; rien à dire = pas de carte (le conducteur doit sentir qu'il a fait
 * avancer son chantier, jamais lire un journal d'activité).
 */
function VisitImpactCard({ impact, total }: { impact: VisitImpact; total: number }) {
  const { added, touchedSubjects } = impact
  const plural = (n: number) => (n > 1 ? 's' : '')

  const lines: string[] = []

  // Conséquence 1 — les points de vigilance du chantier ont bougé.
  if (touchedSubjects.length > 0) {
    const n = touchedSubjects.length
    const names = touchedSubjects.slice(0, 2).join(', ')
    lines.push(`${n} point${plural(n)} de vigilance mis à jour${n <= 2 ? ` : ${names}` : ''}`)
  }
  // Conséquence 2 — une réserve à traiter est née de la visite.
  if (added.reserves > 0) {
    lines.push(`${added.reserves} réserve${plural(added.reserves)} à traiter créée${plural(added.reserves)}`)
  }
  // Conséquence 3 — des actions à suivre.
  if (added.actions > 0) {
    lines.push(`${added.actions} action${plural(added.actions)} à suivre créée${plural(added.actions)}`)
  }
  // Conséquence 4 — le SUIVI du chantier s'est enrichi (pas « 8 photos » brut).
  const enrichParts: string[] = []
  if (added.photos > 0) enrichParts.push(`${added.photos} photo${plural(added.photos)}`)
  if (added.notes > 0) enrichParts.push(`${added.notes} note${plural(added.notes)}`)
  const enrichWith = enrichParts.length > 0
    ? enrichParts.join(' et ')
    : total > 0 ? `${total} élément${plural(total)}` : null
  if (enrichWith) lines.push(`Le suivi du chantier a été enrichi avec ${enrichWith}`)

  if (lines.length === 0) return null

  return (
    <section className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
        Votre visite a fait avancer le chantier
      </h2>
      <ul className="space-y-1 text-[13px] text-emerald-900/90 dark:text-emerald-100/90">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-1.5">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span className="min-w-0">{l}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-1.5 border-t border-emerald-200/70 pt-2 text-[13px] text-emerald-800/80 dark:border-emerald-900/40 dark:text-emerald-200/70">
        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        Prochaine étape : compléter le compte-rendu au bureau
      </p>
    </section>
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

// Tag métier d'une capture déjà triée — chip discret dans la liste récap.
const TAG_META: Record<TriageDecision, { label: string; Icon: typeof BookMarked; cls: string }> = {
  memoire: { label: 'Mémoire', Icon: BookMarked, cls: 'text-slate-600 dark:text-slate-300' },
  surveiller: { label: 'À surveiller', Icon: Eye, cls: 'text-amber-600 dark:text-amber-400' },
  reserve: { label: 'Réserve', Icon: AlertTriangle, cls: 'text-rose-600 dark:text-rose-400' },
  action: { label: 'Action', Icon: Check, cls: 'text-emerald-600 dark:text-emerald-400' },
  delete: { label: 'Supprimé', Icon: Trash2, cls: 'text-muted-foreground' },
}

function currentDecision(c: VisitCaptureRow): TriageDecision | null {
  if (c.status === 'discarded') return 'delete'
  if (c.status === 'kept') {
    if (c.triage_intent === 'action') return 'action'
    if (c.triage_intent === 'follow') return 'surveiller'
    if (c.triage_intent === 'reserve') return 'reserve'
    return 'memoire'
  }
  return null
}

function CaptureCard({
  capture, preview, busy, onOpen,
}: {
  capture: VisitCaptureRow
  preview?: CapturePreview
  busy: boolean
  onOpen: () => void
}) {
  const chosen = currentDecision(capture)
  const meta = chosen ? TAG_META[chosen] : null
  const discarded = chosen === 'delete'

  return (
    <li className={`rounded-xl border p-3 transition-opacity ${discarded ? 'opacity-50' : ''} ${busy ? 'opacity-70' : ''}`}>
      {/* La ligne relevée + son tag actuel — un tap ouvre le plein écran de tri. */}
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-2.5 text-left">
        <span className="shrink-0 pt-0.5 text-emerald-700/80">{KIND_ICON[capture.kind]}</span>
        <p className="min-w-0 flex-1 text-sm leading-snug">
          {captureLabel(capture)}
          {capture.kind === 'vocal' && capture.transcript_status === 'pending' && (
            <span className="block text-[11px] text-muted-foreground">transcription…</span>
          )}
        </p>
        {meta ? (
          <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${meta.cls}`}>
            <meta.Icon className="h-3.5 w-3.5" />{meta.label}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
            À trier <ChevronRight className="h-3.5 w-3.5" />
          </span>
        )}
      </button>

      {/* Aperçu du CONTENU — un tap ouvre le tri plein écran (jamais à l'aveugle). */}
      {preview && capture.kind === 'photo' && (
        <button type="button" onClick={onOpen} className="mt-2 block w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="" className="max-h-48 w-full rounded-lg border object-cover" />
        </button>
      )}
      {preview && capture.kind === 'video' && (
        <video src={preview.url} controls playsInline className="mt-2 max-h-56 w-full rounded-lg border bg-black" />
      )}
      {preview && capture.kind === 'vocal' && (
        <audio src={preview.url} controls className="mt-2 w-full" />
      )}
    </li>
  )
}
