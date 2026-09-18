'use client'

// ── POINTS — PILOTAGE (mandat Vincent « POINTS PILOTAGE — AJUSTEMENT AVANT RECETTE » +
// Couche 1.1 « Mémoire de revue ») ──
//
// Population « À revoir » = tout Point dont le fingerprint COURANT (calculé en amont par
// tracked-point-list.ts via l'unique primitive computeTrackedPointReviewFingerprint) diffère de
// celui déjà revu par CET utilisateur (ou n'a jamais été revu) — cf. `isReviewed`. La raison
// brute (fingerprint) n'est JAMAIS affichée : seules les `reviewReasons` textuelles déjà
// déterministes le sont (réouverture, NeedsYou, changement au dernier PV, Points qui traînent,
// attention canonique). « Revus par moi » = l'inverse (isReviewed === true) : disparaît
// automatiquement dès qu'un signal réel change (nouveau fingerprint), sans action de nettoyage.
//
// Le geste central « ✓ Marquer comme revu » (retour Vincent 2026-09-13 : « Revu, rien à faire »
// était trompeur — le chantier peut nécessiter des travaux même quand David n'a rien à faire dans
// MemorIA) enregistre le fingerprint COURANT (jamais fourni par le client — recalculé serveur dans
// recordPointReviewedAction). « Passer »/« Suivant » ne font AUCUNE écriture, c'est une navigation
// pure. « Ouvrir » pointe vers la fiche Point existante — aucun geste n'est réimplémenté ici.
//
// « Déjà revu » signifie « revu PAR CET UTILISATEUR », jamais « traité par l'équipe » : l'état
// métier réel du Point (résolu/ouvert/réouvert) reste totalement indépendant de cette mémoire.
//
// NeedsYou ⊂ À revoir (mandat Vincent, recette 2026-09-13) : une question MemorIA active est un
// sous-ensemble de « à revoir », jamais une file séparée. Tant qu'elle reste active sur ce Point,
// le geste « Marquer comme revu » n'est pas proposé (répondre à MemorIA n'est pas un geste
// d'acquittement fingerprint) et le bouton « Clarifier » ouvre directement la question précise sur
// la page de clarification (jamais la fiche Point, jamais la boîte générale) quand elle est
// identifiable sans ambiguïté (`needsYouQuestionId`).
//
// Doctrine à 2 niveaux (mandat Vincent 2026-09-17, suite audit P0-D « 9 Points à revoir / 0 avec
// question MemorIA » vs 23 questions actives sur le même chantier) : « Question sur un Point
// connu → sur le Point. Question avant création/rattachement d'un Point → au niveau chantier. »
// `needsYouCount` (par Point, ci-dessous) ne compte QUE les catégories qui portent réellement un
// pointId (duplicate_points/attach_information/assign_resolution) — voir
// filterMemoriaNeedsYouQuestionsForPoint. confirm_trackability et clarify_evidence n'ont
// STRUCTURELLEMENT aucun pointId : ce ne sont jamais des Points, jamais un faux rattachement — ce
// sont des questions de mémoire chantier, reçues via la prop `chantierNeedsYouCount` et affichées
// par une carte dédiée séparée de la liste des Points (jamais fusionnées, jamais comptées comme
// "N Points").

import { useMemo, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, HelpCircle, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PointListEntry } from '@/lib/knowledge/tracked-point-list'
import { recordPointReviewedAction } from '@/lib/knowledge/tracked-point-review-actions'
import { todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

// Même convention que PointsListView.tsx (DATE_FMT, Pacific/Noumea) — dupliquée ici car ce
// fichier est un composant client isolé, pas de dépendance croisée entre vues sœurs.
const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'short', year: 'numeric' })
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', hour: '2-digit', minute: '2-digit' })
const frDate = (iso: string | null): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)
const frTime = (iso: string): string => TIME_FMT.format(new Date(iso))

// `?from=pilotage` : lu par la fiche Point pour renvoyer « Retour au Pilotage » (navigation
// contextuelle Vincent 2026-09-14), même convention que `?from=delta` (PointsDeltaView).
function pointHref(pointHrefPrefix: string, p: PointListEntry): string {
  return `${pointHrefPrefix}/${p.id}?from=pilotage`
}

