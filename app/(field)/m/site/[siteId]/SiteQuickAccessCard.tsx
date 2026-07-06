import Link from 'next/link'
import { Footprints, Users, Clock, Brain, FileText } from 'lucide-react'

/**
 * « Accès rapides » de la fiche chantier — une BANDE d'icônes (façon Apple/Linear),
 * une tuile par vue du chantier. Discipline : une entrée n'apparaît que si sa
 * destination est branchée ET a du contenu.
 *   - Visites / Réunions / Frise : routes /m dédiées.
 *   - Mémoire : panneau de recherche déjà présent plus bas sur la fiche (ancre).
 *   - Documents : uniquement si le chantier a de vrais documents liés ET que
 *     l'utilisateur y a droit (conducteur) — sinon absente (pas de faux menu).
 */
export function SiteQuickAccessCard({ siteId, showDocuments = false }: { siteId: string; showDocuments?: boolean }) {
  const items = [
    { href: `/m/site/${siteId}/visites`, label: 'Visites', Icon: Footprints, cls: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
    { href: `/m/site/${siteId}/reunions`, label: 'Réunions', Icon: Users, cls: 'text-sky-600', bg: 'bg-sky-50 dark:bg-sky-950/40' },
    { href: `/m/site/${siteId}/frise`, label: 'Frise', Icon: Clock, cls: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/40' },
    { href: `/m/site/${siteId}#memoire-lieu`, label: 'Mémoire', Icon: Brain, cls: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/40' },
    ...(showDocuments
      ? [{ href: `/m/site/${siteId}/documents`, label: 'Documents', Icon: FileText, cls: 'text-slate-500', bg: 'bg-slate-100 dark:bg-slate-800/60' }]
      : []),
  ]
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Accès rapides</h2>
      <div className={`grid gap-1 ${items.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>
        {items.map(({ href, label, Icon, cls, bg }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 active:bg-accent"
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${bg}`}>
              <Icon className={`h-5 w-5 ${cls}`} />
            </span>
            <span className="text-[11px] font-medium leading-tight text-center text-muted-foreground">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
