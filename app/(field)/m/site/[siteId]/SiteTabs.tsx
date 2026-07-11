import Link from 'next/link'
import { listDocumentsForTarget } from '@/lib/db/documents'

/**
 * Onglets intra-chantier — sur les sous-vues de la fiche (Visites / Réunions /
 * Frise / Documents), pour passer de l'une à l'autre SANS revenir à la fiche à
 * chaque fois. « Synthèse » ramène au cockpit ; « Patrimoine » ouvre la
 * connaissance accumulée du chantier (recherche + blocs). Documents n'apparaît que pour le
 * conducteur (admin/manager) ET s'il existe de vrais documents liés — jamais un
 * onglet vide. Barre défilante horizontalement (aucun retour arrière requis).
 */
export type SiteTab = 'vue' | 'visites' | 'reunions' | 'frise' | 'documents' | 'patrimoine'

export async function SiteTabs({
  siteId,
  active,
  userRole,
}: {
  siteId: string
  active: SiteTab
  userRole: string
}) {
  const showDocuments =
    (userRole === 'admin' || userRole === 'manager') &&
    (await listDocumentsForTarget('site', siteId).catch(() => [])).length > 0

  const base = `/m/site/${siteId}`
  const tabs: { key: SiteTab; label: string; href: string }[] = [
    { key: 'vue', label: 'Synthèse', href: base },
    { key: 'visites', label: 'Visites', href: `${base}/visites` },
    { key: 'reunions', label: 'Réunions', href: `${base}/reunions` },
    { key: 'frise', label: 'Frise', href: `${base}/frise` },
    ...(showDocuments ? [{ key: 'documents' as const, label: 'Documents', href: `${base}/documents` }] : []),
    { key: 'patrimoine', label: 'Patrimoine', href: `${base}/patrimoine` },
  ]

  return (
    <nav className="scrollbar-hide -mx-3 overflow-x-auto px-3">
      <ul className="flex w-max gap-1.5">
        {tabs.map((t) => {
          const isActive = t.key === active
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={isActive ? 'page' : undefined}
                className={`inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-card text-muted-foreground active:bg-accent'
                }`}
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
