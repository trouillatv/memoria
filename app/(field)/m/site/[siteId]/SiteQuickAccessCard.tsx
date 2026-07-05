import Link from 'next/link'
import { Footprints, Users, Clock, Brain, FileText, ChevronRight } from 'lucide-react'

/**
 * « Accès rapides » de la fiche chantier — raccourcis vers des vues qui existent
 * RÉELLEMENT. Discipline : une entrée n'apparaît que si sa destination est
 * branchée ET a du contenu.
 *   - Visites / Réunions / Frise : routes /m dédiées.
 *   - Mémoire : panneau de recherche déjà présent plus bas sur la fiche (ancre).
 *   - Documents : uniquement si le chantier a de vrais documents liés ET que
 *     l'utilisateur y a droit (conducteur) — sinon absente (pas de faux menu).
 */
export function SiteQuickAccessCard({ siteId, showDocuments = false }: { siteId: string; showDocuments?: boolean }) {
  const items = [
    { href: `/m/site/${siteId}/visites`, label: 'Toutes les visites', Icon: Footprints, cls: 'text-emerald-600' },
    { href: `/m/site/${siteId}/reunions`, label: 'Toutes les réunions', Icon: Users, cls: 'text-sky-600' },
    { href: `/m/site/${siteId}/frise`, label: 'Frise du chantier', Icon: Clock, cls: 'text-amber-600' },
    ...(showDocuments
      ? [{ href: `/m/site/${siteId}/documents`, label: 'Documents', Icon: FileText, cls: 'text-slate-500' }]
      : []),
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
