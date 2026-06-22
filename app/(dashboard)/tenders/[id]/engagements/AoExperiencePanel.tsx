import { History, AlertTriangle } from 'lucide-react'
import type { ExperienceTerm } from '@/lib/db/ao-experience'

// A3 — « Ce que dit votre expérience » : confrontation déterministe de l'AO avec
// l'historique des sujets de l'org. On ne lit plus un document, on mobilise le vécu.
export function AoExperiencePanel({ terms }: { terms: ExperienceTerm[] }) {
  if (terms.length === 0) return null
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
      <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
        <History className="h-4 w-4 text-amber-700" /> Ce que dit votre expérience
      </h2>
      <p className="text-[11px] text-muted-foreground">
        Des exigences de cet AO ont déjà été rencontrées sur d&apos;autres chantiers. Historique factuel, pas une prédiction.
      </p>
      <ul className="space-y-1.5">
        {terms.map((t) => {
          const bits: string[] = [`rencontré sur ${t.projectCount} chantier${t.projectCount > 1 ? 's' : ''}`]
          if (t.lateProjects > 0) bits.push(`${t.lateProjects} en retard`)
          if (t.reserveCount > 0) bits.push(`${t.reserveCount} réserve${t.reserveCount > 1 ? 's' : ''}`)
          if (t.openOrBlocked > 0) bits.push(`${t.openOrBlocked} encore ouvert${t.openOrBlocked > 1 ? 's' : ''}`)
          if (t.avgClosureDays != null) bits.push(`clôture moyenne ${t.avgClosureDays} j`)
          const warn = t.lateProjects > 0 || t.reserveCount > 0
          return (
            <li key={t.term} className="rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium">
                {warn && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                {t.term}
              </span>
              <span className="block text-[12px] text-muted-foreground">{bits.join(' · ')}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
