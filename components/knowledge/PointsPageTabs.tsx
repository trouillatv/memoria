'use client'

// ── POINTS — 3 onglets (mandat Vincent « POINTS — PILOTAGE COUCHE 1 ») ──
//
// Navigation : Pilotage | Par sujet | Tous les Points. « Par acteur » n'est PAS exposé dans ce
// lot. « Tous les Points » remonte `PointsListView` (filtres, vue liste uniquement — son bascule
// interne Liste/Par sujet est masqué via `allowSubjectGrouping={false}` pour ne pas dupliquer le
// niveau de nav « Par sujet » ci-dessus, mandat ajustement Pilotage item 3). « Par sujet »
// réutilise le même regroupement pur (`groupPointsBySubject`/`SubjectGroupCard`) déjà utilisé par
// `PointsListView`, sans filtres ni état supplémentaire.

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { PointsListView, groupPointsBySubject, SubjectGroupCard } from '@/components/knowledge/PointsListView'
import { PointsPilotageView } from '@/components/knowledge/PointsPilotageView'
import type { PointListEntry, PointListFilterOptions } from '@/lib/knowledge/tracked-point-list'

type Tab = 'pilotage' | 'subject' | 'all'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'pilotage', label: 'Pilotage' },
  { key: 'subject', label: 'Par sujet' },
  { key: 'all', label: 'Tous les Points' },
]

export function PointsPageTabs({
  points,
  filterOptions,
  pointHrefPrefix,
  subjectHrefPrefix,
  siteId,
}: {
  points: PointListEntry[]
  filterOptions: PointListFilterOptions
  pointHrefPrefix: string
  subjectHrefPrefix: string
  siteId: string
}) {
  const [tab, setTab] = useState<Tab>('pilotage')
  const subjectGroups = useMemo(() => groupPointsBySubject(points), [points])

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center rounded-lg border p-0.5 text-[13px]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium',
              tab === t.key ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pilotage' && <PointsPilotageView points={points} pointHrefPrefix={pointHrefPrefix} siteId={siteId} />}

      {tab === 'subject' && (
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

      {tab === 'all' && (
        <PointsListView
          points={points}
          filterOptions={filterOptions}
          pointHrefPrefix={pointHrefPrefix}
          subjectHrefPrefix={subjectHrefPrefix}
          allowSubjectGrouping={false}
        />
      )}
    </div>
  )
}
