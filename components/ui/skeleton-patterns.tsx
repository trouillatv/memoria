// Slice C.2 — Patterns de skeletons réutilisables pour les loading.tsx.
//
// Doctrine : chaque pattern mime la structure d'un élément récurrent de
// l'app (header de page, bar de filtres, liste de rows, grid de cards,
// grid de photos). Composables dans n'importe quel loading.tsx.

import { Card, CardContent, CardHeader } from './card'
import { Skeleton } from './skeleton'

/** Bandeau titre + sous-titre — taille H1 + p. */
export function SkeletonPageHeader() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  )
}

/** Bandeau filtres : search input large + 3 selects compacts. */
export function SkeletonFiltersBar() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-9 w-40" />
    </div>
  )
}

/** Liste de N rows façon Card + divider — mime /preuves, /missions. */
export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {Array.from({ length: count }).map((_, i) => (
            <li
              key={i}
              className="px-6 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-72 max-w-full" />
              </div>
              <Skeleton className="h-4 w-20 shrink-0" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Grid responsive de N cards — mime /dashboard. */
export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-48 mt-2" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-3/4" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** Grid de photos carrées — mime /preuves/[id] photos. */
export function SkeletonPhotoGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-md" />
      ))}
    </div>
  )
}
