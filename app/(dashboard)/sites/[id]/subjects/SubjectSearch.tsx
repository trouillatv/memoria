'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'

/** Barre de recherche par sujet (Build A) — met le terme dans l'URL (?q=). */
export function SubjectSearch({ siteId, initial }: { siteId: string; initial: string }) {
  const router = useRouter()
  const [q, setQ] = useState(initial)

  const go = (value: string) => {
    const v = value.trim()
    router.push(v ? `/sites/${siteId}/subjects?q=${encodeURIComponent(v)}` : `/sites/${siteId}/subjects`)
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go(q) }}
          placeholder="Rechercher un sujet (DOE, enrobés, parking…)"
          className="w-full rounded-lg border bg-background py-2 pl-8 pr-8 text-sm"
        />
        {q && (
          <button type="button" onClick={() => { setQ(''); go('') }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Effacer">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <button type="button" onClick={() => go(q)}
        className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40">Rechercher</button>
    </div>
  )
}
