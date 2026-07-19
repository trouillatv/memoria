'use client'

// Deux lectures du MÊME chantier : Pourquoi (les chaînes causales validées) et
// À confirmer (les propositions IA en attente de décision humaine). PAS de
// sous-onglet Chronologie : la Chronologie canonique vit dans la navigation
// principale du chantier — un lien contextuel y renvoie, jamais un doublon.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export type MemoireSubTab = 'pourquoi' | 'confirmer'

export function MemoireSubTabs({ active, toConfirmCount }: { active: MemoireSubTab; toConfirmCount: number }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const href = (k: MemoireSubTab) => {
    const q = new URLSearchParams(params.toString())
    q.set('tab', 'memoire'); q.set('memtab', k)
    return `${pathname}?${q.toString()}`
  }
  const item = (k: MemoireSubTab, label: string, badge?: number) => (
    <Link href={href(k)} scroll={false}
      className={cn('inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm',
        active === k ? 'bg-foreground font-semibold text-background' : 'text-muted-foreground hover:text-foreground')}>
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
          active === k ? 'bg-background/20' : 'bg-muted')}>{badge}</span>
      )}
    </Link>
  )
  // Sélecteur segmenté (pas une 2e barre d'onglets complète) : deux choix lisibles.
  return (
    <div className="mb-4 inline-flex gap-1 rounded-xl border bg-card p-1">
      {item('pourquoi', 'Pourquoi ?')}
      {item('confirmer', 'À confirmer', toConfirmCount)}
    </div>
  )
}
