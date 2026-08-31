// Skeleton LOCAL au contenu du chantier : il ne remplace QUE le panneau sous les
// pills. Le nom du chantier et la barre de pills (rendus par le layout) restent
// montés et visibles pendant le chargement — c'est la règle UX du lot.

import { Skeleton } from '@/components/ui/skeleton'

export default function ChantierContentLoading() {
  return (
    <div className="mx-auto max-w-md space-y-3 px-4 pb-16 pt-2">
      <Skeleton className="h-6 w-40" />
      <ul className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="rounded-xl border bg-card p-4 space-y-2" style={{ minHeight: 72 }}>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </li>
        ))}
      </ul>
    </div>
  )
}
