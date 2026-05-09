'use client'

import { Badge } from '@/components/ui/badge'
import { useRouter, useSearchParams } from 'next/navigation'

export function KnowledgeTagsFilter({ allTags }: { allTags: string[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const current = (params.get('tags') ?? '').split(',').filter(Boolean)

  function toggle(t: string) {
    const next = new URLSearchParams(params.toString())
    const set = new Set(current)
    if (set.has(t)) set.delete(t)
    else set.add(t)
    if (set.size === 0) next.delete('tags')
    else next.set('tags', Array.from(set).join(','))
    router.push(`/library${next.toString() ? '?' + next.toString() : ''}`)
  }

  if (allTags.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      <span className="text-xs text-muted-foreground self-center mr-1">Tags :</span>
      {allTags.map((t) => (
        <Badge
          key={t}
          variant={current.includes(t) ? 'default' : 'outline'}
          className="cursor-pointer text-xs"
          onClick={() => toggle(t)}
        >
          {t}
        </Badge>
      ))}
    </div>
  )
}
