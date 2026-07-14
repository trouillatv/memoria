'use client'

// Phase 9 — Vue Semaine & Équipes (Slice 9.5), refondu V6.1 (Vincent 2026-05-20).
//
// Cellule (Équipe × Jour) de la grille secondaire. Affiche une liste compacte
// des missions du jour pour l'équipe : `Abrev site` + `Heure 1re mission`.
//
// Doctrine V2 + V6.1 :
//   - JAMAIS de noms d'agents dans cette grille (l'équipe = conteneur, pas
//     les noms). La page /equipes est le seul endroit où l'on voit des noms.
//   - ZÉRO évocation de créneau côté utilisateur. On affiche l'heure honnête
//     de prestation (planned_start) — ex. « 6h30 », « 7h », « 14h ».
//   - "Non-affecté" : badge ambre, jamais rouge, jamais alarme.
//   - Aucune métrique (pas de "charge", pas de "saturation", pas de %).
//
// Click → CellDrawer (event delegation côté TeamWeekGridClient via
// `data-cell-trigger="true"` + `data-cell-key`).

import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import { fmtHourFr } from '@/lib/time/prestation-slot'
import type { WeekInterventionCell } from '@/lib/db/week-planning'

// Conservé pour rétro-compatibilité tests doctrine ; plus utilisé dans le
// rendu visible — voir `firstHourLabelForCells`.
const SLOT_LETTER: Record<string, string> = {
  morning: 'm',
  afternoon: 'a',
  evening: 's',
}

/**
 * Abrège un nom de site pour les cellules compactes :
 *  - retire les espaces/ponctuations finales
 *  - prend les 4 premiers caractères du premier mot, ou le premier mot s'il
 *    est plus court, en gardant la casse initiale
 *  - "St-Marie" → "St-M" (préserve les tirets utiles pour distinguer)
 *
 * Exemples :
 *   "CHU Régional"    → "CHU"
 *   "Banque Centrale" → "Banq"
 *   "École Sud"       → "École"  (4 chars + accent)
 *   "St-Marie"        → "St-M"
 */
export function abbreviateSiteName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '—'
  // On considère le premier "mot" jusqu'au premier espace ou virgule
  const firstWord = trimmed.split(/[\s,]+/)[0] ?? trimmed
  if (firstWord.length <= 4) return firstWord
  // Si le mot contient un tiret dans les 4 premiers chars, on garde jusqu'au
  // caractère suivant le tiret pour rester lisible (St-Marie → St-M).
  const dashIdx = firstWord.indexOf('-')
  if (dashIdx >= 0 && dashIdx <= 3) {
    return firstWord.slice(0, Math.min(dashIdx + 2, firstWord.length))
  }
  return firstWord.slice(0, 4)
}

/**
 * Lettre compacte d'un slot. `null` ou slot non standard → chaîne vide
 * (on n'affiche aucun texte parasite plutôt qu'une lettre étrange).
 */
export function slotLetter(slot: string | null): string {
  if (!slot) return ''
  return SLOT_LETTER[slot] ?? ''
}

/**
 * Compacte plusieurs missions du même site dans le même jour pour la même
 * équipe en une seule ligne `Abrev m+s`. Le tri d'ordre est m → a → s.
 *
 * Si plusieurs sites distincts : on rend plusieurs lignes (regroupées par
 * site dans le rendu, pas ici).
 */
export function compactSlotsForSite(cells: WeekInterventionCell[]): string {
  const order: Array<keyof typeof SLOT_LETTER> = ['morning', 'afternoon', 'evening']
  const present = new Set(cells.map((c) => c.slot).filter((s): s is string => !!s))
  const parts: string[] = []
  for (const slot of order) {
    if (present.has(slot)) parts.push(SLOT_LETTER[slot])
  }
  // slots non standard → en queue, alpha
  const nonStandard = Array.from(present)
    .filter((s) => !(s in SLOT_LETTER))
    .sort()
  for (const s of nonStandard) parts.push(s)
  return parts.join('+')
}

/**
 * V6.1 (Vincent 2026-05-20) : libellé compact d'horaire pour un groupe de
 * missions du même site dans la même cellule. Retourne « 6h30 » (1 seule)
 * ou « 6h30+2 » (1ère heure + nombre de suivantes). Si aucun planned_start
 * connu, retourne chaîne vide (le caller masque le badge).
 */
export function firstHourLabelForCells(cells: WeekInterventionCell[]): string {
  if (cells.length === 0) return ''
  // Tri par planned_start ascendant (nulls last) pour avoir la 1re heure.
  const sorted = [...cells].sort((a, b) => {
    const ax = a.planned_start ?? '~'
    const bx = b.planned_start ?? '~'
    return ax.localeCompare(bx)
  })
  const first = sorted[0]
  if (!first) return ''
  const hh = fmtHourFr(first.planned_start)
  if (hh === '—') return ''
  const more = cells.length - 1
  return more > 0 ? `${hh}+${more}` : hh
}

export interface TeamWeekGridCellProps {
  /** Date yyyy-mm-dd. */
  date: string
  /** ID d'équipe (string) ou null = "Non-affecté". */
  teamId: string | null
  /** Nom d'équipe (pour aria-label). */
  teamName: string
  /** Interventions du jour pour cette équipe. */
  cells: WeekInterventionCell[]
  /** Aujourd'hui yyyy-mm-dd UTC — désactive le drop sur cellule passée. */
  todayIso?: string
}

interface SiteGroup {
  siteId: string
  siteName: string
  cells: WeekInterventionCell[]
}

/**
 * Regroupe les interventions d'une cellule par site_id, tri stable par
 * site_name. Permet de rendre une ligne par site dans la cellule.
 */
