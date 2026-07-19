'use client'

// Trois lectures du MÊME chantier : Pourquoi (les chaînes causales), Chronologie
// (les faits datés), À confirmer (les propositions IA). Pas un nouvel item de menu
// — trois angles d'un seul écran de compréhension.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export type MemoireSubTab = 'pourquoi' | 'chronologie' | 'confirmer'

const SUB: Array<{ key: MemoireSubTab; label: string; sub: string }> = [
  { key: 'pourquoi', label: 'Pourquoi ?', sub: 'Le pourquoi' },
  { key: 'chronologie', label: 'Chronologie', sub: 'Le quand' },
  { key: 'confirmer', label: 'À confirmer', sub: 'Ce que l’IA propose' },
]

export function MemoireSubTabs({ active }: { active: MemoireSubTab }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const href = (k: MemoireSubTab) => {
    const q = new URLSearchParams(params.toString())
    q.set('tab', 'memoire'); q.set('memtab', k)
    return `${pathname}?${q.toString()}`
  }
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b">
      {SUB.map((s) => (
        <Link key={s.key} href={href(s.key)} scroll={false}
          className={cn('flex flex-col border-b-2 px-4 pb-2 pt-1', active === s.key ? 'border-primary' : 'border-transparent')}>
          <span className={cn('text-sm font-semibold', active === s.key ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
          <span className="text-[11px] text-muted-foreground/80">{s.sub}</span>
        </Link>
      ))}
    </div>
  )
}