// Lien direct vers la question NeedsYou précise (jamais via la fiche Point, qui ignore `?q=`
// aujourd'hui — cf. audit mandat item 5). `fromPoint`/`fromLabel` sont TOUJOURS présents dès
// que le Point est identifié : ils permettent à besoin-de-toi de se recentrer sur les questions
// de ce Point (retour recette Vincent 2026-09-13, correction 3), même quand plusieurs questions
// concernent le Point (`needsYouQuestionId` alors null, `q` omis — pas de choix arbitraire).
function needsYouClarifyHref(siteId: string, p: PointListEntry): string {
  const base = `/sites/${siteId}/besoin-de-toi`
  const params = new URLSearchParams({ fromPoint: p.id, fromLabel: p.label })
  if (p.needsYouQuestionId) params.set('q', p.needsYouQuestionId)
  return `${base}?${params.toString()}`
}

// Composition réelle du Point, rendu compact Pilotage (mandat Vincent 2026-09-15 : « le quick
// win est pratiquement invisible là où il est le plus utile », David arrivant d'abord sur cet
// onglet). Distincte de `formatComposition` (PointsListView.tsx) : ici « aucune Action
// corrective » est affiché explicitement dès qu'il existe des Réserves sans réponse organisée
// (correctiveActionCount === 0) — un vrai signal métier, pas du bruit visuel à masquer — et la
// prochaine échéance rejoint la même ligne, en minuscule, plutôt qu'une ligne séparée.
//
// Signature visuelle (mandat Vincent, mini-lot filtres+couleurs 2026-09-15) : reprend
// EXACTEMENT les teintes déjà utilisées pour OBJECT_TYPE_BADGE_CLS dans PointFicheView.tsx
// (Action=sky, Réserve=amber, Échéance=violet) — jamais de nouvelles couleurs inventées. Deux
// axes de couleur volontairement séparés pour ne jamais se confondre (garde-fou explicite de
// Vincent) : la teinte de TYPE reste pastel/discrète sur le compteur lui-même, la couleur
// d'URGENCE (rouge=en retard, orange=proche ≤7j, neutre=pas urgente) ne s'applique QUE sur la
// date « prochaine échéance », jamais sur le compteur Échéance.
type PilotageCompositionSegment = { key: string; node: ReactNode }

function buildPilotageCompositionSegments(p: PointListEntry, today: string): PilotageCompositionSegment[] {
  const segments: PilotageCompositionSegment[] = []
  if (p.reserveCount > 0) {
    segments.push({
      key: 'reserve',
      node: (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          {p.reserveCount} Réserve{p.reserveCount > 1 ? 's' : ''}
        </span>
      ),
    })
  }
  if (p.actionCount > 0) {
    segments.push({
      key: 'action',
      node: (
        <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden />
          {p.actionCount} Action{p.actionCount > 1 ? 's' : ''}
        </span>
      ),
    })
  }
  if (p.deadlineCount > 0 && segments.length === 0) {
    segments.push({
      key: 'deadline',
      node: (
        <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" aria-hidden />
          {p.deadlineCount} Échéance{p.deadlineCount > 1 ? 's' : ''}
        </span>
      ),
    })
  }
  if (p.reserveCount > 0 && p.correctiveActionCount === 0) {
    segments.push({ key: 'corrective', node: <span>aucune Action corrective</span> })
  }
  if (p.nextDeadlineDate) {
    const urgencyCls =
      p.nextDeadlineDate < today
        ? 'font-medium text-rose-700 dark:text-rose-300'
        : p.nextDeadlineDate <= addDaysLocal(today, 7)
          ? 'font-medium text-orange-700 dark:text-orange-300'
          : ''
    segments.push({
      key: 'next-deadline',
      node: <span className={urgencyCls}>prochaine échéance {frDate(p.nextDeadlineDate)}</span>,
    })
  }
  return segments
}

