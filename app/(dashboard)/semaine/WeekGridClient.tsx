'use client'

// Phase 9 — Vue Semaine (Slice 9.4, refonte Slice 9.7)
//
// Orchestrateur DnD + drawer pour la grille semaine.
//
// Refonte Slice 9.7 + V6.1 (Vincent 2026-05-20) :
//   - Drag DIRECT depuis la cellule (plus de drag handle dans le drawer)
//   - DragOverlay = preview carte flottante "Mission · Site · Heure · Équipe"
//   - Drop ne change QUE la date ; l'heure de prestation est préservée (plus
//     de chips matin/après-midi/soir — ces lettres ont disparu de l'UI).
//   - Modifie UNIQUEMENT cette intervention (jamais la mission/template).
//     Hint vers /missions dans le toast si l'intervention vient d'une récurrence.
//
// Doctrine V2/V3 :
//   - Pas d'optimistic UI agressif. On laisse Sonner + refresh.
//   - Drop sur date passée → silencieux (cellule disabled CSS + sortie precoce).
//   - Drop sur intervention non `planned` → impossible côté UI (le drag est
//     désactivé) + double rempart server-side dans `moveInterventionToDayAction`.
//   - Une PR = un changement (pas de batch).

import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  defaultDropAnimationSideEffects,
  type CollisionDetection,
  type Modifier,
} from '@dnd-kit/core'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { SiteRow, WeekInterventionCell } from '@/lib/db/week-planning'
import type { InterventionSlot } from '@/types/db'
import type { MemorySignal } from '@/lib/memory/signals/types'
import type { ClosureConflict } from '@/lib/planning/conflicts'
import type { ClosureDecision } from '@/lib/db/closure-decisions'
import type { ResolutionOption } from '@/lib/planning/conflict-resolution'
import { CellDrawer } from './CellDrawer'
import { moveInterventionToDayAction } from './actions'
import type { ReassignTeamOption } from './ReassignTeamDialog'
import { TeamBadge } from '@/components/ui/team-badge'
import { GripVertical } from 'lucide-react'
import { formatInterventionTimeLabel } from '@/lib/time/prestation-slot'

// V6.1 (Vincent 2026-05-20) : plus de labels matin/après-midi/soir côté UI.
// On affiche désormais l'horaire de prestation honnête (planned_start) via
// formatInterventionTimeLabel (qui retombe sur l'ancrage canonique 7h/14h/19h
// quand pas de précis).

export interface WeekGridClientProps {
  rows: SiteRow[]
  todayIso: string
  teams: ReassignTeamOption[]
  signalsBySite?: Record<string, MemorySignal[]>
  /** PL3a — conflits « site fermé, prestation prévue ». Relayés tels quels au
   *  drawer. Le drag-and-drop, lui, n'en sait RIEN et n'en a pas besoin. */
  conflictsBySite?: Record<string, Record<string, ClosureConflict>>
  /** PL3b — ce qui a DÉJÀ été décidé, par intervention. Le tiroir doit pouvoir
   *  relire la trace même quand le conflit a disparu. */
  decisions?: Record<string, ClosureDecision>
  /** PL3b — les dates proposées, calculées côté serveur. */
  optionsBySite?: Record<string, Record<string, ResolutionOption[]>>
  children: React.ReactNode
}

interface ParsedDropTarget {
  cellKey: string
  date: string
  siteId: string
  slot: InterventionSlot | null
}

/** Parse une drop target id :
 *   `siteId::yyyy-mm-dd`            → cellule (slot = null = préserver)
 *   `siteId::yyyy-mm-dd@morning`    → chip slot (slot = morning)
 */
function parseDropTargetId(id: string): ParsedDropTarget | null {
  const slotMatch = /@(morning|afternoon|evening)$/.exec(id)
  const slot = slotMatch ? (slotMatch[1] as InterventionSlot) : null
  const cellKey = slotMatch ? id.slice(0, id.length - slotMatch[0].length) : id
  const sep = cellKey.indexOf('::')
  if (sep < 0) return null
  return {
    cellKey,
    siteId: cellKey.slice(0, sep),
    date: cellKey.slice(sep + 2),
    slot,
  }
}

interface InterventionInfo {
  cellKey: string
  status: string
  siteId: string
  scheduledFor: string
  slot: InterventionSlot | null
  templateId: string | null
}

function buildInterventionIndex(rows: SiteRow[]): Map<string, InterventionInfo> {
  const idx = new Map<string, InterventionInfo>()
  for (const row of rows) {
    for (const [date, cells] of Object.entries(row.days)) {
      const key = `${row.site_id}::${date}`
      for (const c of cells) {
        idx.set(c.id, {
          cellKey: key,
          status: c.status,
          siteId: row.site_id,
          scheduledFor: date,
          slot: (c.slot as InterventionSlot | null) ?? null,
          templateId: null, // Phase 10 — sera utilisé pour le hint /missions si dispo
        })
      }
    }
  }
  return idx
}

interface DragPreview {
  missionName: string
  siteName: string
  slot: InterventionSlot | null
  /** V6.1 — heure de prestation (Vincent 2026-05-20). */
  plannedStart: string | null
  plannedEnd: string | null
  teamName: string | null
  teamColor: string | null
}

