'use client'

// ── « Comprendre pourquoi » / « Explorer les liens » — le graphe causal en
// panneau contextuel, pas en onglet (simplification Mémoire, Vincent 2026-09-22).
// Aucun nouveau moteur : on ouvre MemoireCausale (fils déjà assemblés par
// getSiteCausalThreads) dans un Dialog existant. Zéro logique dupliquée.

import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { MemoireCausale } from './MemoireCausale'
import type { CausalThread } from '@/lib/knowledge/causal-threads-model'

export function CausalPanel({
  threads,
  siteId,
  title,
  triggerLabel,
  triggerClassName,
}: {
  threads: CausalThread[]
  siteId: string
  title: string
  triggerLabel: ReactNode
  triggerClassName?: string
}) {
  return (
    <Dialog>
      <DialogTrigger
        className={triggerClassName ?? 'inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground'}
      >
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <MemoireCausale threads={threads} siteId={siteId} />
      </DialogContent>
    </Dialog>
  )
}
