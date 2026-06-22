import { History, AlertTriangle } from 'lucide-react'
import type { ExperienceTerm } from '@/lib/db/ao-experience'

// A3 v2 — « Ce que dit votre expérience » : confrontation déterministe de l'AO avec
// l'historique des sujets CANONIQUES de l'org. On ne lit plus un document, on
// mobilise le vécu. Factuel, jamais une prédiction.
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
          const bits: string[] = [`${t.occurrences} rencontré${t.occurrences > 1 ? 's' : ''} sur ${t.projectCount} chantier${t.projectCount > 1 ? 's' : ''}`]
          if (t.lateProjects > 0) bits.push(`${t.lateRatioPct}% en retard`)
          if (t.reserveCount > 0) bits.push(`${t.reserveCount} réserve${t.reserveCount > 1 ? 's' : ''}`)
          if (t.openOrBlocked > 0) bits.push(`${t.openOrBlocked} encore ouvert${t.openOrBlocked > 1 ? 's' : ''}`)
          if (t.avgClosureDays != null) bits.push(`clôture moyenne ${t.avgClosureDays} j`)
          return (
            <li key={t.term} className="rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium">
                {t.difficult && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
                {t.term}
                {t.difficult && <span className="text-[10px] font-semibold text-amber-700">· historiquement difficile</span>}
              </span>
              <span className="block text-[12px] text-muted-foreground">{bits.join(' · ')}</span>
              {t.causes.length > 0 && (
                <span className="block text-[11px] text-muted-foreground/90 mt-0.5">
                  Causes récurrentes : {t.causes.map((c) => `${c.label}${c.count > 1 ? ` (${c.count})` : ''}`).join(' · ')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
