'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Camera, Video, Mic, Pencil, Target, MapPin, BookMarked, AlertTriangle, Eye, Check, CheckCircle2, ArrowRight, ChevronRight, Trash2, Star, HelpCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { triageCaptureAction, refreshDebriefCapturesAction, setVisitObjectiveAction, type TriageDecision } from './debrief-actions'
import { listVisitCapturePreviewsAction } from '@/app/(field)/m/site/[siteId]/capture-actions'
import { CaptureTriage } from './CaptureTriage'
import { SuiteProposals } from './SuiteProposals'
import { VisitOutputActions } from './VisitOutputActions'
import type { VisitCaptureRow, VisitCaptureKind } from '@/lib/db/visit-captures'
import type { VisitImpact, VisitSuiteProposal } from '@/lib/db/visits'

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
  motive,
  questionsCount,
  initialObjective,
  initialCaptures,
  previews: initialPreviews,
  impact,
  initialSuites,
}: {
  reportId: string
  siteId: string
  siteName: string
  /** Le dossier d'opération de la prévisite — cible du CTA « Préparer l'AO ». */
  dossierId: string | null
  /** Intention de la visite (mig 186) — spécialise l'INTRO et la CONCLUSION. */
  motive: string | null
  /** ❓ « à vérifier » posées pendant la visite (hors captures). */
  questionsCount: number
  /** Objet de la visite déjà saisi (le CR l'affiche) — éditable ici. */
  initialObjective: string | null
  initialCaptures: VisitCaptureRow[]
  /** Aperçus signés (captureId → url/mime) pour trier en voyant le contenu. */
  previews: Record<string, CapturePreview>
  /** Impact sur la mémoire du chantier — « ce que cette visite change ». */
  impact: VisitImpact | null
  /** Suites proposées (tags Action/Réserve à matérialiser au chantier). */
  initialSuites: VisitSuiteProposal[]
}) {
  const router = useRouter()
  const [captures, setCaptures] = useState<VisitCaptureRow[]>(initialCaptures)
  // Aperçus en ÉTAT (et non prop figée) : une photo annotée ajoutée pendant le
  // tri doit apparaître avec sa miniature, donc on peut les recharger.
  const [previews, setPreviews] = useState<Record<string, CapturePreview>>(initialPreviews)
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

  // Après ajout d'une photo annotée : recharge captures + aperçus pour la faire
  // apparaître (nouvelle capture photo, non triée — le conducteur la taguera).
  async function refreshAfterAnnotation() {
    try {
      const [fresh, freshPreviews] = await Promise.all([
        refreshDebriefCapturesAction(reportId),
        listVisitCapturePreviewsAction(reportId),
      ])
      if (fresh.length) setCaptures(fresh)
      setPreviews((p) => ({ ...p, ...freshPreviews }))
    } catch { /* silencieux : la photo est enregistrée côté serveur de toute façon */ }
  }

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

  // L'INTENTION change la SENSATION de fin (intro + conclusion), pas le moteur.
  const isPremiere = motive === 'premiere'
  const isAo = motive === 'previsite_ao' || !!dossierId
  const overline = isPremiere ? 'Fin de première visite' : isAo ? 'Fin de prévisite' : 'Fin de visite'
  const title = isPremiere ? 'Première mémoire créée' : isAo ? 'Prévisite enregistrée' : 'Visite enregistrée'
  const reassure = isPremiere
    ? 'Ce chantier a maintenant une mémoire.'
    : isAo
      ? 'Base de votre analyse enregistrée.'
      : 'Tout est enregistré dans MemorIA.'

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-48">
      {/* En-tête : la visite a une VRAIE fin. Écran HOMOGÈNE entre les 3 intentions
          — seuls les mots changent, pour donner la bonne sensation métier. */}
      <header className="space-y-2 pt-2">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
            {overline}
          </p>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
            {title}
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
        <p className="text-[13px] text-muted-foreground">{reassure}</p>
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

      {/* Conclusion métier — la SENSATION de fin, selon l'intention :
          Première → mémoire de référence · Suivi → évolution · AO → base d'analyse. */}
      {impact && <VisitImpactCard impact={impact} total={total} motive={motive} isPremiere={isPremiere} isAo={isAo} />}

      {/* Suites à créer — les tags Action/Réserve deviennent des objets chantier
          (MemorIA propose, l'humain valide). */}
      <SuiteProposals initialSuites={initialSuites} />

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

      {/* Barre de fin — le téléphone CAPTURE, l'ordinateur EXPLOITE. La visite se
          termine TOUJOURS de la même façon (les sorties : voir / CR-PDF /
          ordinateur). Seuls le message et la destination du bouton principal
          changent selon le contexte — jamais de « lancement d'AO » sur le mobile. */}
      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 p-3 backdrop-blur safe-bottom">
        <div className="mx-auto max-w-md space-y-2">
          <VisitOutputActions
            reportId={reportId}
            siteId={siteId}
            onModify={() => setTriageStart(captures.findIndex((c) => c.status === 'captured') === -1 ? 0 : captures.findIndex((c) => c.status === 'captured'))}
          />
          {dossierId ? (
            <>
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
                Cette prévisite a enrichi le dossier d&apos;appel d&apos;offres. Les informations sont
                disponibles sur ordinateur pour préparer la réponse.
              </p>
              <Link
                href={`/dossiers/${dossierId}`}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-600/60 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-300"
              >
                Retour au dossier AO <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => router.push(`/m/site/${siteId}`)}
                className="w-full rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground"
              >
                Continuer la prévisite plus tard
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => router.push(`/m/site/${siteId}`)}
              className="w-full rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground"
            >
              Retour au chantier
            </button>
          )}
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
          onAnnotated={refreshAfterAnnotation}
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
// Conteneur HOMOGÈNE (même carte verte) ; seuls le titre, les lignes et le
// pied changent selon l'intention. C'est ce qui donne une SENSATION différente
// sans faire trois écrans.
function ImpactShell({ title, lines, footer }: { title: string; lines: string[]; footer: string }) {
  if (lines.length === 0 && !footer) return null
  return (
    <section className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{title}</h2>
      {lines.length > 0 && (
        <ul className="space-y-1 text-[13px] text-emerald-900/90 dark:text-emerald-100/90">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-1.5">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="min-w-0">{l}</span>
            </li>
          ))}
        </ul>
      )}
      {footer && (
        <p className="flex items-center gap-1.5 border-t border-emerald-200/70 pt-2 text-[13px] text-emerald-800/80 dark:border-emerald-900/40 dark:text-emerald-200/70">
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          {footer}
        </p>
      )}
    </section>
  )
}

