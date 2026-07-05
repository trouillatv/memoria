import Link from 'next/link'
import { Footprints, Users, Wrench, ChevronRight } from 'lucide-react'
import type { SiteActivityItem, SiteActivityKind } from '@/lib/db/visits'

/**
 * « Dernière activité » du chantier — visites, réunions ET interventions récentes,
 * du plus récent au plus ancien. Répond à « que s'est-il passé ici ? ». Sobre,
 * une ligne par événement, chacun ouvre le détail.
 */
const META: Record<SiteActivityKind, { Icon: typeof Users; cls: string }> = {
  visit: { Icon: Footprints, cls: 'text-emerald-600' },
  meeting: { Icon: Users, cls: 'text-sky-600' },
  intervention: { Icon: Wrench, cls: 'text-amber-600' },
}

export function SiteActivityCard({ items }: { items: SiteActivityItem[] }) {
  if (items.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dernière activité</h2>
      <ul className="overflow-hidden rounded-xl border bg-card divide-y">
        {items.map((i, idx) => {
          const { Icon, cls } = META[i.kind]
          return (
            <li key={idx}>
              <Link href={i.href} className="flex items-center gap-3 px-3.5 py-3 active:bg-accent">
                <Icon className={`h-5 w-5 shrink-0 ${cls}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.label}</span>
                  <span className="block text-[12px] text-muted-foreground first-letter:uppercase">{i.dateLabel}</span>
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
