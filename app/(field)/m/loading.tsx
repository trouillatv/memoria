// Slice C.2 — loading.tsx /m (mobile) : mime header + cards interventions.
//
// La page /m fait tourner ensureTodayInterventionsForSites avant le rendu
// (potentiellement >300ms). Un skeleton calme évite le "clignote blanc"
// sur smartphone de chef d'équipe.

import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6 max-w-md">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Mission cards */}
      <ul className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <li
            key={i}
            className="rounded-xl border bg-card p-4 space-y-2"
            style={{ minHeight: 96 }}
          >
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-16 rounded-full shrink-0" />
            </div>
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </li>
        ))}
      </ul>
    </div>
  )
}
