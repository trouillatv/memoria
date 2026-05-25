// Points de vigilance issus de l'AO — visibilité opérationnelle côté contrat.
// Vincent 2026-05-25. Atelier IA v2, Phase 1 (matérialisation de la vigilance).
//
// Présentation PURE, read-only. Wording factuel : « Point de vigilance »,
// « Extrait source ». Jamais « risque critique », jamais de score. Silence si
// aucune vigilance. Pas de moteur de signaux, pas d'IA.

import { ShieldAlert } from 'lucide-react'
import type { DbEngagement } from '@/types/db'

function refLabel(ref: Record<string, unknown> | null): string {
  if (!ref) return ''
  const parts: string[] = []
  if (ref.page != null) parts.push(`p. ${ref.page}`)
  if (ref.section != null) parts.push(`§ ${ref.section}`)
  return parts.join(' · ')
}

export function ContractVigilancePanel({ vigilances }: { vigilances: DbEngagement[] }) {
  if (vigilances.length === 0) return null // silence si rien

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/30 dark:bg-amber-950/15 p-4 space-y-3">
      <h2 className="text-sm font-semibold inline-flex items-center gap-2 text-amber-900 dark:text-amber-200">
        <ShieldAlert className="h-4 w-4" />
        Points de vigilance issus de l&apos;AO
        <span className="text-xs font-normal text-amber-800/70 dark:text-amber-200/60">
          ({vigilances.length})
        </span>
      </h2>

      <ul className="space-y-2">
        {vigilances.map((v) => {
          const ref = refLabel(v.source_ref)
          return (
            <li key={v.id} className="rounded-md border bg-card p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{v.short_label}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {v.category}
                </span>
                {v.status === 'active' && (
                  <span className="ml-auto text-[10px] rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                    actif
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground italic">
                Extrait source : « {v.source_excerpt} »
              </p>
              {ref && (
                <p className="mt-0.5 text-[10px] text-muted-foreground/80">{ref}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
