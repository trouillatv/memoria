import Link from 'next/link'
import { Footprints, Users, Wrench, ChevronRight } from 'lucide-react'
import type { SiteActivityItem, SiteActivityKind } from '@/lib/db/visits'

/**
 * « Dernière activité » du chantier — visites, réunions ET interventions, GROUPÉES
 * par jour (Aujourd'hui / Hier / date). Chaque ligne porte un détail déterministe
 * (« 24 photos », « 5 décisions ») quand il existe. Répond à « que s'est-il passé
 * ici ? » d'un coup d'œil. Zéro IA — simple lecture des objets réels.
 */
const META: Record<SiteActivityKind, { Icon: typeof Users; cls: string }> = {
  visit: { Icon: Footprints, cls: 'text-emerald-600' },
  meeting: { Icon: Users, cls: 'text-sky-600' },
  intervention: { Icon: Wrench, cls: 'text-amber-600' },
}

export function SiteActivityCard({ items }: { items: SiteActivityItem[] }) {
  if (items.length === 0) return null

  // Regroupement par jour, en conservant l'ordre décroissant déjà trié en amont.
  const groups: { label: string; items: SiteActivityItem[] }[] = []
  for (const it of items) {
    const last = groups[groups.length - 1]
    if (last && last.label === it.dateLabel) last.items.push(it)
    else groups.push({ label: it.dateLabel, items: [it] })
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Dernière activité</h2>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.label} className="space-y-1.5">
            <p className="text-[12px] font-medium text-muted-foreground first-letter:uppercase">{g.label}</p>
            <ul className="space-y-1.5">
              {g.items.map((i, idx) => {
                const { Icon, cls } = META[i.kind]
                return (
                  <li key={idx}>
                    <Link href={i.href} className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3.5 py-3 shadow-sm active:brightness-95">
                      <Icon className={`h-5 w-5 shrink-0 ${cls}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{i.label}</span>
                        {i.detail && <span className="block text-[12px] text-muted-foreground">{i.detail}</span>}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
