import Link from 'next/link'
import { Users, Wrench, CalendarClock, ChevronRight } from 'lucide-react'
import type { NextStep, NextStepKind } from '@/lib/db/site-next-steps'

/**
 * « PROCHAINE ÉTAPE » — le bloc permanent qui répond à LA question du terrain :
 * « qu'est-ce que je dois faire ensuite ? ». La plus proche en grand (réunion /
 * intervention / échéance), les suivantes en une ligne. Déterministe, zéro IA.
 * Silence positif : rien à venir → la carte n'existe pas.
 * Phrase visée : « le chantier me dit toujours ce qui vient. »
 */
const KIND_META: Record<NextStepKind, { label: string; Icon: typeof Users; cls: string }> = {
  reunion: { label: 'Réunion', Icon: Users, cls: 'text-sky-600' },
  intervention: { label: 'Intervention', Icon: Wrench, cls: 'text-amber-600' },
  echeance: { label: 'Échéance', Icon: CalendarClock, cls: 'text-violet-600' },
}

export function NextStepCard({ steps }: { steps: NextStep[] }) {
  if (steps.length === 0) return null
  const [first, ...rest] = steps
  const meta = KIND_META[first.kind]

  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="next-step-card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Prochaine étape
      </h2>
      <Link href={first.href} className="mt-2.5 flex items-center gap-3 active:opacity-70">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/60">
          <meta.Icon className={`h-5 w-5 ${meta.cls}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight">
            {meta.label} — {first.label}
          </span>
          <span className="block text-sm text-muted-foreground first-letter:uppercase">
            {first.dateLabel}
            {first.timeLabel ? ` · ${first.timeLabel}` : ''}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {first.inLabel}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {rest.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t pt-2.5">
          {rest.map((s, i) => {
            const m = KIND_META[s.kind]
            return (
              <li key={i}>
                <Link href={s.href} className="flex items-center gap-2 text-[13px] text-muted-foreground active:opacity-70">
                  <m.Icon className={`h-3.5 w-3.5 shrink-0 ${m.cls}`} />
                  <span className="min-w-0 flex-1 truncate">{m.label} — {s.label}</span>
                  <span className="shrink-0 tabular-nums">{s.inLabel}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
