import Link from 'next/link'
import {
  ShieldAlert, Clock, AlertCircle, CalendarClock, ListTodo, Star, ChevronRight, Check,
} from 'lucide-react'
import type { PresenceReminder, PresenceReminderKind } from '@/lib/db/site-presence'

/**
 * « Puisque vous êtes ici » — l'assistant de présence (niveau 3). Il relit ce que
 * le chantier sait déjà et propose 1 à 3 opportunités à saisir MAINTENANT, tant
 * qu'on est sur place. Ton opportunité, jamais reproche. Chaque rappel est
 * cliquable. Si rien ne remonte, un état rassurant : « rien ne réclame votre
 * attention ». La logique (déterministe, zéro donnée nouvelle) vit dans
 * `lib/db/site-presence.ts` ; ce composant ne fait que la MONTRER.
 */

const KIND_META: Record<PresenceReminderKind, { Icon: typeof ShieldAlert; cls: string }> = {
  reserve_safety: { Icon: ShieldAlert, cls: 'text-rose-600' },
  reserve_old: { Icon: Clock, cls: 'text-amber-600' },
  action_overdue: { Icon: AlertCircle, cls: 'text-amber-600' },
  meeting_soon: { Icon: CalendarClock, cls: 'text-sky-600' },
  action_open: { Icon: ListTodo, cls: 'text-violet-600' },
  starred: { Icon: Star, cls: 'text-violet-600' },
}

export function SitePresenceReminders({ reminders }: { reminders: PresenceReminder[] }) {
  if (reminders.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50/60 px-3 py-2.5 dark:bg-emerald-950/20">
        <Check className="h-4 w-4 shrink-0 text-emerald-600" />
        <p className="text-[13px] text-emerald-900/80 dark:text-emerald-200/80">
          Rien ne réclame votre attention ici — vous êtes à jour.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600/80 dark:text-violet-400/80">
        Puisque vous êtes ici
      </p>
      <ul className="space-y-1.5">
        {reminders.map((r, i) => {
          const { Icon, cls } = KIND_META[r.kind]
          return (
            <li key={`${r.kind}-${i}`}>
              <Link
                href={r.href}
                className="flex items-center gap-3 rounded-xl border border-violet-200/60 bg-violet-50/40 px-3 py-2.5 shadow-sm active:brightness-95 dark:border-violet-900/40 dark:bg-violet-950/20"
              >
                <Icon className={`h-[18px] w-[18px] shrink-0 ${cls}`} />
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-foreground/90">{r.text}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
