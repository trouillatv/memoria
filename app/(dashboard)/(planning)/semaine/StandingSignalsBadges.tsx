'use client'

// Niveau 1 (Vincent 2026-06-24) — synthèse « standing » sous le nom du site
// dans la grille semaine. Conditions EN COURS (blocage, réserve ouverte), avec
// ANCIENNETÉ. Factuel brut : un comptage de signaux datés, JAMAIS un verdict.
//
// Pas de pastille 🟢/🟠/🔴 ici : un verdict couleur (« Stable ») est une
// APPRÉCIATION de l'état du chantier, pas un fait — il appartient au futur
// computeSiteClimate() et devra être explicable. Cf. doctrine « projection, pas
// vérité ». Lecture seule : le tooltip explique le POURQUOI au survol (détail +
// ancienneté par signal), mais aucune navigation, aucun effet sur le drag.

import { TriangleAlert, ClipboardList } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ageInDays, type WeekOperationalSignal } from '@/lib/week-operational-signals-helpers'

// Teintes discrètes alignées sur MemorySignalBadge (familles attention/continuite).
const BLOCAGE_CLS =
  'border-red-300 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300'
const RESERVE_CLS =
  'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300'

function plural(n: number, one: string, many: string): string {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`
}

/** Ancienneté la plus ancienne d'un groupe (max des `since`). null si aucune. */
function oldestAge(signals: WeekOperationalSignal[], todayIso: string): number | null {
  let max: number | null = null
  for (const s of signals) {
    const a = ageInDays(s.since, todayIso)
    if (a != null && (max == null || a > max)) max = a
  }
  return max
}

/** Un badge + son tooltip « pourquoi » (sous le badge), une ligne par signal. */
function BadgeWithReason({
  className,
  icon,
  text,
  title,
  signals,
  todayIso,
  ariaLabel,
}: {
  className: string
  icon: React.ReactNode
  text: string
  title: string
  signals: WeekOperationalSignal[]
  todayIso: string
  ariaLabel: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${className}`}
          />
        }
      >
        {icon}
        {text}
      </TooltipTrigger>
      {/* side=bottom : le détail apparaît SOUS le badge (demandé). */}
      <TooltipContent side="bottom" align="start" className="flex-col items-start gap-1 py-2 text-left">
        <span className="font-semibold">{title}</span>
        <ul className="space-y-0.5">
          {signals.map((s) => {
            const age = ageInDays(s.since, todayIso)
            return (
              <li key={s.id} className="opacity-90">
                {s.label}
                {s.detail && <span className="opacity-75"> — {s.detail}</span>}
                {age != null && <span className="opacity-75"> · depuis {age} j</span>}
              </li>
            )
          })}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Badges « standing » d'un site (blocages en cours, réserves ouvertes).
 * Silence positif : ne rend rien si aucun signal en cours.
 */
export function StandingSignalsBadges({
  signals,
  todayIso,
}: {
  signals: WeekOperationalSignal[] | undefined
  todayIso: string
}) {
  if (!signals || signals.length === 0) return null

  const blocages = signals.filter((s) => s.kind === 'blocage')
  const reserves = signals.filter((s) => s.kind === 'reserve_open')

  // Suffixe d'ancienneté sur le badge : « · 31 j » (le plus ancien du groupe).
  const ageSuffix = (group: WeekOperationalSignal[]): string => {
    const age = oldestAge(group, todayIso)
    return age == null ? '' : ` · ${age} j`
  }

  return (
    <TooltipProvider delay={120}>
      <div className="flex flex-wrap gap-1">
        {blocages.length > 0 && (
          <BadgeWithReason
            className={BLOCAGE_CLS}
            icon={<TriangleAlert aria-hidden className="h-2.5 w-2.5" />}
            text={`${plural(blocages.length, 'blocage', 'blocages')}${ageSuffix(blocages)}`}
            title={plural(blocages.length, 'blocage en cours', 'blocages en cours')}
            signals={blocages}
            todayIso={todayIso}
            ariaLabel={`${plural(blocages.length, 'blocage en cours', 'blocages en cours')} — voir le détail`}
          />
        )}
        {reserves.length > 0 && (
          <BadgeWithReason
            className={RESERVE_CLS}
            icon={<ClipboardList aria-hidden className="h-2.5 w-2.5" />}
            text={`${plural(reserves.length, 'réserve ouverte', 'réserves ouvertes')}${ageSuffix(reserves)}`}
            title={plural(reserves.length, 'réserve ouverte', 'réserves ouvertes')}
            signals={reserves}
            todayIso={todayIso}
            ariaLabel={`${plural(reserves.length, 'réserve ouverte', 'réserves ouvertes')} — voir le détail`}
          />
        )}
      </div>
    </TooltipProvider>
  )
}
