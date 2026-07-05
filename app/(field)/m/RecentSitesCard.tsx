import Link from 'next/link'
import { ChevronRight, Building2 } from 'lucide-react'
import type { RecentSiteItem } from '@/lib/db/visits'

/**
 * « Chantiers récents » — les 3 derniers dossiers ouverts, pour ne pas passer par
 * « Chantiers » à chaque fois. SOBRE : une ligne, du texte, pas de grande image
 * (nom · dernière activité · actions/réserves ouvertes · accès rapide au dossier).
 */
export function RecentSitesCard({ sites }: { sites: RecentSiteItem[] }) {
  if (sites.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold tracking-tight">Chantiers récents</h2>
      <ul className="overflow-hidden rounded-xl border bg-card divide-y">
        {sites.map((s) => {
          const meta = [
            s.lastActivityLabel,
            s.openActions > 0 ? `${s.openActions} action${s.openActions > 1 ? 's' : ''}` : null,
            s.openReserves > 0 ? `${s.openReserves} réserve${s.openReserves > 1 ? 's' : ''}` : null,
          ].filter(Boolean).join(' · ')
          return (
            <li key={s.siteId}>
              <Link href={`/m/site/${s.siteId}`} className="flex items-center gap-3 px-3.5 py-3 active:bg-accent">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  {meta && <span className="block truncate text-[12px] text-muted-foreground">{meta}</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
