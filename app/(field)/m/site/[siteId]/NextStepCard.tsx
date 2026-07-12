import Link from 'next/link'
import { Users, Wrench, CalendarClock, ChevronRight } from 'lucide-react'
import type { NextStep, NextStepKind } from '@/lib/db/site-next-steps'

/**
 * « AGENDA DU CHANTIER » (maquette B validée 2026-07-12, affinée : jours nommés).
 * Répond à la vraie question du terrain : « comment va vivre ce chantier ces
 * prochains jours ? ». La plus proche en grand, puis les jours qui suivent,
 * groupés « Aujourd'hui / Demain / jeudi 17 » — le modèle mental d'un agenda,
 * jamais « dans 5 jours ». 14 j / 5 événements max : au-delà, c'est le Journal.
 * Déterministe, zéro IA. Silence positif : rien à venir → la carte n'existe
 * pas ; un seul événement → pas d'agenda d'un seul item ; jours vides tus.
 * Couleurs = langage établi de la fiche (réunion sky / intervention amber /
 * échéance violet — frise, activité, patrimoine) : on ne le fork pas ici.
 * Phrase visée : « le chantier me raconte sa semaine. »
 */
const KIND_META: Record<NextStepKind, { label: string; Icon: typeof Users; cls: string }> = {
  reunion: { label: 'Réunion', Icon: Users, cls: 'text-sky-600' },
  intervention: { label: 'Intervention', Icon: Wrench, cls: 'text-amber-600' },
  echeance: { label: 'Échéance', Icon: CalendarClock, cls: 'text-violet-600' },
}

/** « Aujourd'hui » / « Demain » / « jeudi 17 » — le jour tel qu'on le pense. */
function dayName(s: NextStep): string {
  if (s.inLabel === "aujourd'hui") return "Aujourd'hui"
  if (s.inLabel === 'demain') return 'Demain'
  return s.dayLabel
}

export function NextStepCard({ steps }: { steps: NextStep[] }) {
  if (steps.length === 0) return null
  const [first] = steps
  const meta = KIND_META[first.kind]
  // L'œil lit l'ACTION d'abord ; le type est porté par l'icône et la couleur.
  // On ne le répète en petit que s'il n'ouvre pas déjà le libellé (« Réunion
  // de chantier » n'a pas besoin d'un second « Réunion »).
  const showType = !first.label.toLowerCase().startsWith(meta.label.toLowerCase())

  // L'agenda regroupe TOUTES les étapes (la première comprise : deux
  // événements le même jour doivent se lire ensemble). Jours vides tus.
  const days: Array<{ key: string; name: string; items: NextStep[] }> = []
  for (const s of steps) {
    const last = days[days.length - 1]
    if (last && last.key === s.dayKey) last.items.push(s)
    else days.push({ key: s.dayKey, name: dayName(s), items: [s] })
  }

  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="next-step-card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Agenda du chantier
      </h2>
      <Link href={first.href} className="mt-2.5 flex items-center gap-3 active:opacity-70">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted/60">
          <meta.Icon className={`h-5 w-5 ${meta.cls}`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight">
            {first.label}
          </span>
          <span className="block text-sm text-muted-foreground first-letter:uppercase">
            {showType ? `${meta.label} · ` : ''}
            {first.dateLabel}
            {first.timeLabel ? ` · ${first.timeLabel}` : ''}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {first.inLabel}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {steps.length > 1 && (
        <div className="mt-3 space-y-2.5 border-t pt-2.5">
          {days.map((day) => (
            <div key={day.key}>
              <p className="text-[13px] font-semibold first-letter:uppercase">{day.name}</p>
              <ul className="mt-0.5">
                {day.items.map((s, i) => {
                  const m = KIND_META[s.kind]
                  return (
                    <li key={i}>
                      <Link href={s.href} className="flex items-baseline gap-2 py-0.5 text-[13px] active:opacity-70">
                        <span className="w-11 shrink-0 tabular-nums text-xs text-muted-foreground">
                          {s.timeLabel ?? '—'}
                        </span>
                        <m.Icon className={`h-3.5 w-3.5 shrink-0 self-center ${m.cls}`} />
                        <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
