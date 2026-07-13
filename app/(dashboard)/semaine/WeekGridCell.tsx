'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.3, étendu 9.4, refonte 9.7)
//
// Cellule (jour × site) de la grille semaine.
//
// Slice 9.7 — Drag direct depuis la cellule (plus de drag via drawer) :
//   - La cellule entière est draggable si elle contient ≥1 intervention `planned`.
//     L'intervention "top" (la plus matinale puis mission alpha) est l'élément
//     déplacé. Le drop change uniquement la date ; l'horaire est préservé.
//
// Doctrine V2/V3 + V6.1 (Vincent 2026-05-20) :
//   - ZÉRO évocation de créneau côté utilisateur. On affiche l'horaire de la
//     première intervention (ex. « 6h30 »), pas « m / a / s ». Le slot DB reste
//     pour le tri interne et le dégradé visuel mais n'est jamais nommé.
//   - "Non-affecté" en cellule = ◯ ambre + texte muted, JAMAIS rouge
//   - Aucune métrique exposée (pas de "x missions exécutées", pas de %)
//   - La modification de la date ne touche QUE l'intervention. Pour la mission
//     elle-même → renvoyer vers /missions (toast hint, doctrine V3 référent).

import { useDraggable, useDroppable, useDndContext } from '@dnd-kit/core'
import { Lock, CalendarOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TeamBadge } from '@/components/ui/team-badge'
import { fmtHourFr } from '@/lib/time/prestation-slot'
import { CLOSURE_REASON_FR } from '@/lib/planning/closures'
import type { ClosureConflict } from '@/lib/planning/conflicts'
import type { WeekInterventionCell } from '@/lib/db/week-planning'
import type { WeekOperationalSignal } from '@/lib/week-operational-signals-helpers'
import type { InterventionSlot } from '@/types/db'
import { CellDayEventIcons } from './CellDayEventIcons'

// Lettres compactes — JAMAIS d'heure (8h, 14h, etc.).
const SLOT_LETTER: Record<string, string> = {
  morning: 'm',
  afternoon: 'a',
  evening: 's',
}

const SLOTS_ORDER: InterventionSlot[] = ['morning', 'afternoon', 'evening']

/** Compacte les slots distincts en `m`, `m+a`, `m+a+s`. */
export function compactSlots(cells: WeekInterventionCell[]): string {
  const order: Array<keyof typeof SLOT_LETTER> = ['morning', 'afternoon', 'evening']
  const present = new Set(cells.map((c) => c.slot).filter((s): s is string => !!s))
  const parts: string[] = []
  for (const slot of order) {
    if (present.has(slot)) parts.push(SLOT_LETTER[slot])
  }
  const nonStandard = Array.from(present)
    .filter((s) => !(s in SLOT_LETTER))
    .sort()
  for (const s of nonStandard) parts.push(s)
  return parts.join('+')
}

interface CellTeamInfo {
  id: string
  name: string
  color: string | null
}

/** Équipe "dominante" d'une cellule (plus d'interventions, puis tri alpha). */
export function dominantTeam(cells: WeekInterventionCell[]): CellTeamInfo | null {
  const counts = new Map<string, { team: CellTeamInfo; count: number }>()
  for (const c of cells) {
    if (!c.assigned_team_id) continue
    const key = c.assigned_team_id
    const existing = counts.get(key)
    if (existing) {
      existing.count++
    } else {
      counts.set(key, {
        team: {
          id: c.assigned_team_id,
          name: c.assigned_team_name ?? 'Équipe',
          color: c.assigned_team_color,
        },
        count: 1,
      })
    }
  }
  if (counts.size === 0) return null
  const sorted = Array.from(counts.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.team.name.localeCompare(b.team.name, 'fr', { sensitivity: 'base' })
  })
  return sorted[0]?.team ?? null
}

/** Sélectionne l'intervention "top" draggable. Statuts modifiables :
 *   - `planned` : pas encore commencée, déplaçable librement
 *   - `skipped` : ratée → réplanifier en avant est un cas légitime
 * Statuts INTERDITS (preuves verrouillées V2) : in_progress, completed, validated.
 * Tri : créneau le plus matinal d'abord, puis nom de mission alpha. */
