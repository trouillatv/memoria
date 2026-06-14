// Slice C.2 — loading.tsx /missions : mime header + filters + list.
//
// Doctrine : skeleton sobre, pulse muted. Le skeleton parle de lui-même.

import {
  SkeletonFiltersBar,
  SkeletonList,
  SkeletonPageHeader,
} from '@/components/ui/skeleton-patterns'

export default function Loading() {
  return (
    <div className="space-y-6 max-w-4xl">
      <SkeletonPageHeader />
      <SkeletonFiltersBar />
      <SkeletonList count={8} />
    </div>
  )
}
