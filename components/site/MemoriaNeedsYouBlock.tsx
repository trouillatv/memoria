import Link from 'next/link'
import { ChevronRight, HelpCircle } from 'lucide-react'
import type { MemoriaNeedsYouSummary } from '@/lib/knowledge/tracked-point-needs-you-summary'

// ── LOT 2 « Aujourd'hui » — Bloc 2 « MemorIA a besoin de toi » ──
//
// Extrait tel quel (6E.4A) de l'ancien onglet Aperçu (`SiteOverviewTab.tsx`) : même
// read-model (`loadMemoriaNeedsYouSummary`), même contenu, seulement rendu ici pour être
// partagé desktop/mobile. Silence total si vide — jamais un compteur affiché à zéro.

// 6E.4A.5 — memoriaNeedsYou.latestPvDate est une date-only (YYYY-MM-DD, sans heure) : pas de
// décalage de fuseau à corriger.
function formatShortPvDate(dateOnly: string): string {
  return new Date(dateOnly).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

export function MemoriaNeedsYouBlock({
  summary,
  seeAllHref,
}: {
  summary: MemoriaNeedsYouSummary
  seeAllHref: string
}) {
  if (summary.totalCount === 0) return null

  return (
    <section aria-labelledby="memoria-besoin-de-toi" className="rounded-[18px] border border-violet-200 bg-violet-50/50 p-4 shadow-sm dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
          <HelpCircle className="h-4 w-4 text-violet-600 dark:text-violet-300" />
        </span>
        <div className="min-w-0">
          <h2 id="memoria-besoin-de-toi" className="text-sm font-semibold uppercase tracking-wide text-violet-900 dark:text-violet-200">
            MemorIA a besoin de toi
          </h2>
          <p className="text-base font-semibold">
            {summary.totalCount} point{summary.totalCount > 1 ? 's' : ''} à clarifier
          </p>
          {summary.latestPvDate && summary.historicalCount > 0 && (
            <p className="text-xs text-violet-700/80 dark:text-violet-300/70">
              {summary.latestPvCount} sur le dernier PV ({formatShortPvDate(summary.latestPvDate)}) · {summary.historicalCount} dans l&apos;historique
            </p>
          )}
        </div>
        <Link
          href={seeAllHref}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-[13px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-transparent dark:text-violet-300"
        >
          Tout voir <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <ul className="mt-3 space-y-1.5">
        {summary.categories.filter((c) => c.count > 0).map((c) => (
          <li key={c.category} className="flex items-center gap-2 text-sm text-foreground/90">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              {c.count}
            </span>
            <span>{c.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
