'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.4)
//
// Orchestrateur DnD + drawer pour la grille semaine.
//
// Responsabilités :
//   - DndContext autour de l'ensemble (grille server-rendered + drawer client)
//   - Pose des DroppableCell par-dessus chaque WeekGridCell (via portail
//     de wrappers : on mappe la grille server-rendered, on lit `data-cell-key`)
//   - Au drop : valide (status planned + date >= today) puis lance la server
//     action via useTransition + toast
//   - Re-render via router.refresh() (pas de drag temps réel : refresh
//     server-side après chaque drop = source de vérité unique)
//   - Délègue au CellDrawer pour l'ouverture détail au click cellule.
//
// Doctrine V2 :
//   - Pas d'optimistic UI agressif. On laisse Sonner toast + refresh.
//   - Drop sur date passée → silent (CSS disabled + sortie precoce).
//   - Drop sur intervention non `planned` → impossible côté UI (drag handle
//     masqué) + double rempart server-side.
//   - Une PR = un changement (pas de batch).

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
import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { SiteRow } from '@/lib/db/week-planning'
import { CellDrawer } from './CellDrawer'
import { moveInterventionToDayAction } from './actions'
import type { ReassignTeamOption } from './ReassignTeamDialog'

export interface WeekGridClientProps {
  rows: SiteRow[]
  /** yyyy-mm-dd UTC — aujourd'hui (passé par le parent server). */
  todayIso: string
  /** Équipes actives (pour le dialog de réassignation). */
  teams: ReassignTeamOption[]
  children: React.ReactNode
}

/** Parse une cell key `siteId::yyyy-mm-dd` en ses parties. */
function parseCellKey(key: string): { siteId: string; date: string } | null {
  const idx = key.indexOf('::')
  if (idx < 0) return null
  return { siteId: key.slice(0, idx), date: key.slice(idx + 2) }
}

/** Construit un index intervention_id → { sourceCellKey, status }. */
function buildInterventionIndex(rows: SiteRow[]): Map<
  string,
  { cellKey: string; status: string; siteId: string; scheduledFor: string }
> {
  const idx = new Map<
    string,
    { cellKey: string; status: string; siteId: string; scheduledFor: string }
  >()
  for (const row of rows) {
    for (const [date, cells] of Object.entries(row.days)) {
      const key = `${row.site_id}::${date}`
      for (const c of cells) {
        idx.set(c.id, {
          cellKey: key,
          status: c.status,
          siteId: row.site_id,
          scheduledFor: date,
        })
      }
    }
  }
  return idx
}

export function WeekGridClient({ rows, todayIso, teams, children }: WeekGridClientProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<string | null>(null)

  // Activation distance pour éviter qu'un simple click sur le bouton trigger
  // un drag — important : on garde le click → drawer fonctionnel.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const interventionIndex = buildInterventionIndex(rows)

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

      // Refus silencieux : cellule passée — la DroppableCell est déjà disabled,
      // double rempart au cas où.
      const parsed = parseCellKey(targetKey)
      if (!parsed) return
      if (parsed.date < todayIso) {
        toast.info('Cellule passée : déplacement ignoré')
        return
      }

      const info = interventionIndex.get(interventionId)
      if (!info) return

      // No-op : drop sur sa propre cellule
      if (info.cellKey === targetKey) return

      // No-op : statut non-planned (devrait être impossible côté UI, garde-fou)
      if (info.status !== 'planned') {
        toast.error('Intervention déjà démarrée — déplacement refusé')
        return
      }

      // Lance la server action. Si la cible est dans un autre site, on
      // déplace tout de même (cas rare mais autorisé : superviseur réorganise
      // un mass move après refonte de tournée).
      startTransition(async () => {
        const result = await moveInterventionToDayAction({
          interventionId,
          newScheduledFor: parsed.date,
        })
        if (result.ok) {
          toast.success('Mission replanifiée')
          router.refresh()
        } else {
          toast.error(result.error ?? 'Erreur replanification')
        }
      })
    },
    [interventionIndex, router, todayIso],
  )

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <CellDrawer
        rows={rows}
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