function PilotageCompositionLine({ p, today }: { p: PointListEntry; today: string }) {
  const segments = buildPilotageCompositionSegments(p, today)
  if (segments.length === 0) return null
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted-foreground">
      {segments.map((seg, i) => (
        <span key={seg.key} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="text-muted-foreground/40">·</span>}
          {seg.node}
        </span>
      ))}
    </p>
  )
}

function MarkReviewedButton({ siteId, pointId }: { siteId: string; pointId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const r = await recordPointReviewedAction(siteId, pointId)
            if (!r.ok) { setError(r.error); return }
            router.refresh()
          })
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 px-3 py-1.5 text-[13px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Marquer comme revu
      </button>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

function ReviewCard({ p, pointHrefPrefix, siteId, today }: { p: PointListEntry; pointHrefPrefix: string; siteId: string; today: string }) {
  const isNeedsYou = p.needsYouCount > 0
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-foreground">{p.label}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {p.derivedState === 'reopened' && (
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900">
              Réouvert
            </span>
          )}
          {isNeedsYou && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-300 dark:bg-violet-900/40 dark:text-violet-300 dark:ring-violet-800">
              <HelpCircle className="h-3 w-3" /> Besoin de toi
            </span>
          )}
        </div>
      </div>
      {p.reviewReasons.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[13px] text-muted-foreground">
          {p.reviewReasons.map((reason, i) => (
            <li key={i}>Pourquoi maintenant : {reason}</li>
          ))}
        </ul>
      )}
      <PilotageCompositionLine p={p} today={today} />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span>Vu dans {p.mentionsCount}/{p.totalSiteVisits} PV</span>
        {p.openedAt && <span>Première apparition : {frDate(p.openedAt)}</span>}
        {p.latestMeaningfulEventAt && <span>Dernière évolution : {frDate(p.latestMeaningfulEventAt)}</span>}
        {p.passagesSinceEvent !== null && p.passagesSinceEvent > 0 && (
          <span>{p.passagesSinceEvent} passage{p.passagesSinceEvent !== 1 ? 's' : ''} sans changement depuis</span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={pointHref(pointHrefPrefix, p)}
          className="inline-flex items-center rounded-lg border px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
        >
          Ouvrir
        </Link>
        {isNeedsYou && (
          <Link
            href={needsYouClarifyHref(siteId, p)}
            className="inline-flex items-center rounded-lg border border-violet-300 px-3 py-1.5 text-[13px] font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/30"
          >
            Clarifier
          </Link>
        )}
        {!isNeedsYou && <MarkReviewedButton siteId={siteId} pointId={p.id} />}
      </div>
    </div>
  )
}

function ReviewedCard({ p, pointHrefPrefix }: { p: PointListEntry; pointHrefPrefix: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium text-foreground">{p.label}</p>
        {p.reviewedAt && <p className="text-[12px] text-muted-foreground">Revu à {frTime(p.reviewedAt)}</p>}
      </div>
      <Link
        href={pointHref(pointHrefPrefix, p)}
        className="shrink-0 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
      >
        Ouvrir
      </Link>
    </div>
  )
}

function ChantierNeedsYouCard({ siteId, count }: { siteId: string; count: number }) {
  if (count <= 0) return null
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/20">
      <p className="text-[14.5px] font-medium text-violet-900 dark:text-violet-200">
        MemorIA a besoin de toi — {count} question{count !== 1 ? 's' : ''}
      </p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Certaines questions concernent des éléments qui ne sont pas encore rattachés à un Point.
        Elles doivent être clarifiées avant de pouvoir créer ou enrichir des Points.
      </p>
      <Link
        href={`/sites/${siteId}/besoin-de-toi`}
        className="mt-3 inline-flex items-center rounded-lg border border-violet-300 px-3 py-1.5 text-[13px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/40"
      >
        Examiner les questions
      </Link>
    </div>
  )
}

type PilotageTypeFilter = 'all' | 'action' | 'reserve' | 'deadline'
type PilotageDeadlineFilter = 'all' | 'late' | 'upcoming' | 'none'

