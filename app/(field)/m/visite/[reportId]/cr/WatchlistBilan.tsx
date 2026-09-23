import { AlertTriangle, Ban, CheckSquare, Minus } from 'lucide-react'
import { listWatchlist } from '@/lib/db/visit-watchlist'
import { computeWatchlistCoverage } from '@/lib/visits/watchlist-coverage'
import type { WatchlistItemState } from '@/types/db'

// Motif affiché par ligne « non traité positivement » — jamais déduit du seul
// état courant de la source, toujours porté par l'état watchlist lui-même.
const NON_CHECKED_META: Partial<Record<WatchlistItemState, {
  icon: typeof AlertTriangle
  iconClass: string
  textClass: string
  tag: string
}>> = {
  still_open: { icon: AlertTriangle, iconClass: 'text-amber-500', textClass: 'text-amber-700 dark:text-amber-400', tag: 'Toujours ouvert' },
  not_applicable_visit: { icon: Minus, iconClass: 'text-slate-400', textClass: 'text-slate-600 dark:text-slate-400', tag: 'Sans objet pour cette visite' },
  not_applicable: { icon: Minus, iconClass: 'text-slate-400', textClass: 'text-slate-600 dark:text-slate-400', tag: 'Sans objet' },
  dismissed_permanently: { icon: Ban, iconClass: 'text-red-500', textClass: 'text-red-600 dark:text-red-400', tag: 'Ne plus suivre' },
}

export async function WatchlistBilan({ reportId }: { reportId: string }) {
  const items = await listWatchlist(reportId).catch(() => [])
  if (items.length === 0) return null

  const cov = computeWatchlistCoverage(items)
  // Distinction sans ambiguïté (Lot B) : sans objet POUR CETTE VISITE (peut
  // réapparaître) ≠ ne plus suivre (définitif) ≠ sans objet legacy — jamais
  // reconstruite depuis le seul état courant de la source.
  const nonChecked = items.filter((i) =>
    i.state === 'still_open' || i.state === 'not_applicable' || i.state === 'not_applicable_visit' || i.state === 'dismissed_permanently',
  )

  return (
    <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-950/40">
          <CheckSquare className="h-[18px] w-[18px] text-teal-600" />
        </span>
        <h2 className="min-w-0 flex-1 text-sm font-semibold">Plan de visite</h2>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {cov.total} point{cov.total > 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <BilanCell
          count={cov.checked}
          label={cov.checked > 1 ? 'positifs' : 'positif'}
          bg="bg-emerald-50/70 dark:bg-emerald-950/20"
          text="text-emerald-700 dark:text-emerald-400"
          border="border-emerald-200/60 dark:border-emerald-900/40"
        />
        <BilanCell
          count={cov.stillOpen}
          label={cov.stillOpen > 1 ? 'ouverts' : 'ouvert'}
          bg="bg-amber-50/70 dark:bg-amber-950/20"
          text="text-amber-700 dark:text-amber-400"
          border="border-amber-200/60 dark:border-amber-900/40"
        />
        {cov.notApplicableVisit > 0 && (
          <BilanCell
            count={cov.notApplicableVisit}
            label="sans objet (visite)"
            bg="bg-slate-50/70 dark:bg-slate-900/40"
            text="text-slate-600 dark:text-slate-400"
            border="border-slate-200/60 dark:border-slate-700/40"
          />
        )}
        <BilanCell
          count={cov.notApplicable}
          label="sans objet"
          bg="bg-slate-50/70 dark:bg-slate-900/40"
          text="text-slate-600 dark:text-slate-400"
          border="border-slate-200/60 dark:border-slate-700/40"
        />
        {cov.dismissedPermanently > 0 && (
          <BilanCell
            count={cov.dismissedPermanently}
            label="ne plus suivre"
            bg="bg-red-50/70 dark:bg-red-950/20"
            text="text-red-600 dark:text-red-400"
            border="border-red-200/60 dark:border-red-900/40"
          />
        )}
      </div>

      {/* Un état de source ne dit jamais l'intention historique : chaque ligne
          porte son propre motif (toujours ouvert / sans objet visite / sans
          objet / ne plus suivre) au lieu d'être reconstruite après coup. */}
      {nonChecked.length > 0 && (
        <ul className="mt-3 space-y-2.5 border-t pt-3">
          {nonChecked.map((item) => {
            const meta = NON_CHECKED_META[item.state] ?? NON_CHECKED_META.not_applicable!
            const Icon = meta.icon
            return (
              <li key={item.id} className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.iconClass}`} />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-snug">{item.label}</p>
                  <p className={`mt-0.5 text-[11px] font-medium leading-snug ${meta.textClass}`}>{meta.tag}</p>
                  {item.note && (
                    <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{item.note}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {cov.pending > 0 && (
        <p className="mt-2.5 text-[12px] text-muted-foreground">
          {cov.pending} point{cov.pending > 1 ? 's' : ''} non vérifié{cov.pending > 1 ? 's' : ''} pendant la visite.
        </p>
      )}
    </section>
  )
}

function BilanCell({
  count, label, bg, text, border,
}: {
  count: number
  label: string
  bg: string
  text: string
  border: string
}) {
  return (
    <div className={`flex-1 basis-[28%] min-w-[84px] rounded-xl border p-2.5 text-center ${bg} ${border}`}>
      <div className={`text-xl font-bold tabular-nums ${text}`}>{count}</div>
      <div className={`text-[11px] leading-tight ${text} opacity-70`}>{label}</div>
    </div>
  )
}
