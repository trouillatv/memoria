'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.3, étendu Slice 9.4)
//
// Cellule (jour × site) de la grille semaine. Client component depuis 9.4
// (DnD via useDroppable). Slice 9.3 était un server component pur — la
// promotion en client n'a aucun impact UX (pas de fetch, pas de state).
//
// Doctrine V2 imperative :
//   - Créneaux nommés via lettres compactes (m / s / e), JAMAIS d'heures précises
//   - "Non-affecté" en cellule = ◯ ambre + texte muted, JAMAIS rouge
//   - Aucune métrique exposée (pas de "x missions exécutées", pas de %)
//   - Indicateur ● (1 mission) ou ●● (2+) — purement quantitatif et neutre
//
// Click → CellDrawer : implémenté via event delegation côté WeekGridClient
// (le bouton porte les data-attributes ; pas de prop function fournie ici,
// pour rester server-renderable).

import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { TeamBadge } from '@/components/ui/team-badge'
import type { WeekInterventionCell } from '@/lib/db/week-planning'

// Lettres compactes — JAMAIS d'heure (8h, 14h, etc.).
const SLOT_LETTER: Record<string, string> = {
  morning: 'm',
  afternoon: 'a',
  evening: 's', // "soir" → s (cf. doctrine "matin/après-midi/soir")
}

/**
 * Compacte les slots distincts d'une cellule en une chaîne stable triée :
 *   ['morning']                       → 'm'
 *   ['morning','evening']             → 'm+s'
 *   ['morning','afternoon','evening'] → 'm+a+s'
 *
 * `null` slot → ignoré (intervention "non créneau" — rare, généralement
 * one_shot sans créneau, on n'expose rien plutôt qu'un texte parasite).
 */
export function compactSlots(cells: WeekInterventionCell[]): string {
  const order: Array<keyof typeof SLOT_LETTER> = ['morning', 'afternoon', 'evening']
  const present = new Set(cells.map((c) => c.slot).filter((s): s is string => !!s))
  const parts: string[] = []
  for (const slot of order) {
    if (present.has(slot)) parts.push(SLOT_LETTER[slot])
  }
  // slots non standard (ex: import legacy) — on les ajoute en queue, alphabétique
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

/**
 * Réduit la liste d'interventions à la "team dominante" affichée sous le
 * dot. Si plusieurs équipes sont présentes dans la cellule, on affiche celle
 * qui a le plus d'interventions (ou la première par tri name). S'il y a des
 * interventions sans assignment, on affiche `null` ce qui déclenche le badge
 * "Non-affecté".
 *
 * Cas : `[A, A, B]` → A. `[A, null]` → A (le badge ambre ne s'affiche que
 * si TOUTES les interventions sont non-affectées).
 */
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

export interface WeekGridCellProps {
  /** Date yyyy-mm-dd (clé dans days). */
  date: string
  /** Site auquel cette cellule appartient (pour aria-label, drawer). */
  siteId: string
  siteName: string
  /** Interventions du jour pour ce site (peut être vide). */
  cells: WeekInterventionCell[]
  /** Aujourd'hui yyyy-mm-dd UTC — passé pour désactiver le drop sur cellule passée. */
  todayIso?: string
}

/**
 * Cellule visuelle de la grille semaine.
 *
 * États :
 *   - vide : `—` muted, non cliquable
 *   - N affectées : `●` (1) ou `●●` (2+) + slots compactés + TeamBadge
 *   - toutes non-affectées : `◯` ambre + texte "Non-affecté"
 *
 * Le click est intercepté par WeekGridClient via event delegation (lit
 * `data-cell-key`). Pas de couleur alarmante.
 */
export function WeekGridCell({ date, siteId, siteName, cells, todayIso }: WeekGridCellProps) {
  const cellKey = `${siteId}::${date}`
  const isPast = !!(todayIso && date < todayIso)
  // useDroppable est toujours appelé pour respecter les règles de hooks.
  // S'il n'y a pas de DndContext parent (test, server-rendering), il
  // retourne simplement des valeurs neutres (setNodeRef no-op).
  const droppable = useDroppable({
    id: cellKey,
    disabled: isPast,
    data: { date, isPast, siteId },
  })
  const isEmpty = cells.length === 0
  const team = isEmpty ? null : dominantTeam(cells)
  const slotsLabel = isEmpty ? '' : compactSlots(cells)
  const allUnassigned =
    cells.length > 0 && cells.every((c) => !c.assigned_team_id)
  const dot = cells.length >= 2 ? '●●' : cells.length === 1 ? '●' : ''

  const ariaParts: string[] = [siteName, date]
  if (isEmpty) {
    ariaParts.push('aucune intervention')
  } else {
    ariaParts.push(`${cells.length} intervention${cells.length > 1 ? 's' : ''}`)
    if (slotsLabel) ariaParts.push(slotsLabel)
    if (allUnassigned) ariaParts.push('non affecté')
    else if (team) ariaParts.push(`équipe ${team.name}`)
  }
  const ariaLabel = ariaParts.join(' — ')

  return (
    <td
      ref={droppable.setNodeRef}
      data-slot="week-grid-cell"
      data-date={date}
      data-site-id={siteId}
      data-cell-key={cellKey}
      data-empty={isEmpty ? 'true' : 'false'}
      data-unassigned={allUnassigned ? 'true' : 'false'}
      data-past={isPast ? 'true' : 'false'}
      data-over={droppable.isOver ? 'true' : 'false'}
      className={cn(
        'border-l border-border/60 align-top p-2 min-w-[7rem] transition-colors duration-200',
        !isEmpty && 'hover:bg-accent/40',
        droppable.isOver && !isPast && 'bg-brand-50/60 outline outline-2 outline-brand-300 outline-offset-[-2px]',
        isPast && 'bg-muted/20',
      )}
    >
      {isEmpty ? (
        <div className="text-muted-foreground/60 text-center text-sm" aria-label={ariaLabel}>
          —
        </div>
      ) : (
        <button
          type="button"
          data-cell-trigger="true"
          data-cell-key={`${siteId}::${date}`}
          aria-label={ariaLabel}
          data-testid={`week-cell-${siteId}-${date}`}
          className="flex flex-col items-start gap-1 w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm cursor-pointer"
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
            {slotsLabel && (
              <span
                className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
                title="Créneaux"
              >
                {slotsLabel}
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
    </td>
  )
}