function parseTypeFilter(v: string | undefined): PilotageTypeFilter {
  return v === 'action' || v === 'reserve' || v === 'deadline' ? v : 'all'
}
function parseDeadlineFilter(v: string | undefined): PilotageDeadlineFilter {
  return v === 'late' || v === 'upcoming' || v === 'none' ? v : 'all'
}

// Pastille de couleur sur les filtres Type (harmonisation sous-lot 7, mandat Vincent
// 2026-09-17) : mêmes teintes que `buildPilotageCompositionSegments` ci-dessus — « Tous »
// reste neutre, jamais de nouvelle couleur inventée.
const TYPE_FILTERS: Array<{ key: PilotageTypeFilter; label: string; dotCls?: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'action', label: 'Avec Action', dotCls: 'bg-sky-500' },
  { key: 'reserve', label: 'Avec Réserve', dotCls: 'bg-amber-500' },
  { key: 'deadline', label: 'Avec Échéance', dotCls: 'bg-violet-500' },
]
const DEADLINE_FILTERS: Array<{ key: PilotageDeadlineFilter; label: string }> = [
  { key: 'all', label: 'Toutes' },
  { key: 'late', label: 'En retard' },
  { key: 'upcoming', label: 'À venir' },
  { key: 'none', label: 'Sans échéance' },
]

