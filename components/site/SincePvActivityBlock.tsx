import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { ActivityCategory, SiteActivity } from '@/lib/knowledge/site-activity'

// ── LOT 2.1 « Aujourd'hui » — Bloc « Depuis le dernier PV » (mandat Vincent 2026-09-10) ──
//
// Réintégration à l'identique (JSX + logique) de l'ancien `PvActivitySection` de
// `SiteOverviewTab.tsx` (pré-Lot 2), extrait ici en composant partagé desktop/mobile.
// Réutilise `buildActivitySinceLastPv` tel quel — aucune logique métier recréée.

const ACTIVITY_CAT: Record<ActivityCategory, { label: (n: number) => string; cls: string }> = {
  réouvert: { label: (n) => `${n} réouvert${n > 1 ? 's' : ''}`, cls: 'text-amber-700 dark:text-amber-300' },
  aggravé: { label: (n) => `${n} aggravé${n > 1 ? 's' : ''}`, cls: 'text-red-700 dark:text-red-300' },
  nouveau: { label: (n) => `${n} nouveau${n > 1 ? 'x' : ''}`, cls: 'text-sky-700 dark:text-sky-300' },
  réapparu: { label: (n) => `${n} réapparu${n > 1 ? 's' : ''}`, cls: 'text-indigo-700 dark:text-indigo-300' },
  résolu: { label: (n) => `${n} résolu${n > 1 ? 's' : ''}`, cls: 'text-emerald-700 dark:text-emerald-300' },
  autre: { label: (n) => `${n} modifié${n > 1 ? 's' : ''}`, cls: 'text-muted-foreground' },
}

export function SincePvActivityBlock({ activity }: { activity: SiteActivity }) {
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  const { maintenus, nonMentionnes } = activity.synthetic
  const syntheticParts = [
    maintenus > 0 ? `${maintenus} maintenu${maintenus > 1 ? 's' : ''}` : null,
    nonMentionnes > 0 ? `${nonMentionnes} non mentionné${nonMentionnes > 1 ? 's' : ''}` : null,
  ].filter(Boolean)

  return (
    <section aria-labelledby="since-last-pv" className="rounded-[18px] border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 id="since-last-pv" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Depuis le dernier PV
        </h2>
        <span className="text-xs text-muted-foreground">
          {fmtDate(activity.fromDate)} → {fmtDate(activity.toDate)}
        </span>
      </div>
      <div className="mt-3 space-y-3">
        {activity.groups.map((g) => (
          <div key={g.category}>
            <p className={`text-[13px] font-semibold ${ACTIVITY_CAT[g.category]?.cls ?? ''}`}>
              {(ACTIVITY_CAT[g.category]?.label ?? ((n: number) => `${n}`))(g.total)}
            </p>
            <ul className="mt-1 space-y-0.5">
              {g.displayed.map((it) => (
                <li key={it.canonicalSubjectId}>
                  <Link
                    href={it.href}
                    className="flex flex-wrap items-baseline gap-x-2 rounded px-1 -mx-1 py-0.5 hover:bg-muted/50"
                  >
                    <span className="text-sm text-foreground/90">{it.label}</span>
                    {it.trajectory && <span className="text-xs text-muted-foreground">— {it.trajectory}</span>}
                  </Link>
                </li>
              ))}
              {g.hiddenCount > 0 && (
                <li className="pl-1 text-xs text-muted-foreground">+{g.hiddenCount} autre{g.hiddenCount > 1 ? 's' : ''}</li>
              )}
            </ul>
          </div>
        ))}
      </div>
      {syntheticParts.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">{syntheticParts.join(' · ')}</p>
      )}
      <Link href={activity.seeAllHref} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
        Voir tous les changements <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  )
}
