'use client'

// ── POINTS — 4 onglets (mandat Vincent « POINTS — PILOTAGE COUCHE 1 » + « GO Delta chantier »
// 2026-09-14) ──
//
// Navigation : Pilotage | Par sujet | Liste | Delta chantier. Chaque onglet a un rôle distinct et
// perceptible sans explication : Pilotage = Agir, Par sujet = Comprendre, Liste = Retrouver,
// Delta chantier = Reprendre (qu'est-ce qui a changé sur ce chantier, sans repartir chercher le
// débrief de telle visite — cf. PointsDeltaView.tsx). « Par acteur » n'est PAS exposé dans ce lot.
// « Liste » remonte `PointsListView` (filtres, vue liste dense uniquement — son bascule interne
// Liste/Par sujet est masqué via `allowSubjectGrouping={false}` pour ne pas dupliquer le niveau de
// nav « Par sujet » ci-dessus, mandat ajustement Pilotage item 3). « Par sujet » réutilise le même
// regroupement pur (`groupPointsBySubject`/`SubjectGroupCard`) déjà utilisé par `PointsListView`,
// sans filtres ni état supplémentaire.

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { PointsListView, groupPointsBySubject, SubjectGroupCard } from '@/components/knowledge/PointsListView'
import { PointsPilotageView } from '@/components/knowledge/PointsPilotageView'
import { PointsDeltaView } from '@/components/knowledge/PointsDeltaView'
import type { PointListEntry, PointListFilterOptions } from '@/lib/knowledge/tracked-point-list'

type Tab = 'pilotage' | 'subject' | 'all' | 'delta'

const TABS: Array<{ key: Tab; label: string; caption: string }> = [
  { key: 'pilotage', label: 'Pilotage', caption: "Agir — ce qui a besoin d'une décision maintenant" },
  { key: 'subject', label: 'Par sujet', caption: 'Comprendre — les Points regroupés par sujet' },
  { key: 'all', label: 'Liste', caption: 'Retrouver — tous les Points, recherche et filtres' },
  { key: 'delta', label: 'Delta chantier', caption: 'Reprendre — ce qui a changé depuis le dernier PV' },
]

export function PointsPageTabs({
  points,
  filterOptions,
  pointHrefPrefix,
  subjectHrefPrefix,
  siteId,
  lastPvDate,
  pointsHref,
  defaultTab,
}: {
  points: PointListEntry[]
  filterOptions: PointListFilterOptions
  pointHrefPrefix: string
  subjectHrefPrefix: string
  siteId: string
  lastPvDate: string | null
  /** Racine de la page Points (ex. `/sites/id/points`) — lien « Voir dans Pilotage » et
   *  base du retour `?tab=delta` depuis la fiche Point (recette Vincent 2026-09-14). */
  pointsHref: string
  /** Onglet initial. Permet à `?tab=delta` de rouvrir directement Delta chantier après
   *  un retour depuis la fiche Point, sans perdre le contexte de David. */
  defaultTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(defaultTab ?? 'pilotage')
  const subjectGroups = useMemo(() => groupPointsBySubject(points), [points])

  const activeCaption = TABS.find((t) => t.key === tab)?.caption ?? ''

  return (
    <div className="space-y-4">
      <div>
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
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{activeCaption}</p>
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

      {tab === 'delta' && (
        <PointsDeltaView points={points} pointHrefPrefix={pointHrefPrefix} lastPvDate={lastPvDate} pilotageHref={pointsHref} />
      )}
    </div>
  )
}