export function PointsPilotageView({
  points,
  pointHrefPrefix,
  siteId,
  chantierNeedsYouCount,
  defaultTypeFilter,
  defaultDeadlineFilter,
}: {
  points: PointListEntry[]
  pointHrefPrefix: string
  siteId: string
  /** Questions NeedsYou pré-Point (confirm_trackability + clarify_evidence) — jamais rattachables
   *  à un Point (aucun pointId). Jamais compté ni affiché comme des Points : ce sont des questions
   *  de mémoire chantier, surfacées par la carte dédiée ci-dessous (mandat Vincent 2026-09-17). */
  chantierNeedsYouCount: number
  /** Filtres Pilotage lus depuis l'URL par le serveur (`?ptype=`/`?pdeadline=`) — mandat Vincent
   *  2026-09-15 : « je ferais ces filtres directement en pensant qu'ils devront finir dans
   *  l'URL » (préparation du chantier navigation sans perte de contexte). Valeur brute non
   *  validée, la validation se fait ici via parseTypeFilter/parseDeadlineFilter. */
  defaultTypeFilter?: string
  defaultDeadlineFilter?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [typeFilter, setTypeFilterState] = useState<PilotageTypeFilter>(() => parseTypeFilter(defaultTypeFilter))
  const [deadlineFilter, setDeadlineFilterState] = useState<PilotageDeadlineFilter>(() => parseDeadlineFilter(defaultDeadlineFilter))

  function setUrlParam(key: string, value: string) {
    const params = new URLSearchParams(window.location.search)
    if (value === 'all') params.delete(key)
    else params.set(key, value)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  function setTypeFilter(next: PilotageTypeFilter) {
    setTypeFilterState(next)
    setUrlParam('ptype', next)
  }
  function setDeadlineFilter(next: PilotageDeadlineFilter) {
    setDeadlineFilterState(next)
    setUrlParam('pdeadline', next)
  }
  // « À revoir » = fingerprint courant actif ET pas encore revu par cet utilisateur DANS CET
  // ÉTAT (mandat Couche 1.1). Un Point déjà revu redevient à revoir dès qu'un signal réel change
  // (nouveau fingerprint), jamais par simple écoulement du temps.
  const toReview = useMemo(() => points.filter((p) => p.reviewFingerprint !== null && !p.isReviewed), [points])
  const reviewedPoints = useMemo(
    () =>
      points
        .filter((p) => p.isReviewed)
        .slice()
        .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '')),
    [points],
  )

  const today = todayLocalIso()

  // Filtres Type/Échéance (mandat Vincent 2026-09-15) : isoler rapidement les Points sans ouvrir
  // chaque fiche. N'affectent QUE la population « À revoir » — le nombre affiché sur l'onglet
  // reste le total non filtré, seul le contenu affiché dessous change. Raccourci « Avec
  // échéance » : sélectionner ce filtre trie aussi par échéance la plus proche, plutôt qu'un
  // bouton de tri séparé (garde le mini-lot simple, pas un tableau de filtres).
  const visibleToReview = useMemo(() => {
    let list = toReview
    if (typeFilter === 'action') list = list.filter((p) => p.actionCount > 0)
    else if (typeFilter === 'reserve') list = list.filter((p) => p.reserveCount > 0)
    else if (typeFilter === 'deadline') list = list.filter((p) => p.deadlineCount > 0)
    if (deadlineFilter === 'late') list = list.filter((p) => p.nextDeadlineDate !== null && p.nextDeadlineDate < today)
    else if (deadlineFilter === 'upcoming') list = list.filter((p) => p.nextDeadlineDate !== null && p.nextDeadlineDate >= today)
    else if (deadlineFilter === 'none') list = list.filter((p) => p.nextDeadlineDate === null)
    if (typeFilter === 'deadline') {
      list = list.slice().sort((a, b) => (a.nextDeadlineDate ?? '9999-99-99').localeCompare(b.nextDeadlineDate ?? '9999-99-99'))
    }
    return list
  }, [toReview, typeFilter, deadlineFilter, today])

  const reopenedCount = useMemo(() => visibleToReview.filter((p) => p.derivedState === 'reopened').length, [visibleToReview])
  const needsYouCount = useMemo(() => visibleToReview.filter((p) => p.needsYouCount > 0).length, [visibleToReview])
  // Habillage résumé Pilotage (mandat Vincent, item 3 lot 3 — « ça ne demande aucun nouveau
  // moteur, les catégories existent déjà ») : décomposition du bucket résiduel en ses 2 vraies
  // catégories nommées via isLingering/isChangedSinceLastPv (mêmes flags que reviewReasons).
  const lingeringCount = useMemo(
    () => visibleToReview.filter((p) => p.derivedState !== 'reopened' && p.needsYouCount === 0 && p.isLingering).length,
    [visibleToReview],
  )
  const changedCount = useMemo(
    () => visibleToReview.filter((p) => p.derivedState !== 'reopened' && p.needsYouCount === 0 && p.isChangedSinceLastPv).length,
    [visibleToReview],
  )
  // Filet de sécurité : tout Point ni réouvert, ni NeedsYou, ni lingering, ni changé au dernier
  // PV (aujourd'hui uniquement une attention canonique pertinente sans les autres raisons —
  // act_now=0 sur le corpus observé, cf. audit Lot 3). Jamais masqué si non nul.
  const otherSignalCount = useMemo(
    () =>
      visibleToReview.filter(
        (p) => p.derivedState !== 'reopened' && p.needsYouCount === 0 && !p.isLingering && !p.isChangedSinceLastPv,
      ).length,
    [visibleToReview],
  )

  const [subTab, setSubTab] = useState<'to_review' | 'reviewed'>('to_review')
  const [sessionActive, setSessionActive] = useState(false)
  const [index, setIndex] = useState(0)

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5 text-[12.5px]">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setTypeFilter(f.key)}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium', typeFilter === f.key ? 'bg-muted text-foreground' : 'text-muted-foreground')}
          >
            {f.dotCls && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', f.dotCls)} aria-hidden />}
            {f.label}
          </button>
        ))}
      </div>
      <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5 text-[12.5px]">
        {DEADLINE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setDeadlineFilter(f.key)}
            className={cn('rounded-md px-2.5 py-1 font-medium', deadlineFilter === f.key ? 'bg-muted text-foreground' : 'text-muted-foreground')}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )

  const tabs = (
    <div className="inline-flex items-center rounded-lg border p-0.5 text-[13px]">
      <button
        type="button"
        onClick={() => setSubTab('to_review')}
        className={cn('rounded-md px-3 py-1.5 font-medium', subTab === 'to_review' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      >
        À revoir ({toReview.length})
      </button>
      <button
        type="button"
        onClick={() => setSubTab('reviewed')}
        className={cn('rounded-md px-3 py-1.5 font-medium', subTab === 'reviewed' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
      >
        Revus par moi ({reviewedPoints.length})
      </button>
    </div>
  )

  if (subTab === 'reviewed') {
    return (
      <div className="space-y-4">
        {tabs}
        {reviewedPoints.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
            Aucun Point revu pour l’instant.
          </p>
        ) : (
          <div className="space-y-2">
            {reviewedPoints.map((p) => (
              <ReviewedCard key={p.id} p={p} pointHrefPrefix={pointHrefPrefix} />
            ))}
          </div>
        )}
      </div>
    )
  }

  if (toReview.length === 0) {
    return (
      <div className="space-y-4">
        {tabs}
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          Aucun Point à revoir : rien de réouvert, aucune question MemorIA en attente, rien qui traîne ni n’a changé récemment.
        </p>
        <ChantierNeedsYouCard siteId={siteId} count={chantierNeedsYouCount} />
      </div>
    )
  }

  if (visibleToReview.length === 0) {
    return (
      <div className="space-y-4">
        {tabs}
        {filterBar}
        <div className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          <p>Aucun Point ne correspond à ces filtres.</p>
          <button
            type="button"
            onClick={() => { setTypeFilter('all'); setDeadlineFilter('all') }}
            className="mt-2 font-medium text-foreground hover:underline"
          >
            Réinitialiser les filtres
          </button>
        </div>
        <ChantierNeedsYouCard siteId={siteId} count={chantierNeedsYouCount} />
      </div>
    )
  }

  if (sessionActive) {
    const current = visibleToReview[Math.min(index, visibleToReview.length - 1)]
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
          <span>Revue en cours : {index + 1}/{visibleToReview.length}</span>
          <button
            type="button"
            onClick={() => setSessionActive(false)}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Quitter la revue
          </button>
        </div>
        <ReviewCard p={current} pointHrefPrefix={pointHrefPrefix} siteId={siteId} today={today} />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[13px] font-medium',
              index === 0 ? 'cursor-not-allowed text-muted-foreground/50' : 'text-foreground hover:bg-muted',
            )}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Précédent
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(visibleToReview.length - 1, i + 1))}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Passer
          </button>
          <button
            type="button"
            disabled={index === visibleToReview.length - 1}
            onClick={() => setIndex((i) => Math.min(visibleToReview.length - 1, i + 1))}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[13px] font-medium',
              index === visibleToReview.length - 1 ? 'cursor-not-allowed text-muted-foreground/50' : 'text-foreground hover:bg-muted',
            )}
          >
            Suivant <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {tabs}
      {filterBar}

      <div className="rounded-xl border p-4">
        <p className="text-[14.5px] font-medium text-foreground">
          {visibleToReview.length} Point{visibleToReview.length !== 1 ? 's' : ''} à revoir
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          dont {reopenedCount} réouvert{reopenedCount !== 1 ? 's' : ''}
          {needsYouCount > 0 && (
            <>
              {' · '}
              <Link href={`/sites/${siteId}/besoin-de-toi`} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
                {needsYouCount} avec question liée au Point
              </Link>
            </>
          )}
          {lingeringCount > 0 && <> · {lingeringCount} qui traîne{lingeringCount !== 1 ? 'nt' : ''}</>}
          {changedCount > 0 && <> · {changedCount} changé{changedCount !== 1 ? 's' : ''} au dernier PV</>}
          {otherSignalCount > 0 && <> · {otherSignalCount} autre signal{otherSignalCount !== 1 ? 's' : ''}</>}
        </p>
        <button
          type="button"
          onClick={() => { setIndex(0); setSessionActive(true) }}
          className="mt-3 inline-flex items-center rounded-lg border px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-muted"
        >
          Commencer ma revue — {visibleToReview.length}
        </button>
      </div>

      <ChantierNeedsYouCard siteId={siteId} count={chantierNeedsYouCount} />

      <div className="space-y-2">
        <p className="text-[12.5px] font-medium text-muted-foreground">À revoir maintenant</p>
        <div className="space-y-2">
          {visibleToReview.map((p) => (
            <ReviewCard key={p.id} p={p} pointHrefPrefix={pointHrefPrefix} siteId={siteId} today={today} />
          ))}
        </div>
      </div>
    </div>
  )
}
