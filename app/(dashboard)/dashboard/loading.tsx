// Slice C.2 — loading.tsx /dashboard : mime header + sections de cards.
//
// Doctrine : skeleton sobre, pulse muted. /dashboard a typiquement 2-3
// sections (attention / progression / inactifs).

import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonCardGrid } from '@/components/ui/skeleton-patterns'

export default function Loading() {
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="space-y-1">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* Section 1 — attention */}
      <section className="space-y-3">
        <Skeleton className="h-4 w-64" />
        <SkeletonCardGrid count={3} />
      </section>

      {/* Section 2 — en bonne progression */}
      <section className="space-y-3">
        <Skeleton className="h-4 w-64" />
        <SkeletonCardGrid count={3} />
      </section>
    </div>
  )
}
