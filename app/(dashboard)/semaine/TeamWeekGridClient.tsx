'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.5)
//
// Orchestrateur DnD + drawer pour la grille Équipe × Jour (vue secondaire).
//
// Réutilise les server actions Slice 9.4 :
//   - moveInterventionToDayAction : déplacement entre jours dans la MÊME équipe
//   - reassignInterventionTeamAction : changement d'équipe (mêmes jour OU
//     simplification : on traite UN changement à la fois — voir règles ci-dessous)
//
// Règles de drop (UNE seule action par drop pour rester lisible côté audit) :
//   - Drop sur la même cellule → no-op silencieux
//   - Drop sur autre jour, même équipe → moveInterventionToDayAction
//   - Drop sur autre équipe, même jour → reassignInterventionTeamAction
//   - Drop sur autre équipe ET autre jour → on priorise la réassignation équipe.
//     Toast info : "Équipe réassignée — la date reste inchangée. Replanifiez en
//     glissant à nouveau si besoin." C'est la simplification doctrinaire : une
//     action atomique par drop, pas de batch.
//
// Doctrine V2 :
//   - Source de vérité = serveur (revalidatePath + router.refresh).
//   - Pas d'optimistic UI agressif.
//   - Drop sur date passée bloqué + toast info.
//   - Status non `planned` → bloqué côté UI (drag handle masqué) + double rempart server.

import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  PointerSensor,
} from '@dnd-kit/core'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { TeamRow, SiteRow, WeekInterventionCell } from '@/lib/db/week-planning'
import { CellDrawer } from './CellDrawer'
import {
  moveInterventionToDayAction,
  reassignInterventionTeamAction,
} from './actions'
import type { ReassignTeamOption } from './ReassignTeamDialog'

export interface TeamWeekGridClientProps {
  rows: TeamRow[]
  /** yyyy-mm-dd UTC — aujourd'hui (passé par le parent server). */
  todayIso: string
  /** Équipes actives (pour le dialog de réassignation côté drawer). */
  teams: ReassignTeamOption[]
  children: React.ReactNode
}

const UNASSIGNED_TOKEN = '__unassigned__'

interface ParsedTeamCellKey {
  teamId: string | null // null si "__unassigned__"
  date: string
}

/**
 * Parse une clé `team::<teamId|__unassigned__>::yyyy-mm-dd`.
 *
 * Retourne `null` si le format n'est pas reconnu (drop sur une cellule autre
 * que la grille équipe — ne devrait pas arriver vu qu'on n'enregistre qu'une
 * famille de droppables, mais double rempart).
 */
function parseTeamCellKey(key: string): ParsedTeamCellKey | null {
  if (!key.startsWith('team::')) return null
  const rest = key.slice('team::'.length)
  const idx = rest.indexOf('::')
  if (idx < 0) return null
  const rawTeam = rest.slice(0, idx)
  const date = rest.slice(idx + 2)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return {
    teamId: rawTeam === UNASSIGNED_TOKEN ? null : rawTeam,
    date,
  }
}

interface SourceInfo {
  teamId: string | null
  date: string
  status: string
}

/**
 * Construit un index intervention_id → { teamId, date, status } depuis les
 * TeamRow. Permet de comparer source ↔ cible au drop pour décider de
 * l'action à effectuer.
 */
function buildSourceIndex(rows: TeamRow[]): Map<string, SourceInfo> {
  const idx = new Map<string, SourceInfo>()
  for (const row of rows) {
    for (const [date, cells] of Object.entries(row.days)) {
      for (const c of cells) {
        idx.set(c.id, { teamId: row.team_id, date, status: c.status })
      }
    }
  }
  return idx
}

/**
 * Adapte les TeamRow[] en SiteRow[] pour réutiliser le CellDrawer existant.
 *
 * CellDrawer indexe par `siteId::date` (vue site). En vue équipe on n'a pas
 * de site-row, mais le drawer reste utile pour visualiser la liste des missions
 * du jour. Stratégie :
 *
 *  1. On reconstruit des SiteRow à partir de toutes les interventions de la
 *     semaine (pivot inverse : on regroupe par site comme la vue primaire).
 *  2. Le CellDrawer utilise `data-cell-key` pour identifier la cellule cliquée.
 *     Or nos TeamWeekGridCell émettent une clé `team::<teamId>::<date>`, qui
 *     n'existe PAS dans l'index reconstruit par CellDrawer.
 *  3. Solution propre : on ne reconstruit pas un index "site" — on construit
 *     directement un index "team::xxx::yyyy-mm-dd" → liste interventions, et
 *     on passe un faux SiteRow[] qui mappe ces clés. Cf. wrapping ci-dessous.
 */
