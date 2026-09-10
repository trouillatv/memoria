'use client'

// ── LISTE DES POINTS D'UN CHANTIER — vue présentationnelle unique (Lot 1, mandat Vincent) ──
//
// Un seul composant, monté sur desktop ET mobile (même convention que `PointFicheView`).
// Purement présentationnel : la population et le tri (priorité opérationnelle puis dernière
// évolution) viennent déjà de `loadSiteTrackedPointList` — ce composant ne fait qu'un filtrage
// pur côté client (`filterPointList`), jamais un recalcul d'état.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  filterPointList,
  DEFAULT_POINT_LIST_FILTERS,
  type PointListFilters,
} from '@/lib/knowledge/tracked-point-list-filter'
import type { PointListEntry, PointListFilterOptions } from '@/lib/knowledge/tracked-point-list'
import type { PointComputedCurrentState } from '@/lib/knowledge/tracked-point-lifecycle-reducer'

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
  const filtered = useMemo(() => filterPointList(points, filters), [points, filters])

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
      </div>

      <p className="text-[12.5px] text-muted-foreground">
        {filtered.length} Point{filtered.length !== 1 ? 's' : ''}
        {filtered.length !== points.length ? ` sur ${points.length}` : ''}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          Aucun Point ne correspond à ces filtres.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => (
            <li key={p.id} className="rounded-xl border px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={`${pointHrefPrefix}/${p.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-foreground hover:underline">{p.label}</p>
                </Link>
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', STATE_BADGE_CLS[p.derivedState])}>
                  {POINT_STATE_LABEL[p.derivedState]}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                {p.subjectLabel && p.ownerCanonicalSubjectId && (
                  <Link href={`${subjectHrefPrefix}/${p.ownerCanonicalSubjectId}`} className="hover:underline hover:text-foreground">
                    Sujet : {p.subjectLabel}
                  </Link>
                )}
                {p.actorNames.length > 0 && <span>{p.actorNames.join(', ')}</span>}
                {p.latestMeaningfulEventAt && <span>Dernière évolution : {frDate(p.latestMeaningfulEventAt)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
