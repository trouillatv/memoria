'use client'

import { Users } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { TeamPresences } from '@/lib/db/site-cockpit'

const FR_MONTHS_SHORT = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

function formatShortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 1 && d.getDate() === now.getDate()) return "aujourd'hui"
  if (diffDays === 1 || (diffDays < 2 && d.getDate() !== now.getDate())) return 'hier'
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getDate()} ${FR_MONTHS_SHORT[d.getMonth()]}`
  }
  return `${d.getDate()} ${FR_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
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
              dernière intervention {formatShortDate(team.lastPassageAt)}
            </span>
          </li>
        ))}
      </ul>
    </TooltipProvider>
  )
}
