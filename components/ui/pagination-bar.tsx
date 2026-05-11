'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

interface PaginationBarProps {
  /** Page courante, 1-indexée. */
  page: number
  /** Nombre d'éléments par page. */
  pageSize: number
  /** Nombre total d'éléments. */
  total: number
  className?: string
}

/**
 * Pagination simple prev/next avec indicateur « Page X / Y ».
 * Synchronise la page courante via le searchParam `page`.
 * Si la pagination est inutile (totalPages <= 1), ne rend rien.
 */
export function PaginationBar({ page, pageSize, total, className }: PaginationBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))

  if (totalPages <= 1) return null

  function go(next: number) {
    const clamped = Math.max(1, Math.min(totalPages, next))
    const sp = new URLSearchParams(params.toString())
    if (clamped === 1) sp.delete('page')
    else sp.set('page', String(clamped))
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div
      data-slot="pagination-bar"
      className={cn('flex items-center justify-between gap-3', className)}
    >
      <span className="text-xs text-muted-foreground" data-testid="pagination-indicator">
        Page {page} sur {totalPages} ({total} élément{total > 1 ? 's' : ''})
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          data-testid="pagination-prev"
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Précédent
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => go(page + 1)}
          data-testid="pagination-next"
        >
          Suivant <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  )
}
