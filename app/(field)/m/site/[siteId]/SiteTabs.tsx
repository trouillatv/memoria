'use client'

/**
 * Onglets intra-chantier — rendus par le LAYOUT partagé `(chantier)/layout.tsx`,
 * donc montés UNE fois et persistants : passer d'une pill à l'autre ne recharge
 * que le contenu sous les pills, jamais l'en-tête ni la barre.
 *
 * Composant CLIENT : l'onglet actif est dérivé de `usePathname()` (le layout ne
 * se réexécute pas à la navigation ; l'actif doit donc se recalculer côté client).
 * La décision d'afficher « Documents » (conducteur + docs réels) est calculée
 * côté serveur dans le layout et passée en `showDocuments`.
 *
 * « Actions » pointe vers `/m/site/[siteId]/actions` — même moteur unifié que
 * `/m/actions?site=…`, mais SOUS le layout chantier (fluidité des pills).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ScrollActiveRail } from '@/components/ui/ScrollActiveRail'

export type SiteTab =
  | 'vue' | 'sujets' | 'carte' | 'terrain' | 'explorer' | 'reserves'
  | 'actions' | 'visites' | 'photos' | 'reunions' | 'frise' | 'documents' | 'patrimoine'

// `seg` = segment d'URL après la base ('' = Synthèse/hub).
const TABS: Array<{ key: SiteTab; label: string; seg: string }> = [
  { key: 'vue',        label: 'Synthèse',   seg: '' },
  { key: 'sujets',     label: 'Sujets',     seg: 'sujets' },
  { key: 'carte',      label: 'Carte',      seg: 'carte' },
  { key: 'terrain',    label: 'Terrain',    seg: 'terrain' },
  { key: 'explorer',   label: 'Explorer',   seg: 'explorer' },
  { key: 'reserves',   label: 'Réserves',   seg: 'reserves' },
  { key: 'actions',    label: 'Actions',    seg: 'actions' },
  { key: 'visites',    label: 'Visites',    seg: 'visites' },
  { key: 'photos',     label: 'Photos',     seg: 'photos' },
  { key: 'reunions',   label: 'Réunions',   seg: 'reunions' },
  { key: 'frise',      label: 'Frise',      seg: 'frise' },
  { key: 'documents',  label: 'Documents',  seg: 'documents' },
  { key: 'patrimoine', label: 'Patrimoine', seg: 'patrimoine' },
]

export function SiteTabs({ siteId, showDocuments }: { siteId: string; showDocuments: boolean }) {
  const pathname = usePathname()
  const base = `/m/site/${siteId}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, '') : ''
  const activeSeg = rest.split('/')[0]
  const active: SiteTab = TABS.find((t) => t.seg === activeSeg)?.key ?? 'vue'

  const tabs = TABS
    .filter((t) => t.key !== 'documents' || showDocuments)
    .map((t) => ({ key: t.key, label: t.label, href: t.seg ? `${base}/${t.seg}` : base }))

  return (
    <ScrollActiveRail activeKey={active} ariaLabel="Onglets du chantier" className="scrollbar-hide -mx-3 overflow-x-auto px-3">
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
    </ScrollActiveRail>
  )
}