function pickTopDraggable(cells: WeekInterventionCell[]): WeekInterventionCell | null {
  const candidates = cells.filter((c) => c.status === 'planned' || c.status === 'skipped')
  if (candidates.length === 0) return null
  const order: Record<string, number> = { morning: 0, afternoon: 1, evening: 2 }
  const sorted = [...candidates].sort((a, b) => {
    const sa = order[a.slot ?? ''] ?? 99
    const sb = order[b.slot ?? ''] ?? 99
    if (sa !== sb) return sa - sb
    return a.mission_name.localeCompare(b.mission_name, 'fr', { sensitivity: 'base' })
  })
  return sorted[0] ?? null
}

/** Merge plusieurs refs (callback ou MutableRefObject) en une seule callback. */
function mergeRefs<T>(
  ...refs: Array<((node: T | null) => void) | null | undefined>
): (node: T | null) => void {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node)
    }
  }
}

export interface WeekGridCellProps {
  date: string
  siteId: string
  siteName: string
  cells: WeekInterventionCell[]
  todayIso?: string
  /** Niveau 2 — événements datés du jour (réunion/échéance/livraison) → icônes. */
  dayEvents?: WeekOperationalSignal[]
  /** PL3a — conflit « site fermé, prestation prévue » ce jour-là. OPTIONNEL :
   *  sans lui, la cellule est strictement identique à avant. */
  conflict?: ClosureConflict
}

