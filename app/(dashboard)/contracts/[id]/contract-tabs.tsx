import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'overview',      label: "Vue d'ensemble", path: '' },
  { key: 'sites',         label: 'Sites',          path: '/sites' },
  { key: 'missions',      label: 'Missions',       path: '/missions' },
  { key: 'interventions', label: 'Interventions',  path: '/interventions' },
] as const

type TabKey = typeof TABS[number]['key']

export function ContractTabs({ contractId, active }: { contractId: string; active: TabKey }) {
  return (
    <nav className="flex items-center gap-1 border-b -mb-px overflow-x-auto scrollbar-hide">
      {TABS.map((t) => {
        const isActive = t.key === active
        return (
          <Link
            key={t.key}
            href={`/contracts/${contractId}${t.path}`}
            className={cn(
              'shrink-0 whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px transition-colors',
              isActive
                ? 'border-foreground text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30',
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
