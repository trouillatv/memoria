'use client'

import { Users } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { TeamPresences } from '@/lib/db/site-cockpit'
import { localDateOf, todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

const FR_MONTHS_SHORT = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

// Comparaison en dates CIVILES (zone Nouméa), pas en epoch ms — évite "hier"
// pour un timestamp à J-2 si l'heure tombe juste.
function formatShortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const dIso = localDateOf(d)
  const today = todayLocalIso()
  const yesterday = addDaysLocal(today, -1)
  if (dIso === today) return "aujourd'hui"
  if (dIso === yesterday) return 'hier'
  const [y, m, day] = dIso.split('-').map(Number)
  const todayYear = Number(today.slice(0, 4))
  if (y === todayYear) return `${day} ${FR_MONTHS_SHORT[m - 1]}`
  return `${day} ${FR_MONTHS_SHORT[m - 1]} ${y}`
}

export function TeamPresencesList({ presences }: { presences: TeamPresences }) {
  if (presences.teams.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Aucune équipe ces {presences.periodDays} derniers jours.
      </p>
    )
  }

  return (
    <TooltipProvider>
      <ul className="space-y-1.5">
        {presences.teams.map((team) => (
          <li key={team.name} className="flex items-center justify-between gap-2">
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-2 cursor-default text-left min-w-0">
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                <span className="text-sm truncate">{team.name}</span>
              </TooltipTrigger>
              {team.memberNames.length > 0 && (
                <TooltipContent side="top">
                  <span>{team.memberNames.join(', ')}</span>
                </TooltipContent>
              )}
            </Tooltip>
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              dernière intervention&nbsp;: {formatShortDate(team.lastPassageAt)}
            </span>
          </li>
        ))}
      </ul>
    </TooltipProvider>
  )
}
