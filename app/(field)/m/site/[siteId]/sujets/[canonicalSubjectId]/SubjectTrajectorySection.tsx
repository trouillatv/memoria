import { generateSubjectTrajectory } from '@/services/ai/canonical-subject-trajectory'
import type { CanonicalSubjectLife } from '@/lib/db/canonical-subject-life'

export function SubjectTrajectorySkeleton() {
  return (
    <section className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
      <div className="mb-2 h-2 w-28 rounded bg-muted animate-pulse" />
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-muted animate-pulse" />
        <div className="h-3 w-4/5 rounded bg-muted animate-pulse" />
        <div className="h-3 w-3/5 rounded bg-muted animate-pulse" />
      </div>
    </section>
  )
}

export async function SubjectTrajectorySection({ life }: { life: CanonicalSubjectLife }) {
  const result = await generateSubjectTrajectory(life, null).catch(() => null)
  if (!result || !result.trajectory) return null

  return (
    <section className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Ce qui s'est passé
      </h2>
      {result.headline && (
        <p className="mb-1 text-[13px] font-semibold leading-snug">{result.headline}</p>
      )}
      <p className="text-[13px] leading-relaxed text-foreground/80">{result.trajectory}</p>
    </section>
  )
}