export function WeekGridClient({ rows, todayIso, teams, signalsBySite, conflictsBySite, decisions, optionsBySite, children }: WeekGridClientProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DragPreview | null>(null)

  // Slice 9.7 — distance 10px (vs 6 initial) pour mieux distinguer clic court
  // du drag sur cellule, le button trigger drawer est aussi `stopPropagation`-é.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 10 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const interventionIndex = useMemo(() => buildInterventionIndex(rows), [rows])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
    const data = event.active.data.current
    const p = data?.interventionPreview as DragPreview | null | undefined
    setPreview(p ?? null)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)
      setPreview(null)
      if (!over) return
      const interventionId = String(active.id)
      const parsed = parseDropTargetId(String(over.id))
      if (!parsed) return

      // Refus : cellule passée (drop refusé, sécurité — l'erreur visible aide
      // l'utilisateur à comprendre pourquoi rien ne se passe).
      if (parsed.date < todayIso) {
        toast.error('Drop refusé : cette date est passée')
        return
      }

      const info = interventionIndex.get(interventionId)
      if (!info) return

      // Refus cross-site : l'intervention est rattachée à une mission, elle-même
      // rattachée à un site. Changer de site impliquerait de changer de mission,
      // ce qui casserait la chaîne de preuve. On refuse net avec un message clair.
      if (parsed.siteId !== info.siteId) {
        toast.error('Une intervention ne peut pas changer de site', {
          description:
            'Elle est rattachée à sa mission. Pour transférer un site, créez une nouvelle intervention.',
          duration: 5000,
        })
        return
      }

      const sameCell = info.cellKey === parsed.cellKey
      const sameSlot = parsed.slot === null || parsed.slot === info.slot
      if (sameCell && sameSlot) return // No-op silencieux

      if (info.status !== 'planned') {
        toast.error('Intervention déjà démarrée — déplacement refusé')
        return
      }

      startTransition(async () => {
        const result = await moveInterventionToDayAction({
          interventionId,
          newScheduledFor: parsed.date,
          ...(parsed.slot ? { newSlot: parsed.slot } : {}),
        })
        if (result.ok) {
          // Doctrine /semaine : un drop ne modifie QUE cette intervention.
          // Jamais la mission ni le template. Pour modifier une mission
          // complète, l'utilisateur va dans /missions.
          // V6.1 — le toast ne mentionne plus de créneau (matin/après-midi/soir),
          // seulement la date. L'heure de prestation est préservée par le drop.
          const dateText = new Date(parsed.date + 'T00:00:00Z').toLocaleDateString('fr-FR', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
          })
          const title = result.rescheduled
            ? `Rattrapée → ${dateText}`
            : `Replanifiée → ${dateText}`
          toast.success(title, {
            description: result.rescheduled
              ? 'Intervention ratée remise en planifié. Cette intervention uniquement.'
              : 'Cette intervention uniquement.',
            duration: result.rescheduled ? 5000 : 3000,
          })
          router.refresh()
        } else if (result.conflict) {
          // Conflit d'affectation : message long, durée étendue pour qu'on
          // ait le temps de lire le contexte (équipe, site, créneau).
          toast.error('Affectation en conflit', {
            description: result.error,
            duration: 7000,
          })
        } else {
          toast.error(result.error ?? 'Erreur replanification')
        }
      })
    },
    [interventionIndex, router, todayIso],
  )

  // Slice 9.7 — Collision custom :
  // 1) On essaie d'abord pointerWithin (= ce qui est SOUS le pointeur exact)
  //    → privilégie les slot chips m/a/s sur la cellule en dessous
  // 2) Fallback rectIntersection quand le pointeur ne touche rien de précis
  //    (ex: gros mouvements rapides)
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args)
    if (pointer.length > 0) return pointer
    return rectIntersection(args)
  }, [])

  // Slice 9.7 — DragOverlay décalé : par défaut l'overlay est centré sous le
  // pointeur ce qui masque la cellule cible. On le pousse de 24px à droite +
  // 32px vers le bas → le pointeur reste libre pour viser un chip m/a/s.
  const offsetFromPointer: Modifier = useCallback(({ transform }) => ({
    ...transform,
    x: transform.x + 24,
    y: transform.y + 32,
  }), [])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null)
        setPreview(null)
      }}
    >
      <CellDrawer
        rows={rows}
        teams={teams}
        todayIso={todayIso}
        pendingMove={pending}
        activeDragId={activeId}
        signalsBySite={signalsBySite}
        conflictsBySite={conflictsBySite}
        decisions={decisions}
        optionsBySite={optionsBySite}
      >
        {children}
      </CellDrawer>

      <DragOverlay
        modifiers={[offsetFromPointer]}
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: '0.5' } },
          }),
        }}
      >
        {activeId && preview ? <DragPreviewCard preview={preview} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function DragPreviewCard({ preview }: { preview: DragPreview }) {
  // V6.1 — affiche l'heure de prestation, plus jamais "matin/après-midi/soir".
  const timeLabel = formatInterventionTimeLabel({
    planned_start: preview.plannedStart,
    planned_end: preview.plannedEnd,
    slot: preview.slot,
  })
  return (
    <div
      className="pointer-events-none rounded-lg border bg-card/90 backdrop-blur-sm shadow-lg px-3 py-2 max-w-[16rem] ring-2 ring-brand-300/80 opacity-90"
      style={{ transform: 'rotate(-2deg)' }}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 mt-0.5 text-muted-foreground/60 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{preview.missionName}</div>
          <div className="text-[11px] text-muted-foreground truncate">{preview.siteName}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-mono text-[10px] tracking-tight text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
              {timeLabel}
            </span>
            {preview.teamName && (
              <TeamBadge name={preview.teamName} color={preview.teamColor} size="sm" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Conservé pour compat ascendante — utilisé éventuellement ailleurs.
export type _PreviewBag = { active: WeekInterventionCell | null }
