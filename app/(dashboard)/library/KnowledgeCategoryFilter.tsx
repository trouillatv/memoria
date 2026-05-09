'use client'

import { Badge } from '@/components/ui/badge'
import { useRouter, useSearchParams } from 'next/navigation'
import type { KnowledgeCategory } from '@/types/db'

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  references_clients: 'Références clients',
  moyens_humains:     'Moyens humains',
  materiel:           'Matériel',
  procedures:         'Procédures',
  qualite:            'Qualité',
  anciens_memoires:   'Anciens mémoires',
}

export function KnowledgeCategoryFilter() {
  const router = useRouter()
  const params = useSearchParams()
  const current = params.get('category') as KnowledgeCategory | null

  function setCategory(c: KnowledgeCategory | null) {
    const next = new URLSearchParams(params.toString())
    if (c === null || c === current) next.delete('category')
    else next.set('category', c)
    router.push(`/library${next.toString() ? '?' + next.toString() : ''}`)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Badge
        variant={current === null ? 'default' : 'outline'}
        className="cursor-pointer"
        onClick={() => setCategory(null)}
      >
        Toutes
      </Badge>
      {(Object.keys(CATEGORY_LABELS) as KnowledgeCategory[]).map((k) => (
        <Badge
          key={k}
          variant={current === k ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setCategory(k)}
        >
          {CATEGORY_LABELS[k]}
        </Badge>
      ))}
    </div>
  )
}
