// Slice C.2 — loading.tsx /preuves/[id] : mime back link + header + meta band
// 4 stats + photos grid + sections.
//
// Doctrine : skeleton sobre, pulse muted. Le skeleton parle de lui-même.

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SkeletonPhotoGrid } from '@/components/ui/skeleton-patterns'

export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back link */}
      <Skeleton className="h-4 w-48" />

      {/* Header titre + meta inline */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Meta band : 4 stats */}
      <Card>
        <CardContent className="py-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <SkeletonPhotoGrid count={8} />
        </CardContent>
      </Card>

      {/* Validations */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    </div>
  )
}
