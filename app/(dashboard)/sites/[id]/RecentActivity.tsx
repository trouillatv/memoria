'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Camera, AlertTriangle, FileText, CheckSquare, ChevronRight, Check, Circle, UserCheck, Mic } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { RecentActivityItem } from '@/lib/db/site-cockpit'
import { TeamBadge } from '@/components/ui/team-badge'
import { localDateOf, todayLocalIso, addDaysLocal } from '@/lib/time/local-date'

const FR_DAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const FR_MONTHS_SHORT = ['jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

// Date civile (Nouméa) → "aujourd'hui" / "hier" / "jeu." / "12 mai" — pas
// d'epoch ms qui fausserait pour les timestamps proches de minuit local.
function formatDateLabel(iso: string): string {
  const d = new Date(iso)
  const dIso = localDateOf(d)
  const today = todayLocalIso()
  const yesterday = addDaysLocal(today, -1)
  if (dIso === today) return "aujourd'hui"
  if (dIso === yesterday) return 'hier'
  const [y, m, day] = dIso.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  const dMs = Date.UTC(y, m - 1, day)
  const todayMs = Date.UTC(ty, tm - 1, td)
  const diffDays = Math.round((todayMs - dMs) / 86_400_000)
  if (diffDays >= 0 && diffDays < 7) {
    return FR_DAYS_SHORT[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]
  }
  return `${day} ${FR_MONTHS_SHORT[m - 1]}`
}

const KIND_ICON: Record<RecentActivityItem['kind'], LucideIcon> = {
  photo: Camera,
  anomaly: AlertTriangle,
  intervention: CheckSquare,
  site_note: FileText,
  voice_note: Mic,
}

const KIND_ICON_COLOR: Record<RecentActivityItem['kind'], string> = {
  photo: 'text-sky-600',
  anomaly: 'text-amber-600',
  intervention: 'text-emerald-600',
  site_note: 'text-muted-foreground',
  voice_note: 'text-muted-foreground',
}

function TasksCollapse({ tasks }: { tasks: Array<{ label: string; doneAt: string | null; done: boolean }> }) {
  const [open, setOpen] = useState(false)
  const doneCount = tasks.filter((t) => t.done).length
  const total = tasks.length
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) }}
        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        {doneCount}/{total} tâche{total > 1 ? 's' : ''}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-2">
          {tasks.map((t, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5 min-w-0">
                {t.done ? (
                  <Check className="h-2.5 w-2.5 shrink-0 text-emerald-600" aria-label="terminée" />
                ) : (
                  <Circle className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" aria-label="non terminée" />
                )}
                <span className={`truncate ${t.done ? '' : 'text-muted-foreground/60'}`}>{t.label}</span>
              </span>
              {t.done && t.doneAt && (
                <span className="tabular-nums shrink-0 text-muted-foreground/70">
                  {formatDateLabel(t.doneAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pas d&apos;activité ces 7 derniers jours.
      </p>
    )
  }

  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind]
        const iconColor = KIND_ICON_COLOR[item.kind]
        const href = item.interventionId ? `/interventions/${item.interventionId}` : null
        const hasTasks = item.tasks && item.tasks.length > 0

        // Quand le primary EST le nom d'équipe, on le rend en badge coloré.
        // Sinon le primary reste en texte, et le badge équipe s'affiche en
        // dessous (cas anomaly, site_note avec équipe).
        const primaryIsTeam = item.teamName !== null && item.teamName === item.primary

        const inner = (
          <>
            <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${iconColor}`} aria-hidden />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                {primaryIsTeam && item.teamName ? (
                  <TeamBadge name={item.teamName} color={item.teamColor} size="sm" />
                ) : (
                  <span className="text-xs leading-snug font-medium">{item.primary}</span>
                )}
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {formatDateLabel(item.occurredAt)}
                </span>
              </div>

              {item.teamName && !primaryIsTeam && (
                <div className="mt-0.5">
                  <TeamBadge name={item.teamName} color={item.teamColor} size="sm" />
                </div>
              )}

              {item.closedByName && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <UserCheck className="h-2.5 w-2.5 shrink-0" aria-hidden />
                  clôturé par {item.closedByName}
                </p>
              )}

              {item.secondary && !hasTasks && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.secondary}</p>
              )}

              {hasTasks && <TasksCollapse tasks={item.tasks!} />}
            </div>
          </>
        )

        return (
          <li key={`${item.kind}-${item.id}`}>
            {href ? (
              <Link
                href={href}
                className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/40 transition-colors"
              >
                {inner}
              </Link>
            ) : (
              <div className="flex items-start gap-2 rounded px-2 py-1.5">
                {inner}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
