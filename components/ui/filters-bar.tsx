'use client'

import { ReactNode, useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Input } from './input'
import { Button } from './button'
import { cn } from '@/lib/utils'

interface FiltersBarProps {
  /** Placeholder du champ search. */
  searchPlaceholder?: string
  /** Nom du searchParam pour la recherche (default 'search'). */
  searchParam?: string
  /** Délai de debounce avant push URL (default 300ms). */
  debounceMs?: number
  /** Slot pour insérer des dropdowns / filtres additionnels. */
  children?: ReactNode
  /** Si true, affiche le bouton « Réinitialiser ». */
  hasActiveFilters?: boolean
  /**
   * Liste des searchParams à effacer lors du Reset.
   * Si non fourni, tous les searchParams sont effacés.
   */
  resetParams?: string[]
  /** Désactiver le champ recherche (pour les cas où seuls les dropdowns sont nécessaires). */
  hideSearch?: boolean
  className?: string
}

/**
 * Container réutilisable pour les barres de filtres :
 *   - Search input debounced (300ms par défaut) qui synchronise un searchParam URL.
 *   - Slot enfants pour ajouter des <FilterSelect /> ou autres dropdowns.
 *   - Bouton « Réinitialiser » visible si des filtres sont actifs.
 *
 * Tous les filtres sont URL-based pour permettre le link sharing.
 * Toute modification reset également la pagination (param `page`).
 */
export function FiltersBar({
  searchPlaceholder = 'Rechercher…',
  searchParam = 'search',
  debounceMs = 300,
  children,
  hasActiveFilters = false,
  resetParams,
  hideSearch = false,
  className,
}: FiltersBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  // Local state for the search input (so typing is responsive)
  const initialSearch = params.get(searchParam) ?? ''
  const [localSearch, setLocalSearch] = useState(initialSearch)
  // Track previous URL value to detect external resets
  const lastUrlSearchRef = useRef(initialSearch)

  // If URL changes externally (e.g. via Reset), reflect it in the local input.
  useEffect(() => {
    const urlValue = params.get(searchParam) ?? ''
    if (urlValue !== lastUrlSearchRef.current) {
      lastUrlSearchRef.current = urlValue
      setLocalSearch(urlValue)
    }
  }, [params, searchParam])

  // Debounce push to URL whenever local search changes.
  useEffect(() => {
    if (hideSearch) return
    const current = params.get(searchParam) ?? ''
    if (localSearch === current) return
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (localSearch) next.set(searchParam, localSearch)
      else next.delete(searchParam)
      next.delete('page')
      lastUrlSearchRef.current = localSearch
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`)
      })
    }, debounceMs)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch, debounceMs, hideSearch])

  function handleReset() {
    const next = new URLSearchParams(params.toString())
    if (resetParams && resetParams.length > 0) {
      for (const p of resetParams) next.delete(p)
    } else {
      // Default: clear all params
      for (const key of Array.from(next.keys())) next.delete(key)
    }
    // Always clear pagination on reset
    next.delete('page')
    setLocalSearch('')
    lastUrlSearchRef.current = ''
    startTransition(() => {
      const qs = next.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  return (
    <div
      data-slot="filters-bar"
      className={cn(
        'flex flex-wrap items-center gap-2 sm:gap-3',
        className,
      )}
    >
      {!hideSearch && (
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-8"
            data-testid="filters-bar-search"
          />
        </div>
      )}
      {children}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="text-muted-foreground"
          data-testid="filters-bar-reset"
        >
          <X className="h-3.5 w-3.5" />
          Réinitialiser
        </Button>
      )}
    </div>
  )
}
