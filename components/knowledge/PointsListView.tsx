'use client'

// ── LISTE DES POINTS D'UN CHANTIER — vue présentationnelle unique (Lot 1, mandat Vincent) ──
//
// Un seul composant, monté sur desktop ET mobile (même convention que `PointFicheView`).
// Purement présentationnel : la population et le tri (priorité opérationnelle puis dernière
// évolution) viennent déjà de `loadSiteTrackedPointList` — ce composant ne fait qu'un filtrage
// pur côté client (`filterPointList`) et, pour la vue « Par sujet », un regroupement pur des
// mêmes entrées déjà filtrées (aucun nouveau moteur, aucune requête).

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { HelpCircle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  filterPointList,
  DEFAULT_POINT_LIST_FILTERS,
  type PointListFilters,
} from '@/lib/knowledge/tracked-point-list-filter'
import type { PointListEntry, PointListFilterOptions } from '@/lib/knowledge/tracked-point-list'
import type { PointComputedCurrentState } from '@/lib/knowledge/tracked-point-lifecycle-reducer'

// Dupliqué depuis `tracked-point-needs-you-summary.ts` (needsYouQuestionHref) : ce module
// chaîne vers des read-models server-only (queues NeedsYou), inutilisable depuis un composant
// client — même contrainte que POINT_STATE_LABEL ci-dessus. Logique triviale (concat de query
// string), aucun risque de divergence.
function pointHref(pointHrefPrefix: string, p: PointListEntry): string {
  const base = `${pointHrefPrefix}/${p.id}`
  return p.needsYouQuestionId ? `${base}?q=${encodeURIComponent(p.needsYouQuestionId)}` : base
}

// Dupliqué depuis `tracked-point-detail.ts` (POINT_STATE_LABEL) : ce fichier est server-only
// (chaîne d'imports jusqu'à `lib/supabase/admin.ts`), inutilisable depuis un composant client.
const POINT_STATE_LABEL: Record<PointComputedCurrentState, string> = {
  unknown: 'Inconnu',
  open: 'Ouvert',
  resolved: 'Résolu',
  reopened: 'Réouvert',
  conflict: 'Conflit',
}

const STATE_BADGE_CLS: Record<PointComputedCurrentState, string> = {
  unknown: 'bg-muted text-muted-foreground ring-border',
  open: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  reopened: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900',
  conflict: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
}

const STATE_ORDER: PointComputedCurrentState[] = ['reopened', 'conflict', 'open', 'unknown', 'resolved']

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Pacific/Noumea', day: 'numeric', month: 'short', year: 'numeric' })
const frDate = (iso: string | null): string | null => (iso ? DATE_FMT.format(new Date(iso)) : null)

const SELECT_CLS = 'rounded-lg border bg-background px-2.5 py-1.5 text-[13px]'

// Nombre de Points prioritaires affichés par sujet avant « Voir les autres » (mandat : 3-5).
const SUBJECT_GROUP_PREVIEW_SIZE = 5

interface PointRowProps {
  p: PointListEntry
  pointHrefPrefix: string
  subjectHrefPrefix: string
  showSubject: boolean
}

function PointRow({ p, pointHrefPrefix, subjectHrefPrefix, showSubject }: PointRowProps) {
  return (
    <li className="rounded-xl border px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link href={pointHref(pointHrefPrefix, p)} className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-foreground hover:underline">{p.label}</p>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          {p.needsYouCount > 0 && (
            <Link
              href={pointHref(pointHrefPrefix, p)}
              className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-300 dark:bg-violet-900/40 dark:text-violet-300 dark:ring-violet-800"
            >
              <HelpCircle className="h-3 w-3" /> Besoin de toi
            </Link>
          )}
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', STATE_BADGE_CLS[p.derivedState])}>
            {POINT_STATE_LABEL[p.derivedState]}
          </span>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        {showSubject && p.subjectLabel && p.ownerCanonicalSubjectId && (
          <Link href={`${subjectHrefPrefix}/${p.ownerCanonicalSubjectId}`} className="hover:underline hover:text-foreground">
            Sujet : {p.subjectLabel}
          </Link>
        )}
        {p.actorNames.length > 0 && <span>{p.actorNames.join(', ')}</span>}
        {p.latestMeaningfulEventAt && <span>Dernière évolution : {frDate(p.latestMeaningfulEventAt)}</span>}
      </div>
    </li>
  )
}

interface SubjectGroup {
  subjectId: string | null
  subjectLabel: string
  points: PointListEntry[]
}

// Regroupement PUR des Points déjà filtrés/triés par sujet (mandat item 5, « Organisation
// Points »). Aucune requête, aucun recalcul d'état : le tri interne à chaque groupe est celui
// déjà produit par `loadSiteTrackedPointList`/`sortPointsForSubjectDisplay`. L'ordre des groupes
// suit le premier Point rencontré (donc les sujets les plus prioritaires apparaissent en premier).
function groupPointsBySubject(points: PointListEntry[]): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>()
  for (const p of points) {
    const key = p.ownerCanonicalSubjectId ?? '__sans_sujet__'
    let group = groups.get(key)
    if (!group) {
      group = {
        subjectId: p.ownerCanonicalSubjectId,
        subjectLabel: p.ownerCanonicalSubjectId ? p.subjectLabel ?? 'Sujet sans libellé' : 'Sans sujet',
        points: [],
      }
      groups.set(key, group)
    }
    group.points.push(p)
  }
  return [...groups.values()]
}

