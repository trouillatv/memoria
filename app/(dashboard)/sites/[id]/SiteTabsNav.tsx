import Link from 'next/link'
import { cn } from '@/lib/utils'

export const SITE_TABS = [
  { key: 'apercu', label: 'Aperçu' },
  { key: 'travail', label: 'Travail' },
  { key: 'chronologie', label: 'Chronologie' },
  { key: 'planning', label: 'Planning' },
  { key: 'documents-preuves', label: 'Documents & preuves' },
  { key: 'memoire', label: 'Mémoire' },
] as const

export type SiteTabKey = typeof SITE_TABS[number]['key']

export const SITE_TAB_KEYS = SITE_TABS.map((t) => t.key) as ReadonlyArray<SiteTabKey>

export function SiteTabsNav({ active, siteId }: { active: SiteTabKey; siteId: string }) {
  return (
    <nav
      aria-label="Vues du chantier"
      className="flex items-center gap-7 overflow-x-auto border-b border-border/80"
    >
      {SITE_TABS.map((t) => (
        <Link
          key={t.key}
          scroll={false}
          href={t.key === 'apercu' ? `/sites/${siteId}` : `/sites/${siteId}?tab=${t.key}`}
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
