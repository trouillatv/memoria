// NORM-2 (mandat Vincent 2026-09-25) — carte compacte partagée desktop/mobile
// pour les Prestations prévues. Fonction pure sans hook (nécessaire pour
// rester compatible avec les tests qui marchent l'arbre React non monté en
// invoquant les composants fonction directement).
//
// Compact par défaut : titre, fréquence, kind/category/Mesurable, statut
// seulement quand il distingue la carte au sein de sa section. Document/page/
// extrait/preuves additionnelles vont dans un détail dépliable unique —
// aucune information du read-model n'est supprimée, seulement déplacée.

import { categoryLabel, plannedEngagementStatusLabel } from '@/lib/engagements/labels'
import { KIND_META, kindLabel } from '@/lib/engagements/kind'
import type { PlannedEngagement } from '@/lib/db/engagements'

export function PlannedEngagementCard({
  engagement: e,
  showStatusBadge,
}: {
  engagement: PlannedEngagement
  showStatusBadge: boolean
}) {
  const statusBadge = e.status === 'active'
    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
    : 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  const kindBadge = e.kind ? KIND_META[e.kind].badge : 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'

  return (
    <li className="rounded-xl border bg-card p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{e.shortLabel}</p>
        {showStatusBadge && (
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadge}`}>
            {plannedEngagementStatusLabel(e.status)}
          </span>
        )}
      </div>

      {e.primaryProvenance.frequencyRaw && (
        <p className="text-sm font-medium text-foreground">{e.primaryProvenance.frequencyRaw}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${kindBadge}`}>
          {kindLabel(e.kind)}
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {categoryLabel(e.category)}
        </span>
        {e.measurable && (
          <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
            Mesurable
          </span>
        )}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Détail &amp; provenance
        </summary>
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          {!showStatusBadge && (
            <p className="text-[11px] font-medium text-muted-foreground">
              Statut :{' '}
              <span className={`rounded-full border px-2 py-0.5 ${statusBadge}`}>
                {plannedEngagementStatusLabel(e.status)}
              </span>
            </p>
          )}
          <ProvenanceLine provenance={e.primaryProvenance} />
          {e.additionalProvenance.map((p, i) => (
            <ProvenanceLine key={i} provenance={p} />
          ))}
        </div>
      </details>
    </li>
  )
}

export function ProvenanceLine({ provenance: p }: { provenance: PlannedEngagement['primaryProvenance'] }) {
  const source = [p.documentFilename ?? 'Document', p.pageNumber ? `p.${p.pageNumber}` : null].filter(Boolean).join(' · ')
  return (
    <div className="space-y-0.5">
      <p className="truncate text-xs text-muted-foreground">{source}</p>
      {p.excerpt && <p className="text-xs italic text-muted-foreground/80 line-clamp-2">« {p.excerpt} »</p>}
    </div>
  )
}
