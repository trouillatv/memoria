'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.3)
//
// Drawer latéral (panneau de détail) affiché au click sur une cellule de la
// grille semaine. Lecture seule en 9.3 — la réassignation arrive en 9.4.
//
// Architecture :
//   - Le composant englobe les enfants (la grille rendue côté serveur)
//   - Event delegation : on intercepte les clicks sur `[data-cell-trigger]`
//     (les boutons rendus par WeekGridCell) et on lit `data-cell-key`
//   - L'index `cellsIndex` est une map `siteId::yyyy-mm-dd → interventions`
//
// Doctrine V2 :
//   - Wording neutre. Pas de "en retard", pas de "performance".
//   - Créneaux nommés (matin / après-midi / soir), JAMAIS d'heure.
//   - StatusBadge unifié pour le statut intervention.
//   - Pas de bouton "réassigner" / "déplacer" : Slice 9.4.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, MapPin } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { StatusBadge } from '@/components/ui/status-badge'
import { TeamBadge } from '@/components/ui/team-badge'
import type { SiteRow, WeekInterventionCell } from '@/lib/db/week-planning'

const SLOT_FR: Record<string, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
}

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

const WEEKDAYS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']

function formatLongDate(iso: string): string {
  const parts = iso.split('-')
  if (parts.length !== 3) return iso
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return iso
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = WEEKDAYS_FR[date.getUTCDay()] ?? ''
  return `${weekday} ${day} ${MONTHS_FR[month - 1] ?? ''} ${year}`
}

export interface CellDrawerProps {
  /** Lignes de la grille — utilisées pour reconstruire un index cellule → interventions. */
  rows: SiteRow[]
  /** Contenu du conteneur (grille server-rendered). */
  children: React.ReactNode
}

interface SelectedCell {
  siteId: string
  siteName: string
  contractName: string
  date: string
  cells: WeekInterventionCell[]
}

function buildIndex(rows: SiteRow[]): Map<string, SelectedCell> {
  const idx = new Map<string, SelectedCell>()
  for (const row of rows) {
    for (const [date, cells] of Object.entries(row.days)) {
      idx.set(`${row.site_id}::${date}`, {
        siteId: row.site_id,
        siteName: row.site_name,
        contractName: row.contract_name,
        date,
        cells,
      })
    }
  }
  return idx
}

export function CellDrawer({ rows, children }: CellDrawerProps) {
  const cellsIndex = useMemo(() => buildIndex(rows), [rows])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const handleContainerClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const trigger = target.closest<HTMLElement>('[data-cell-trigger="true"]')
      if (!trigger) return
      const key = trigger.getAttribute('data-cell-key')
      if (!key) return
      if (!cellsIndex.has(key)) return
      setSelectedKey(key)
    },
    [cellsIndex],
  )

  const selected = selectedKey ? cellsIndex.get(selectedKey) ?? null : null

  // Cleanup : si rows change (revalidatePath suite à une slice future), reset
  useEffect(() => {
    if (selectedKey && !cellsIndex.has(selectedKey)) setSelectedKey(null)
  }, [cellsIndex, selectedKey])

  return (
    <>
      <div onClick={handleContainerClick} data-slot="cell-drawer-host">
        {children}
      </div>
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedKey(null)}>
        <SheetContent side="right" className="p-0 sm:max-w-md w-full overflow-y-auto">
          <SheetHeader className="border-b p-4">
            <SheetTitle>
              {selected ? selected.siteName : 'Détail'}
            </SheetTitle>
            <SheetDescription>
              {selected ? (
                <span className="flex flex-col gap-1 text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {selected.contractName}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" /> {formatLongDate(selected.date)}
                  </span>
                </span>
              ) : null}
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 py-3 space-y-3">
            {selected && selected.cells.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Aucune intervention planifiée ce jour.
              </p>
            ) : null}

            {selected?.cells.map((c) => (
              <article
                key={c.id}
                data-testid={`drawer-intervention-${c.id}`}
                className="rounded-md border bg-card p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-foreground truncate">
                      {c.mission_name}
                    </h3>
                    {c.slot ? (
                      <p className="text-xs text-muted-foreground">
                        Créneau {SLOT_FR[c.slot]?.toLowerCase() ?? c.slot}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Équipe</span>
                  {c.assigned_team_id && c.assigned_team_name ? (
                    <TeamBadge
                      name={c.assigned_team_name}
                      color={c.assigned_team_color}
                      size="sm"
                    />
                  ) : (
                    <span
                      className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                      title="Aucune équipe affectée"
                    >
                      ◯ Non-affecté
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
