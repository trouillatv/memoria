// Slice C.2 — loading.tsx /preuves : mime header + filters bar + liste.
//
// Doctrine : skeleton sobre, pulse muted. La structure reflète exactement
// /preuves/page.tsx pour éviter le saut visuel au render final.

import {
  SkeletonFiltersBar,
  SkeletonList,
  SkeletonPageHeader,
} from '@/components/ui/skeleton-patterns'

export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <SkeletonPageHeader />
      <SkeletonFiltersBar />
      <SkeletonList count={6} />
    </div>
  )
}
