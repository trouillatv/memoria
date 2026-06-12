'use client'

import { useRouter } from 'next/navigation'
import { useRef, useTransition } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function SearchBar({ defaultValue = '' }: { defaultValue?: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const q = inputRef.current?.value.trim() ?? ''
    startTransition(() => {
      if (q.length < 2) {
        router.push('/recherche')
      } else {
        router.push(`/recherche?q=${encodeURIComponent(q)}`)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      {isPending ? (
        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin pointer-events-none" />
      ) : (
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      )}
      <input
        ref={inputRef}
        type="search"
        name="q"
        defaultValue={defaultValue}
        autoFocus
        autoComplete="off"
        placeholder="Rechercher une note, une mission, un sous-traitant..."
        className={cn(
          'w-full rounded-lg border bg-background pl-9 pr-4 py-2.5 text-sm',
          'placeholder:text-muted-foreground/60',
          'focus:outline-none focus:ring-2 focus:ring-ring',
          isPending && 'opacity-60',
        )}
      />
      <button type="submit" className="sr-only">
        Rechercher
      </button>
    </form>
  )
}
