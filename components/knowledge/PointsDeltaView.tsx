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
// « Sans évolution prolongée » est un axe indépendant (lingering), peut chevaucher marginalement.
// Vocabulaire délibérément factuel (recette Vincent 2026-09-14, 3e passe) : « bloqué »
// suggérerait un obstacle identifié que MemorIA ne connaît pas — seule la durée sans
// évolution malgré plusieurs passages est une donnée réelle.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock, RotateCcw, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PointListEntry } from '@/lib/knowledge/tracked-point-list'

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'long', year: 'numeric' })
const frDate = (iso: string | null): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

// `?from=delta` : lu par la page fiche Point pour renvoyer « ← Retour au Delta chantier »
// au lieu du retour par défaut vers le sujet propriétaire (mandat recette Vincent 2026-09-14).
function pointHref(pointHrefPrefix: string, p: PointListEntry): string {
  return `${pointHrefPrefix}/${p.id}?from=delta`
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

const TOUJOURS_BLOQUES_COLLAPSED_COUNT = 3

// Résumé repliable (recette Vincent 2026-09-14, 2e passe) : la liste exhaustive des 20 Points
// lingering faisait doublon avec Pilotage ; « Voir dans Pilotage » promettait une navigation que
// Pilotage ne tient pas (98 Points à revoir, pas les 20 lingering isolés). On garde donc
// l'information dans le Delta lui-même — repliée par défaut (3 plus anciens), dépliable à la
// demande, sans jamais quitter la vue : les changements restent toujours visibles, la
// stagnation est résumée mais consultable sur un clic.
function ToujoursBloquesSummary({
  points,
  pointHrefPrefix,
}: {
  points: PointListEntry[]
  pointHrefPrefix: string
}) {
  const [expanded, setExpanded] = useState(false)
  const worst = points[0]
  const visible = expanded ? points : points.slice(0, TOUJOURS_BLOQUES_COLLAPSED_COUNT)
  const remaining = points.length - TOUJOURS_BLOQUES_COLLAPSED_COUNT

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 dark:border-rose-900/40 dark:bg-rose-950/10">
      <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-rose-700 dark:text-rose-300">
        <Clock className="h-3.5 w-3.5" />
        Sans évolution prolongée ({points.length})
      </p>
      {worst?.daysSinceLastEvent != null && (
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Jusqu&apos;à {worst.daysSinceLastEvent} jour{worst.daysSinceLastEvent !== 1 ? 's' : ''}
          {worst.passagesSinceEvent ? ` · ${worst.passagesSinceEvent} passage${worst.passagesSinceEvent !== 1 ? 's' : ''}` : ''} sans évolution
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {visible.map((p) => (
          <li key={p.id}>
            <Link
              href={pointHref(pointHrefPrefix, p)}
              className="block truncate rounded-md px-1.5 py-0.5 -mx-1.5 text-[13px] text-foreground hover:bg-rose-100/60 hover:underline dark:hover:bg-rose-900/20"
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[12.5px] font-medium text-rose-700 hover:underline dark:text-rose-300"
        >
          {expanded ? 'Réduire ↑' : `Voir les ${remaining} autres ↓`}
        </button>
      )}
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
          {lastPvDate ? `Points — depuis le dernier PV du ${frDate(lastPvDate)}` : 'Points — depuis le dernier PV'}
        </p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {nouveaux.length} nouveau{nouveaux.length !== 1 ? 'x' : ''} · {resolus.length} résolu{resolus.length !== 1 ? 's' : ''} ·{' '}
          {reouverts.length} réouvert{reouverts.length !== 1 ? 's' : ''} · {modifies.length} modifié{modifies.length !== 1 ? 's' : ''}
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          {unchangedCount} Point{unchangedCount !== 1 ? 's' : ''} sans évolution notable
          {toujoursBloques.length > 0 ? `, dont ${toujoursBloques.length} sans évolution prolongée` : ''}
        </p>
      </div>

      {!hasAnyDelta ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          Rien de nouveau depuis le dernier PV : aucun Point nouveau, résolu, réouvert ou sans évolution prolongée.
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
            accentCls="text-indigo-700 dark:text-indigo-300"
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
            accentCls="text-slate-700 dark:text-slate-300"
            points={modifies}
            pointHrefPrefix={pointHrefPrefix}
          />
          {toujoursBloques.length > 0 && (
            <ToujoursBloquesSummary points={toujoursBloques} pointHrefPrefix={pointHrefPrefix} />
          )}
        </>
      )}
    </div>
  )
}
