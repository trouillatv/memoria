import Link from 'next/link'
import type { SimilarTenderMemory } from '@/lib/db/tenders'

/**
 * TenderMemoryPanel — Mémoire commerciale MC-2.
 *
 * Doctrine V5 verrouillage :
 *  - V1 : mémoire ≠ recommandation → AUCUN conseil, AUCUN CTA action.
 *  - V4 : pas de formulation de contrôle humain → aucun « vous devriez »,
 *    « attention au prix », « reprenez ces points », « ne refaites pas ».
 *  - V5 : édition humaine contrainte → composant strictement read-only.
 *
 * Format : descriptif passif. « Décembre 2025 — perdu sur X pour 'prix' ».
 * Pas de score, pas de classement, pas de %, pas de funnel.
 */

interface Props {
  similarTenders: SimilarTenderMemory[]
}

const TAG_LABELS: Record<string, string> = {
  prix: 'prix',
  qualite: 'qualité',
  relation: 'relation',
  timing: 'timing',
  autre: 'autre',
}

const TAG_COLORS: Record<string, string> = {
  prix:     'bg-amber-50  border-amber-200  text-amber-800',
  qualite:  'bg-violet-50 border-violet-200 text-violet-800',
  relation: 'bg-sky-50    border-sky-200    text-sky-800',
  timing:   'bg-slate-50  border-slate-200  text-slate-700',
  autre:    'bg-slate-50  border-slate-200  text-slate-700',
}

function monthYearLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

export function TenderMemoryPanel({ similarTenders }: Props) {
  if (similarTenders.length === 0) return null

  return (
    <aside className="rounded-lg border bg-card p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold mb-0.5 flex items-center gap-2">
          Mémoire des dossiers similaires
          <span className="text-xs text-muted-foreground font-normal tabular-nums">
            {similarTenders.length}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Dossiers comparables dans l&apos;historique
        </p>
      </header>

      <ul className="space-y-3">
        {similarTenders.map((t) => (
          <li key={t.id}>
            <Link
              href={`/tenders/${t.id}`}
              className="block hover:bg-muted/30 -mx-2 px-2 py-1.5 rounded transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-xs text-muted-foreground capitalize">
                  {monthYearLabel(t.outcome_at)}
                </div>
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium ${
                    t.outcome === 'won'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {t.outcome === 'won' ? 'gagné' : 'perdu'}
                </span>
              </div>
              <div className="text-sm font-medium leading-tight mb-1">
                {t.title}
              </div>
              {t.client_name && (
                <div className="text-xs text-muted-foreground mb-1">
                  {t.client_name}
                </div>
              )}
              {t.outcome === 'lost' && t.outcome_tag && (
                <span className={`inline-flex text-[10px] px-1.5 py-0.5 rounded border ${TAG_COLORS[t.outcome_tag]} mb-1`}>
                  {TAG_LABELS[t.outcome_tag]}
                </span>
              )}
              {t.outcome_reason && (
                <div className="text-xs text-muted-foreground italic mt-1 line-clamp-2">
                  «&nbsp;{t.outcome_reason}&nbsp;»
                </div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  )
}
