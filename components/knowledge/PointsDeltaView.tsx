'use client'

// ── POINTS — DELTA CHANTIER (mandat Vincent « GO Delta chantier », 2026-09-14) ──
//
// Promesse distincte d'Avant/Après (qui explique une comparaison entre deux PV choisis) : ici,
// on répond à « qu'est-ce qui a changé sur ce chantier, sans repartir chercher le débrief de
// telle visite » — une vue de consultation orientée Points et actions, pas un tableau d'états.
//
// AUCUN nouveau moteur : la catégorisation ci-dessous compose uniquement des signaux déjà gelés
// et déjà exposés par `loadSiteTrackedPointList` (isChangedSinceLastPv, isLingering, openedAt,
// derivedState, daysSinceLastEvent) — même convention que PointsPilotageView.tsx qui catégorise
// déjà `toReview` par useMemo sans passer par un fichier séparé. Partition mutuellement exclusive
// des Points changés au dernier PV (nouveau > réouvert > résolu > modifié, ordre business) ;
// « Toujours bloqués » est un axe indépendant (lingering), peut chevaucher marginalement.

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock, RotateCcw, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PointListEntry } from '@/lib/knowledge/tracked-point-list'

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })
const frDate = (iso: string | null): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

function pointHref(pointHrefPrefix: string, p: PointListEntry): string {
  return `${pointHrefPrefix}/${p.id}`
}

type DeltaCategory = 'new' | 'reopened' | 'resolved' | 'modified'

function categorize(p: PointListEntry): DeltaCategory | null {
  if (!p.isChangedSinceLastPv) return null
  if (p.openedAt && p.openedAt === p.latestMeaningfulEventAt) return 'new'
  if (p.derivedState === 'reopened') return 'reopened'
  if (p.derivedState === 'resolved') return 'resolved'
  return 'modified'
}

function DeltaRow({
  p,
  pointHrefPrefix,
  detail,
}: {
  p: PointListEntry
  pointHrefPrefix: string
  detail?: string
}) {
  return (
    <li className="rounded-xl border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link href={pointHref(pointHrefPrefix, p)} className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-foreground hover:underline">{p.label}</p>
        </Link>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        {p.subjectLabel && <span>{p.subjectLabel}</span>}
        {p.actorNames.length > 0 && <span>{p.actorNames.join(', ')}</span>}
        {detail && <span>{detail}</span>}
      </div>
    </li>
  )
}

function DeltaSection({
  title,
  icon,
  accentCls,
  points,
  pointHrefPrefix,
  detailFor,
}: {
  title: string
  icon: React.ReactNode
  accentCls: string
  points: PointListEntry[]
  pointHrefPrefix: string
  detailFor?: (p: PointListEntry) => string | undefined
}) {
  if (points.length === 0) return null
  return (
    <div className="space-y-2">
      <p className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium', accentCls)}>
        {icon}
        {title} ({points.length})
      </p>
      <ul className="space-y-2">
        {points.map((p) => (
          <DeltaRow key={p.id} p={p} pointHrefPrefix={pointHrefPrefix} detail={detailFor?.(p)} />
        ))}
      </ul>
    </div>
  )
}

export function PointsDeltaView({
  points,
  pointHrefPrefix,
  lastPvDate,
}: {
  points: PointListEntry[]
  pointHrefPrefix: string
  lastPvDate: string | null
}) {
  const { nouveaux, reouverts, resolus, modifies, toujoursBloques, changedTotal, unchangedCount } = useMemo(() => {
    const nouveaux: PointListEntry[] = []
    const reouverts: PointListEntry[] = []
    const resolus: PointListEntry[] = []
    const modifies: PointListEntry[] = []
    let changedTotal = 0
    for (const p of points) {
      const cat = categorize(p)
      if (!cat) continue
      changedTotal += 1
      if (cat === 'new') nouveaux.push(p)
      else if (cat === 'reopened') reouverts.push(p)
      else if (cat === 'resolved') resolus.push(p)
      else modifies.push(p)
    }
    const toujoursBloques = points
      .filter((p) => p.isLingering)
      .slice()
      .sort((a, b) => (b.daysSinceLastEvent ?? 0) - (a.daysSinceLastEvent ?? 0))
    // « Sans évolution notable » = ni changé au dernier PV, ni dans la sélection lingering
    // (les deux axes sont indépendants et peuvent marginalement se chevaucher — on ne
    // soustrait ici que les Points lingering qui ne sont pas déjà comptés dans changedTotal).
    const unchangedCount = points.length - changedTotal - toujoursBloques.filter((p) => categorize(p) === null).length
    return { nouveaux, reouverts, resolus, modifies, toujoursBloques, changedTotal, unchangedCount }
  }, [points])

  if (points.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
        Aucun Point suivi sur ce chantier.
      </p>
    )
  }

  const hasAnyDelta = changedTotal > 0 || toujoursBloques.length > 0

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4">
        <p className="text-[14.5px] font-medium text-foreground">
          {lastPvDate ? `Depuis le dernier PV du ${frDate(lastPvDate)}` : 'Depuis le dernier PV'}
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {nouveaux.length} nouveau{nouveaux.length !== 1 ? 'x' : ''} · {resolus.length} résolu{resolus.length !== 1 ? 's' : ''} ·{' '}
          {reouverts.length} réouvert{reouverts.length !== 1 ? 's' : ''} · {modifies.length} modifié{modifies.length !== 1 ? 's' : ''} ·{' '}
          {unchangedCount} sans évolution notable
        </p>
      </div>

      {!hasAnyDelta ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          Rien de nouveau depuis le dernier PV : aucun Point nouveau, résolu, réouvert ou bloqué.
        </p>
      ) : (
        <>
          <DeltaSection
            title="Réouverts"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            accentCls="text-orange-700 dark:text-orange-300"
            points={reouverts}
            pointHrefPrefix={pointHrefPrefix}
            detailFor={(p) => p.reviewReasons[0]}
          />
          <DeltaSection
            title="Nouveaux"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            accentCls="text-sky-700 dark:text-sky-300"
            points={nouveaux}
            pointHrefPrefix={pointHrefPrefix}
          />
          <DeltaSection
            title="Résolus"
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            accentCls="text-emerald-700 dark:text-emerald-300"
            points={resolus}
            pointHrefPrefix={pointHrefPrefix}
          />
          <DeltaSection
            title="Modifiés"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            accentCls="text-amber-700 dark:text-amber-300"
            points={modifies}
            pointHrefPrefix={pointHrefPrefix}
          />
          <DeltaSection
            title="Toujours bloqués"
            icon={<Clock className="h-3.5 w-3.5" />}
            accentCls="text-rose-700 dark:text-rose-300"
            points={toujoursBloques}
            pointHrefPrefix={pointHrefPrefix}
            detailFor={(p) =>
              p.daysSinceLastEvent !== null
                ? `Sans évolution depuis ${p.daysSinceLastEvent} j${p.passagesSinceEvent ? `, ${p.passagesSinceEvent} passage${p.passagesSinceEvent !== 1 ? 's' : ''}` : ''}`
                : undefined
            }
          />
        </>
      )}
    </div>
  )
}
