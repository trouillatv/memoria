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

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, HelpCircle, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PointListEntry } from '@/lib/knowledge/tracked-point-list'
import { recordPointReviewedAction } from '@/lib/knowledge/tracked-point-review-actions'

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

function ReviewCard({ p, pointHrefPrefix, siteId }: { p: PointListEntry; pointHrefPrefix: string; siteId: string }) {
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

export function PointsPilotageView({
  points,
  pointHrefPrefix,
  siteId,
}: {
  points: PointListEntry[]
  pointHrefPrefix: string
  siteId: string
}) {
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
  const reopenedCount = useMemo(() => toReview.filter((p) => p.derivedState === 'reopened').length, [toReview])
  const needsYouCount = useMemo(() => toReview.filter((p) => p.needsYouCount > 0).length, [toReview])
  // Habillage résumé Pilotage (mandat Vincent, item 3 lot 3 — « ça ne demande aucun nouveau
  // moteur, les catégories existent déjà ») : décomposition du bucket résiduel en ses 2 vraies
  // catégories nommées via isLingering/isChangedSinceLastPv (mêmes flags que reviewReasons).
  const lingeringCount = useMemo(
    () => toReview.filter((p) => p.derivedState !== 'reopened' && p.needsYouCount === 0 && p.isLingering).length,
    [toReview],
  )
  const changedCount = useMemo(
    () => toReview.filter((p) => p.derivedState !== 'reopened' && p.needsYouCount === 0 && p.isChangedSinceLastPv).length,
    [toReview],
  )
  // Filet de sécurité : tout Point ni réouvert, ni NeedsYou, ni lingering, ni changé au dernier
  // PV (aujourd'hui uniquement une attention canonique pertinente sans les autres raisons —
  // act_now=0 sur le corpus observé, cf. audit Lot 3). Jamais masqué si non nul.
  const otherSignalCount = useMemo(
    () =>
      toReview.filter(
        (p) => p.derivedState !== 'reopened' && p.needsYouCount === 0 && !p.isLingering && !p.isChangedSinceLastPv,
      ).length,
    [toReview],
  )

  const [subTab, setSubTab] = useState<'to_review' | 'reviewed'>('to_review')
  const [sessionActive, setSessionActive] = useState(false)
  const [index, setIndex] = useState(0)

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
      </div>
    )
  }

  if (sessionActive) {
    const current = toReview[Math.min(index, toReview.length - 1)]
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-[12.5px] text-muted-foreground">
          <span>Revue en cours : {index + 1}/{toReview.length}</span>
          <button
            type="button"
            onClick={() => setSessionActive(false)}
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Quitter la revue
          </button>
        </div>
        <ReviewCard p={current} pointHrefPrefix={pointHrefPrefix} siteId={siteId} />
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
            onClick={() => setIndex((i) => Math.min(toReview.length - 1, i + 1))}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Passer
          </button>
          <button
            type="button"
            disabled={index === toReview.length - 1}
            onClick={() => setIndex((i) => Math.min(toReview.length - 1, i + 1))}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[13px] font-medium',
              index === toReview.length - 1 ? 'cursor-not-allowed text-muted-foreground/50' : 'text-foreground hover:bg-muted',
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

      <div className="rounded-xl border p-4">
        <p className="text-[14.5px] font-medium text-foreground">
          {toReview.length} Point{toReview.length !== 1 ? 's' : ''} à revoir
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          dont {reopenedCount} réouvert{reopenedCount !== 1 ? 's' : ''} ·{' '}
          {needsYouCount > 0 ? (
            <Link href={`/sites/${siteId}/besoin-de-toi`} className="font-medium text-violet-700 hover:underline dark:text-violet-300">
              {needsYouCount} avec question MemorIA
            </Link>
          ) : (
            <>{needsYouCount} avec question MemorIA</>
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
          Commencer ma revue — {toReview.length}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-[12.5px] font-medium text-muted-foreground">À revoir maintenant</p>
        <div className="space-y-2">
          {toReview.map((p) => (
            <ReviewCard key={p.id} p={p} pointHrefPrefix={pointHrefPrefix} siteId={siteId} />
          ))}
        </div>
      </div>
    </div>
  )
}
