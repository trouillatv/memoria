// Navigation par onglets pour la fiche site — visible sur mobile uniquement (md:hidden).
// Rendu serveur pur : <Link> statiques, zéro JS client.
// L'onglet actif est déterminé par le search param ?tab= résolu côté serveur.

import Link from 'next/link'
import { cn } from '@/lib/utils'

export const SITE_TABS = [
  { key: 'apercu',     label: 'Aperçu' },
  { key: 'activite',  label: 'Activité' },
  { key: 'equipe',    label: 'Équipe' },
  { key: 'memoire',   label: 'Mémoire' },
  { key: 'documents', label: 'Documents' },
] as const

export type SiteTabKey = typeof SITE_TABS[number]['key']

export const SITE_TAB_KEYS = SITE_TABS.map((t) => t.key) as ReadonlyArray<SiteTabKey>

export function SiteTabsNav({ active, siteId }: { active: SiteTabKey; siteId: string }) {
  return (
    <nav
      aria-label="Onglets de la fiche chantier"
      className="flex items-center border-b overflow-x-auto scrollbar-hide md:hidden -mb-px"
    >
      {SITE_TABS.map((t) => (
        <Link
          key={t.key}
          // scroll={false} : changer d'onglet ne doit PAS faire remonter la page
          // en haut — on reste au même niveau (la barre d'onglets).
          scroll={false}
          href={t.key === 'apercu' ? `/sites/${siteId}` : `/sites/${siteId}?tab=${t.key}`}
          className={cn(
            'shrink-0 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors',
            active === t.key
              ? 'border-foreground text-foreground font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