function groupBySite(cells: WeekInterventionCell[]): SiteGroup[] {
  const map = new Map<string, SiteGroup>()
  for (const c of cells) {
    let g = map.get(c.site_id)
    if (!g) {
      g = { siteId: c.site_id, siteName: c.site_name, cells: [] }
      map.set(c.site_id, g)
    }
    g.cells.push(c)
  }
  return Array.from(map.values()).sort((a, b) =>
    a.siteName.localeCompare(b.siteName, 'fr', { sensitivity: 'base' }),
  )
}

/**
 * Identifie la cellule droppable d'une vue équipe : `team::<teamId>::<date>`.
 * Le préfixe `team::` permet de désambiguïser des cell keys de la vue site
 * (qui sont `<siteId>::<date>`), pour éviter toute collision côté drag/drop.
 *
 * `teamId === null` → la clé est `team::__unassigned__::<date>`.
 */
export function teamCellKey(teamId: string | null, date: string): string {
  return `team::${teamId ?? '__unassigned__'}::${date}`
}

/**
 * Cellule visuelle de la grille Équipe × Jour.
 *
 * États :
 *   - vide : `—` muted, non cliquable
 *   - N missions : 1 ligne par site, "Abrev m+s" (ex: `CHU m`, `Banq s`)
 */
export function TeamWeekGridCell({
  date,
  teamId,
  teamName,
  cells,
  todayIso,
}: TeamWeekGridCellProps) {
  const cellKey = teamCellKey(teamId, date)
  const isPast = !!(todayIso && date < todayIso)
  // useDroppable est toujours appelé (règle des hooks). Si pas de DndContext
  // parent (tests, server rendering), retourne valeurs neutres.
  const droppable = useDroppable({
    id: cellKey,
    disabled: isPast,
    data: { date, isPast, teamId },
  })

  const isEmpty = cells.length === 0
  const groups = isEmpty ? [] : groupBySite(cells)

  const ariaParts: string[] = [teamName, date]
  if (isEmpty) {
    ariaParts.push('aucune intervention')
  } else {
    ariaParts.push(`${cells.length} intervention${cells.length > 1 ? 's' : ''}`)
    for (const g of groups) {
      ariaParts.push(`${g.siteName} ${firstHourLabelForCells(g.cells)}`.trim())
    }
  }
  const ariaLabel = ariaParts.join(' — ')

  // UX V5 : cellule passée → fond slate-50 semi-transparent + motif hachuré
  // diagonal sobre. Purement visuel décoratif : le contenu reste pleinement
  // lisible, le clic reste autorisé (seul le drop SUR le passé est refusé,
  // cf. useDroppable disabled=isPast). L'état `isOver` du drop reste
  // prioritaire (il ne peut pas être actif si isPast, donc pas de conflit).
  const pastCellStyle = isPast
    ? {
        backgroundImage:
          'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(148, 163, 184, 0.08) 6px, rgba(148, 163, 184, 0.08) 7px)',
        backgroundColor: 'rgba(248, 250, 252, 0.5)',
      }
    : undefined

  return (
    <td
      ref={droppable.setNodeRef}
      data-slot="team-week-grid-cell"
      data-date={date}
      data-team-id={teamId ?? '__unassigned__'}
      data-cell-key={cellKey}
      data-empty={isEmpty ? 'true' : 'false'}
      data-past={isPast ? 'true' : 'false'}
      data-over={droppable.isOver ? 'true' : 'false'}
      style={pastCellStyle}
      className={cn(
        'border-l border-border/60 align-top p-2 min-w-[7rem] transition-colors duration-200',
        !isEmpty && 'hover:bg-accent/40',
        droppable.isOver &&
          !isPast &&
          'bg-brand-50/60 outline outline-2 outline-brand-300 outline-offset-[-2px]',
        // UX V5 : isPast applique un hachuré sobre via inline style (cf. pastCellStyle
        // ci-dessus). Remplace l'ancien `bg-muted/20`.
      )}
    >
      {isEmpty ? (
        <div
          className="text-muted-foreground/60 text-center text-sm"
          aria-label={ariaLabel}
        >
          —
        </div>
      ) : (
        <button
          type="button"
          data-cell-trigger="true"
          data-cell-key={cellKey}
          aria-label={ariaLabel}
          data-testid={`team-week-cell-${teamId ?? 'unassigned'}-${date}`}
          className="flex w-full flex-col items-start gap-1 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          {groups.map((g) => {
            const hourLabel = firstHourLabelForCells(g.cells)
            const abbrev = abbreviateSiteName(g.siteName)
            return (
              <span
                key={g.siteId}
                className="flex items-baseline gap-1.5 text-[12px] leading-tight"
                title={`${g.siteName}${hourLabel ? ` (${hourLabel})` : ''}`}
              >
                <span className="font-medium text-foreground">{abbrev}</span>
                {hourLabel && (
                  <span className="font-mono text-[10px] tracking-tight text-muted-foreground">
                    {hourLabel}
                  </span>
                )}
              </span>
            )
          })}
        </button>
      )}
    </td>
  )
}

// Helper utilitaire exporté pour les tests : reconstruit l'aria-label sans
// rendre le composant (utile pour debug et régression doctrine).
export function buildAriaLabel(teamName: string, date: string, cells: WeekInterventionCell[]): string {
  const parts: string[] = [teamName, date]
  if (cells.length === 0) {
    parts.push('aucune intervention')
  } else {
    parts.push(`${cells.length} intervention${cells.length > 1 ? 's' : ''}`)
    for (const g of groupBySite(cells)) {
      parts.push(`${g.siteName} ${firstHourLabelForCells(g.cells)}`.trim())
    }
  }
  return parts.join(' — ')
}

// Helper exporté pour les tests : exposition du regroupement par site.
export const _internal = { groupBySite }