export function WeekGridCell({ date, siteId, siteName, cells, todayIso, dayEvents, conflict }: WeekGridCellProps) {
  const cellKey = `${siteId}::${date}`
  const isPast = !!(todayIso && date < todayIso)

  // ── Drag source : l'intervention "top" draggable de la cellule ────────────
  // Slice 9.7 : on autorise le drag depuis une cellule PASSÉE (replanifier
  // un lundi raté). On accepte aussi `skipped` (rattraper un raté). Le drop
  // sur passé reste refusé côté serveur. Statuts verrouillés (in_progress,
  // completed, validated) restent immuables → cellule non-draggable.
  const topPlanned = pickTopDraggable(cells)
  const dragId = topPlanned ? topPlanned.id : `__no_drag__${cellKey}`
  const dragDisabled = !topPlanned
  // Indicateur "verrouillé" : la cellule a des interventions mais aucune n'est
  // draggable (toutes sont in_progress/completed/validated).
  const isLocked = cells.length > 0 && !topPlanned

  const {
    setNodeRef: setDraggableRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({
    id: dragId,
    disabled: dragDisabled,
    data: {
      sourceCellKey: cellKey,
      siteId,
      date,
      slot: topPlanned?.slot ?? null,
      interventionPreview: topPlanned
        ? {
            id: topPlanned.id,
            missionName: topPlanned.mission_name,
            siteName,
            slot: topPlanned.slot,
            plannedStart: topPlanned.planned_start,
            plannedEnd: topPlanned.planned_end,
            teamName: topPlanned.assigned_team_name,
            teamColor: topPlanned.assigned_team_color,
          }
        : null,
    },
  })

  // ── Drop target : la cellule entière (date change, slot préservé) ──────────
  const cellDroppable = useDroppable({
    id: cellKey,
    disabled: isPast,
    data: { date, isPast, siteId, kind: 'cell' },
  })

  // ── État global du drag (pour afficher les chips m/a/s) ────────────────────
  const dndCtx = useDndContext()
  const draggingSomething = dndCtx.active != null
  const activeId = dndCtx.active?.id != null ? String(dndCtx.active.id) : null

  const sourceCellFromActive = dndCtx.active?.data.current?.sourceCellKey as string | undefined
  const isSourceCell = sourceCellFromActive === cellKey

  // V6.1 (Vincent 2026-05-20) : les chips matin/après-midi/soir sont
  // désactivées en drag-drop. Raison : changer le slot lors d'un drop
  // RÉINITIALISE l'heure précise (planned_start passe à l'ancrage canonique
  // du nouveau slot), ce qui faisait perdre les heures saisies à chaque
  // déplacement. Désormais le drag ne change QUE la date ; le slot et
  // l'heure précise sont préservés. Pour changer le slot/l'heure d'une
  // intervention, utiliser le bouton « Modifier heure » du drawer ou
  // ouvrir le détail intervention.
  const showChips = false

  const isEmpty = cells.length === 0
  const team = isEmpty ? null : dominantTeam(cells)
  const allUnassigned = cells.length > 0 && cells.every((c) => !c.assigned_team_id)
  const dot = cells.length >= 2 ? '●●' : cells.length === 1 ? '●' : ''

  // V6.1 (Vincent 2026-05-20) : afficher l'horaire de la première intervention
  // de la journée (ex. « 6h30 ») plutôt que la lettre de créneau « m ». Tri
  // déjà fait par listInterventionsForWeek (planned_start asc, nulls last).
  // La pluralité (« il y en a plusieurs ») est portée par le dot ● / ●●,
  // donc on n'ajoute pas de « +N » redondant à côté de l'heure.
  const firstCell = isEmpty ? null : cells[0]
  const firstHourLabel = firstCell ? fmtHourFr(firstCell.planned_start) : ''

  const ariaParts: string[] = [siteName, date]
  if (isEmpty) {
    ariaParts.push('aucune intervention')
  } else {
    ariaParts.push(`${cells.length} intervention${cells.length > 1 ? 's' : ''}`)
    if (firstHourLabel) ariaParts.push(firstHourLabel)
    if (allUnassigned) ariaParts.push('non affecté')
    else if (team) ariaParts.push(`équipe ${team.name}`)
  }
  const ariaLabel = ariaParts.join(' — ')

  const draggable = !dragDisabled

  // UX V5 : cellule passée → fond slate-50 semi-transparent + motif hachuré
  // diagonal sobre. Purement visuel décoratif : le contenu reste pleinement
  // lisible, le clic et le drag depuis la cellule restent autorisés (seul le
  // drop SUR le passé est refusé, cf. useDroppable disabled=isPast). L'état
  // `isOver` du drop reste prioritaire car il override via className.
  const pastCellStyle =
    isPast && !cellDroppable.isOver
      ? {
          backgroundImage:
            'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(148, 163, 184, 0.08) 6px, rgba(148, 163, 184, 0.08) 7px)',
          backgroundColor: 'rgba(248, 250, 252, 0.5)',
        }
      : undefined

  return (
    <td
      ref={mergeRefs(cellDroppable.setNodeRef, setDraggableRef)}
      data-slot="week-grid-cell"
      data-date={date}
      data-site-id={siteId}
      data-cell-key={cellKey}
      data-empty={isEmpty ? 'true' : 'false'}
      data-unassigned={allUnassigned ? 'true' : 'false'}
      data-past={isPast ? 'true' : 'false'}
      data-locked={isLocked ? 'true' : 'false'}
      data-over={cellDroppable.isOver ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      title={
        isLocked
          ? 'Intervention(s) en cours ou exécutée(s) — preuve verrouillée'
          : undefined
      }
      style={pastCellStyle}
      className={cn(
        'relative border-l border-border/60 align-top p-2 min-w-[7rem] transition-colors duration-200',
        !isEmpty && 'hover:bg-accent/40',
        draggable && 'cursor-grab',
        isLocked && 'cursor-default',
        isDragging && 'opacity-50',
        cellDroppable.isOver && !isPast && !isSourceCell &&
          'bg-brand-50/60 outline outline-2 outline-brand-300 outline-offset-[-2px]',
        // UX V5 : isPast applique un hachuré sobre via inline style (cf. pastCellStyle
        // ci-dessus). Sobre, esthétique calme, ne modifie aucun comportement.
      )}
      {...(draggable ? { ...attributes, ...listeners } : {})}
    >
      {isEmpty ? (
        <div className="text-muted-foreground/60 text-center text-sm" aria-label={ariaLabel}>
          —
        </div>
      ) : (
        <button
          type="button"
          data-cell-trigger="true"
          data-cell-key={cellKey}
          // Slice 9.7 — stopPropagation : empêche le pointer down du bouton
          // d'amorcer un drag sur le `<td>` parent. Le clic ouvre proprement
          // le drawer sans déclencher de drag fantôme.
          onPointerDownCapture={(e) => e.stopPropagation()}
          aria-label={ariaLabel}
          data-testid={`week-cell-${siteId}-${date}`}
          className="flex flex-col items-start gap-1 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <span className="flex items-baseline gap-1.5 text-sm">
            <span
              aria-hidden="true"
              className={cn(
                'tracking-tight font-medium leading-none',
                allUnassigned ? 'text-amber-600' : 'text-foreground',
              )}
            >
              {allUnassigned ? '◯' : dot}
            </span>
            {firstHourLabel && (
              <span
                className="font-mono text-[11px] tracking-tight text-muted-foreground"
                title="Horaire de la première intervention de la journée"
              >
                {firstHourLabel}
              </span>
            )}
          </span>
          {allUnassigned ? (
            <span className="text-[11px] text-amber-700/80 italic" title="Aucune équipe affectée">
              Non-affecté
            </span>
          ) : team ? (
            <TeamBadge name={team.name} color={team.color} size="sm" />
          ) : null}
        </button>
      )}

      {/* Indicateur "verrouillé" — cellule avec uniquement des interventions
          en cours/exécutées/validées. Lock icon discret en haut à droite. */}
      {isLocked && (
        <Lock
          className="absolute top-1 right-1 h-3 w-3 text-muted-foreground/50 pointer-events-none"
          aria-hidden
        />
      )}

      {/* PL3a — « site fermé, prestation prévue ». Le <td> est draggable ET
          droppable : ce badge DOIT rester non-interactif (pointer-events-none),
          sinon un clic dessus démarrerait un drag fantôme. Il informe, il ne
          bloque rien — le geste vit dans l'aperçu (PL3b). Zone top-1 left-1 :
          la seule libre (droite = Lock, bas-droite = icônes d'événements). */}
      {conflict && (
        <span
          data-testid="cell-closure-conflict"
          data-closure-conflict="true"
          className="absolute top-1 left-1 pointer-events-none inline-flex items-center rounded-full bg-rose-100 p-0.5 text-rose-700 ring-1 ring-rose-200"
          title={`Site fermé — ${CLOSURE_REASON_FR[conflict.closure.reasonKind]}${
            conflict.closure.reason ? ` · ${conflict.closure.reason}` : ''
          }`}
          aria-label={`Site fermé ce jour-là — ${CLOSURE_REASON_FR[conflict.closure.reasonKind]}`}
        >
          <CalendarOff className="h-3 w-3" aria-hidden />
        </span>
      )}

      {/* Niveau 2 — icônes d'événements datés (réunion/échéance/livraison).
          Couche non-interactive (pointer-events-none) : laisse passer le drag.
          Visible même quand la cellule n'a aucune intervention. */}
      <CellDayEventIcons events={dayEvents} />

      {/* Chips m/a/s pendant un drag actif. Drop sur un chip = date + slot.
          Sur la cellule SOURCE, on les rend semi-transparents pour ne pas
          masquer le contenu visible en dessous. */}
      {showChips && (
        <div
          className={cn(
            'absolute -top-1.5 left-1 right-1 z-20 flex gap-0.5 rounded-md bg-card/95 backdrop-blur-sm shadow-md ring-1 ring-border p-0.5 pointer-events-auto',
            isSourceCell && 'opacity-70',
          )}
          role="group"
          aria-label="Choisir un créneau"
        >
          {SLOTS_ORDER.map((slot) => (
            <SlotChip key={slot} cellKey={cellKey} slot={slot} />
          ))}
        </div>
      )}
    </td>
  )
}

/** Mini drop zone pour un créneau spécifique. Apparaît superposée à la cellule
 * cible pendant le drag. id = `${cellKey}@${slot}` (parsé côté WeekGridClient). */
function SlotChip({ cellKey, slot }: { cellKey: string; slot: InterventionSlot }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${cellKey}@${slot}`,
    data: { kind: 'slot-chip', slot, cellKey },
  })
  const label = SLOT_LETTER[slot] ?? slot
  return (
    <div
      ref={setNodeRef}
      data-slot-chip={slot}
      className={cn(
        // py-1.5 (vs py-1 initial) : cible touch ~40px de haut au lieu de ~28px.
        'flex-1 text-center text-[11px] font-mono uppercase tracking-wider rounded py-1.5 transition-all border',
        isOver
          ? 'bg-brand-600 border-brand-700 text-white scale-105 shadow'
          : 'bg-secondary border-border text-foreground/80 hover:bg-muted',
      )}
      aria-label={`Créneau ${slot}`}
    >
      {label}
    </div>
  )
}
