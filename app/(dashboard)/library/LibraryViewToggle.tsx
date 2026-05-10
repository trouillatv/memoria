'use client'

import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KnowledgeItemCard } from './KnowledgeItemCard'
import { KnowledgeItemTable } from './KnowledgeItemTable'
import { EmptyStateLibrary } from './EmptyStateLibrary'
import { useViewMode } from './useViewMode'
import type { DbKnowledgeItem } from '@/types/db'

interface Props {
  items: DbKnowledgeItem[]
  usageCounts: Record<string, number>  // serialized Map
}

export function LibraryViewToggle({ items, usageCounts }: Props) {
  const [mode, setMode] = useViewMode('cards')
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'cards' ? 'default' : 'outline'}
          onClick={() => setMode('cards')}
          className="h-7 px-2"
        >
          <LayoutGrid className="h-3 w-3 mr-1" />
          Cards
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'list' ? 'default' : 'outline'}
          onClick={() => setMode('list')}
          className="h-7 px-2"
        >
          <List className="h-3 w-3 mr-1" />
          Liste
        </Button>
      </div>

      {mode === 'cards' ? (
        items.length === 0 ? (
          <EmptyStateLibrary />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((item) => (
              <KnowledgeItemCard key={item.id} item={item} citationCount={usageCounts[item.id] ?? 0} />
            ))}
          </div>
        )
      ) : (
        <KnowledgeItemTable items={items} />
      )}
    </div>
  )
}