function buildSiteRowsForDrawer(rows: TeamRow[]): SiteRow[] {
  // Aggrège toutes les interventions, on s'en sert pour construire des
  // pseudo-SiteRow où site_id = `__team_<teamId>__` pour que la cellKey
  // produite par CellDrawer (siteId::date) corresponde à `team::<teamId>::date`.
  //
  // Note technique : CellDrawer assemble des cellKey via `${row.site_id}::${date}`.
  // Pour matcher notre format `team::<teamId>::<date>`, on positionne
  // `site_id = 'team::<teamId>'`. Cohérent et zéro risque de collision
  // (vrais site_id = UUIDs, jamais préfixés par "team::").
  const map = new Map<string, SiteRow>()
  for (const row of rows) {
    const pseudoSiteId = `team::${row.team_id ?? UNASSIGNED_TOKEN}`
    const pseudoSiteName =
      row.team_id === null ? 'Non-affecté' : row.team_name
    const days: Record<string, WeekInterventionCell[]> = {}
    for (const [d, cells] of Object.entries(row.days)) {
      days[d] = cells
    }
    map.set(pseudoSiteId, {
      site_id: pseudoSiteId,
      site_name: pseudoSiteName,
      contract_id: '',
      contract_name: row.team_id === null ? 'Non-affecté' : `${row.member_count} personnes`,
      days,
    })
  }
  return Array.from(map.values())
}

export function TeamWeekGridClient({
  rows,
  todayIso,
  teams,
  children,
}: TeamWeekGridClientProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const sourceIndex = useMemo(() => buildSourceIndex(rows), [rows])
  const drawerRows = useMemo(() => buildSiteRowsForDrawer(rows), [rows])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null)
      const { active, over } = event
      if (!over) return
      const interventionId = String(active.id)
      const targetKey = String(over.id)

      const target = parseTeamCellKey(targetKey)
      if (!target) return
      if (target.date < todayIso) {
        toast.info('Cellule passée : déplacement ignoré')
        return
      }

      const source = sourceIndex.get(interventionId)
      if (!source) return

      // Garde-fou : statut non-planned (impossible côté UI, mais double rempart)
      if (source.status !== 'planned') {
        toast.error('Intervention déjà démarrée — déplacement refusé')
        return
      }

      const sameTeam = source.teamId === target.teamId
      const sameDay = source.date === target.date

      // No-op : drop sur soi-même
      if (sameTeam && sameDay) return

      // Décision d'action :
      //  - même équipe, autre jour → move (date)
      //  - autre équipe, même jour → reassign (team)
      //  - autre équipe ET autre jour → on priorise reassign (1 action atomique)
      //    + toast info pour signaler que la date n'a pas changé.
      if (sameTeam && !sameDay) {
        // Replanification simple
        startTransition(async () => {
          const result = await moveInterventionToDayAction({
            interventionId,
            newScheduledFor: target.date,
          })
          if (result.ok) {
            toast.success('Mission replanifiée')
            router.refresh()
          } else {
            toast.error(result.error ?? 'Erreur replanification')
          }
        })
        return
      }

      // Réassignation équipe (avec ou sans changement de jour)
      startTransition(async () => {
        const result = await reassignInterventionTeamAction({
          interventionId,
          newTeamId: target.teamId,
        })
        if (result.ok) {
          if (sameDay) {
            toast.success(
              target.teamId === null
                ? 'Mission désaffectée'
                : 'Équipe réassignée',
            )
          } else {
            toast.success('Équipe réassignée — la date reste inchangée')
          }
          router.refresh()
        } else {
          toast.error(result.error ?? 'Erreur réassignation équipe')
        }
      })
    },
    [router, sourceIndex, todayIso],
  )

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <CellDrawer
        rows={drawerRows}
        teams={teams}
        todayIso={todayIso}
        pendingMove={pending}
        activeDragId={activeId}
      >
        {children}
      </CellDrawer>
    </DndContext>
  )
}
