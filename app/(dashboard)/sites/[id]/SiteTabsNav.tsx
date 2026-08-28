import Link from 'next/link'
import { cn } from '@/lib/utils'

export const SITE_TABS = [
  { key: 'apercu',           label: 'Aperçu' },
  // « Visites » (retour Guillaume, 2026-08-14) : « Chronologie pour moi c'est de
  // la planification, l'évolution du chantier — alors que là c'est des comptes
  // rendus. » Son modèle mental est le bon :
  //   Visites = ce que j'ai capturé sur le terrain et les CR associés ;
  //   Chronologie = ce qui s'est passé sur le chantier dans le temps.
  // On ne demande plus à l'utilisateur de deviner que ses visites vivent
  // dans la Chronologie.
  { key: 'visites',          label: 'Visites' },
  { key: 'chronologie',      label: 'Chronologie' },
  // Histoire = onglet de premier niveau depuis 2026-08-04. Doctrine :
  //   Chronologie = qu'est-ce qui s'est passé, événement après événement ?
  //   Histoire = qu'est-ce qui a évolué dans le temps et comment en est-on arrivé là ?
  // Route dédiée (/historique) → href calculé spécifiquement dans SiteTabsNav.
  { key: 'histoire',         label: 'Suivi',      pathSuffix: '/historique' },
  { key: 'planning',         label: 'Planning' },
  // « Réserves » (Points à lever) : route dédiée existante (/reserves), simplement
  // absente de la barre — n'était accessible que par le lien du hub d'aperçu.
  { key: 'reserves',         label: 'Réserves',  pathSuffix: '/reserves' },
  // « Actions » : route dédiée existante (/actions), même traitement que Réserves.
  { key: 'actions',          label: 'Actions',   pathSuffix: '/actions' },
  { key: 'documents-preuves', label: 'Documents' },
  // « Intervenants » (cadrage + maquette validés 2026-07-18).
  { key: 'intervenants',     label: 'Intervenants' },
  { key: 'memoire',          label: 'Mémoire' },
  // « Explorer » (cadrage 2026-07-18) : Mémoire dit ce que MemorIA sait ;
  // Explorer montre comment tout est relié.
  { key: 'explorer',         label: 'Explorer' },
] as const

export type SiteTabKey = typeof SITE_TABS[number]['key']

export const SITE_TAB_KEYS = SITE_TABS.map((t) => t.key) as ReadonlyArray<SiteTabKey>

/** L'onglet actif, tolérant : une valeur absente ou inconnue retombe sur l'Aperçu.
 *  Pur et exporté pour être testable — c'est lui qui décide quel onglet charge ses
 *  données (étape 1 « Réactivité perçue »). */
export function resolveSiteTab(raw: string | null | undefined): SiteTabKey {
  return (SITE_TAB_KEYS as ReadonlyArray<string>).includes(raw ?? '')
    ? (raw as SiteTabKey)
    : 'apercu'
}

function tabHref(t: typeof SITE_TABS[number], siteId: string): string {
  if (t.key === 'apercu') return `/sites/${siteId}`
  if ('pathSuffix' in t) return `/sites/${siteId}${t.pathSuffix}`
  return `/sites/${siteId}?tab=${t.key}`
}

export function SiteTabsNav({ active, siteId }: { active: SiteTabKey; siteId: string }) {
  return (
    <nav
      aria-label="Vues du chantier"
      className="flex items-center gap-7 overflow-x-auto border-b border-border/80"
    >
      {SITE_TABS.map((t) => (
        <Link
          key={t.key}
          scroll={'pathSuffix' in t ? true : false}
          href={tabHref(t, siteId)}
          className={cn(
            'shrink-0 border-b-2 px-0 py-3 text-sm font-medium transition-colors',
            active === t.key
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
