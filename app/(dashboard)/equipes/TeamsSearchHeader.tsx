'use client'

// /EQUIPES V2 — CORRECTIF UX FINAL (2026-10-01) — en-tête « Mes équipes (N) »
// + recherche + filtre « Sans référent » au-dessus de la table TeamsTable
// (Server Component asynchrone, jamais converti en client ni dupliqué ici).
// Le filtrage pilote les query params `q`/`teamFilter` de l'URL — page.tsx
// filtre `teams` côté serveur avant de les passer à TeamsTable. Jamais de
// sélecteur CSS/DOM généré côté client : URL partageable, pas de requête
// détail pour les équipes masquées, accessibilité native d'un lien.

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function TeamsSearchHeader({
  count,
  initialQuery,
  initialFilter,
}: {
  count: number
  initialQuery: string
  initialFilter: 'all' | 'without-referent'
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(initialQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resynchronise le champ si l'utilisateur navigue (retour arrière, lien
  // direct) sans passer par cette saisie.
  useEffect(() => setQuery(initialQuery), [initialQuery])

  function pushParams(nextQuery: string, nextFilter: 'all' | 'without-referent') {
    const params = new URLSearchParams(searchParams.toString())
    if (nextQuery) params.set('q', nextQuery)
    else params.delete('q')
    if (nextFilter === 'without-referent') params.set('teamFilter', 'without-referent')
    else params.delete('teamFilter')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function onQueryChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => pushParams(value, initialFilter), 300)
  }

  function toggleFilter() {
    pushParams(query, initialFilter === 'without-referent' ? 'all' : 'without-referent')
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-sm font-medium text-muted-foreground">Mes équipes ({count})</h2>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Chercher une équipe…"
            className="h-8 w-48 pl-8 text-sm"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant={initialFilter === 'without-referent' ? 'default' : 'outline'}
          className="h-8 text-xs"
          onClick={toggleFilter}
        >
          Sans référent
        </Button>
      </div>
    </div>
  )
}
