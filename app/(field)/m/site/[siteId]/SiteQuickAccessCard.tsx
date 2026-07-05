import Link from 'next/link'
import { Camera, Users, Brain, ChevronRight } from 'lucide-react'

/**
 * « Accès rapides » de la fiche chantier — raccourcis vers des vues qui existent
 * RÉELLEMENT. Discipline : une entrée n'apparaît que si sa destination est
 * branchée.
 *   - Visites / Réunions : routes /m dédiées (listes chronologiques).
 *   - Mémoire : panneau de recherche déjà présent plus bas sur la fiche (ancre).
 *   - Frise : volontairement ABSENTE tant que /m/site/[id]/frise n'existe pas.
 *   - Documents : absente (pas de stockage documentaire).
 */
export function SiteQuickAccessCard({ siteId }: { siteId: string }) {
  const items = [
    { href: `/m/site/${siteId}/visites`, label: 'Toutes les visites', Icon: Camera, cls: 'text-emerald-600' },
    { href: `/m/site/${siteId}/reunions`, label: 'Toutes les réunions', Icon: Users, cls: 'text-sky-600' },
    { href: `/m/site/${siteId}#memoire-lieu`, label: 'Mémoire du chantier', Icon: Brain, cls: 'text-violet-600' },
  ]
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Accès rapides</h2>
      <ul className="overflow-hidden rounded-xl border bg-card divide-y">
        {items.map(({ href, label, Icon, cls }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-3.5 py-3 active:bg-accent">
              <Icon className={`h-5 w-5 shrink-0 ${cls}`} />
              <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