function SubjectGroupCard({
  group,
  pointHrefPrefix,
  subjectHrefPrefix,
}: {
  group: SubjectGroup
  pointHrefPrefix: string
  subjectHrefPrefix: string
}) {
  const [expanded, setExpanded] = useState(false)
  const reopenedCount = group.points.filter((p) => p.derivedState === 'reopened').length
  const needsYouCount = group.points.filter((p) => p.needsYouCount > 0).length
  const visible = expanded ? group.points : group.points.slice(0, SUBJECT_GROUP_PREVIEW_SIZE)
  const remaining = group.points.length - visible.length

  return (
    <div className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {group.subjectId ? (
            <Link href={`${subjectHrefPrefix}/${group.subjectId}`} className="text-[13.5px] font-semibold text-foreground hover:underline">
              {group.subjectLabel}
            </Link>
          ) : (
            <span className="text-[13.5px] font-semibold text-foreground">{group.subjectLabel}</span>
          )}
          <span className="text-[12px] text-muted-foreground">
            {group.points.length} Point{group.points.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {reopenedCount > 0 && (
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900">
              {reopenedCount} réouvert{reopenedCount !== 1 ? 's' : ''}
            </span>
          )}
          {needsYouCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-300 dark:bg-violet-900/40 dark:text-violet-300 dark:ring-violet-800">
              <HelpCircle className="h-3 w-3" /> {needsYouCount}
            </span>
          )}
        </div>
      </div>
      <ul className="space-y-2">
        {visible.map((p) => (
          <PointRow key={p.id} p={p} pointHrefPrefix={pointHrefPrefix} subjectHrefPrefix={subjectHrefPrefix} showSubject={false} />
        ))}
      </ul>
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 inline-flex items-center gap-1 px-1 text-[12.5px] font-medium text-primary hover:underline"
        >
          <ChevronDown className="h-3.5 w-3.5" /> Voir les {remaining} autre{remaining !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}

export function PointsListView({
  points,
  filterOptions,
  pointHrefPrefix,
  subjectHrefPrefix,
}: {
  points: PointListEntry[]
  filterOptions: PointListFilterOptions
  /** ex. `/sites/<id>/point` ou `/m/site/<siteId>/point` */
  pointHrefPrefix: string
  /** ex. `/sites/<id>/historique/sujets` ou `/m/site/<siteId>/sujets` */
  subjectHrefPrefix: string
}) {
  const [filters, setFilters] = useState<PointListFilters>(DEFAULT_POINT_LIST_FILTERS)
  const [view, setView] = useState<'list' | 'subject'>('list')
  const filtered = useMemo(() => filterPointList(points, filters), [points, filters])
  const needsYouTotal = useMemo(() => points.filter((p) => p.needsYouCount > 0).length, [points])
  const subjectGroups = useMemo(() => groupPointsBySubject(filtered), [filtered])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          placeholder="Rechercher un Point…"
          className="min-w-[180px] flex-1 rounded-lg border bg-background px-3 py-1.5 text-[13px]"
        />
        <select
          value={filters.state}
          onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value as PointListFilters['state'] }))}
          className={SELECT_CLS}
        >
          <option value="all">Tous les états</option>
          {STATE_ORDER.map((s) => (
            <option key={s} value={s}>{POINT_STATE_LABEL[s]}</option>
          ))}
        </select>
        {filterOptions.subjects.length > 0 && (
          <select
            value={filters.subjectId}
            onChange={(e) => setFilters((f) => ({ ...f, subjectId: e.target.value }))}
            className={SELECT_CLS}
          >
            <option value="all">Tous les sujets</option>
            {filterOptions.subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        )}
        {filterOptions.actors.length > 0 && (
          <select
            value={filters.actor}
            onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
            className={SELECT_CLS}
          >
            <option value="all">Tous les acteurs</option>
            {filterOptions.actors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
        {needsYouTotal > 0 && (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, needsYouOnly: !f.needsYouOnly }))}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium',
              filters.needsYouOnly
                ? 'border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-800 dark:bg-violet-900/40 dark:text-violet-300'
                : 'bg-background text-muted-foreground',
            )}
          >
            <HelpCircle className="h-3.5 w-3.5" /> Besoin de moi ({needsYouTotal})
          </button>
        )}
        <div className="ml-auto inline-flex items-center rounded-lg border p-0.5 text-[13px]">
          <button
            type="button"
            onClick={() => setView('list')}
            className={cn('rounded-md px-2.5 py-1 font-medium', view === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
          >
            Liste
          </button>
          <button
            type="button"
            onClick={() => setView('subject')}
            className={cn('rounded-md px-2.5 py-1 font-medium', view === 'subject' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
          >
            Par sujet
          </button>
        </div>
      </div>

      <p className="text-[12.5px] text-muted-foreground">
        {filtered.length} Point{filtered.length !== 1 ? 's' : ''}
        {filtered.length !== points.length ? ` sur ${points.length}` : ''}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          Aucun Point ne correspond à ces filtres.
        </p>
      ) : view === 'list' ? (
        <ul className="space-y-2">
          {filtered.map((p) => (
            <PointRow key={p.id} p={p} pointHrefPrefix={pointHrefPrefix} subjectHrefPrefix={subjectHrefPrefix} showSubject />
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          {subjectGroups.map((group) => (
            <SubjectGroupCard
              key={group.subjectId ?? '__sans_sujet__'}
              group={group}
              pointHrefPrefix={pointHrefPrefix}
              subjectHrefPrefix={subjectHrefPrefix}
            />
          ))}
        </div>
      )}
    </div>
  )
}
