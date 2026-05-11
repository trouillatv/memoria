// Slice C.2 — loading.tsx /contracts/[id] : mime header + tabs + boucle de
// preuve + liste engagements.
//
// Doctrine : skeleton sobre, pulse muted. Le skeleton parle de lui-même.

import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header : titre + statut + sous-titre */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24" />
        ))}
      </div>

      {/* Boucle de preuve visualisation (5 segments) */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 flex-1" />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Engagements list */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