function VisitImpactCard({ impact, total, isPremiere, isAo }: { impact: VisitImpact; total: number; motive: string | null; isPremiere: boolean; isAo: boolean }) {
  const { added, touchedSubjects } = impact
  const plural = (n: number) => (n > 1 ? 's' : '')

  // 🏗 PREMIÈRE VISITE — créer la mémoire de référence (« point zéro »).
  if (isPremiere) {
    const parts: string[] = []
    if (added.photos > 0) parts.push(`${added.photos} photo${plural(added.photos)}`)
    if (added.reserves > 0) parts.push(`${added.reserves} réserve${plural(added.reserves)}`)
    if (added.actions > 0) parts.push(`${added.actions} action${plural(added.actions)}`)
    const lines = ['Cette visite devient le point de référence du chantier.']
    if (parts.length > 0) lines.push(parts.join(' · '))
    return <ImpactShell title="Première mémoire créée" lines={lines} footer="Toutes les futures visites seront comparées à cette référence." />
  }

  // 📑 PRÉVISITE AO — la base de l'analyse (la mécanique AO vient au 2ᵉ temps).
  if (isAo) {
    const parts: string[] = []
    if (added.photos > 0) parts.push(`${added.photos} photo${plural(added.photos)}`)
    if (touchedSubjects.length > 0) parts.push(`${touchedSubjects.length} point${plural(touchedSubjects.length)} technique${plural(touchedSubjects.length)}`)
    if (added.reserves > 0) parts.push(`${added.reserves} point${plural(added.reserves)} de vigilance`)
    const lines = ['Cette visite constitue la base de votre analyse.']
    if (parts.length > 0) lines.push(`MemorIA a relevé : ${parts.join(' · ')}`)
    return <ImpactShell title="Prévisite enregistrée" lines={lines} footer="Toutes les observations seront réutilisées pour préparer l'analyse de l'appel d'offres." />
  }

  // 📷 SUIVI — faire évoluer la mémoire (le cas normal, inchangé).
  const lines: string[] = []
  if (touchedSubjects.length > 0) {
    const n = touchedSubjects.length
    const names = touchedSubjects.slice(0, 2).join(', ')
    lines.push(`${n} point${plural(n)} de vigilance mis à jour${n <= 2 ? ` : ${names}` : ''}`)
  }
  if (added.reserves > 0) lines.push(`${added.reserves} réserve${plural(added.reserves)} à traiter créée${plural(added.reserves)}`)
  if (added.actions > 0) lines.push(`${added.actions} action${plural(added.actions)} à suivre créée${plural(added.actions)}`)
  const enrichParts: string[] = []
  if (added.photos > 0) enrichParts.push(`${added.photos} photo${plural(added.photos)}`)
  if (added.notes > 0) enrichParts.push(`${added.notes} note${plural(added.notes)}`)
  const enrichWith = enrichParts.length > 0 ? enrichParts.join(' et ') : total > 0 ? `${total} élément${plural(total)}` : null
  if (enrichWith) lines.push(`Le suivi du chantier a été enrichi avec ${enrichWith}`)

  if (lines.length === 0) return null
  return <ImpactShell title="Cette visite enrichit la mémoire" lines={lines} footer="Cette visite enrichit l'historique du chantier." />
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
