import Link from 'next/link'
import type { PlanningLecture } from '@/lib/planning/lecture'

export interface LecturePanelLinks {
  rotation: string
  gaps: string
  missions: string[]
}

export function LecturePanel({
  lecture,
  links,
  emptyContextLabel,
  rotationCount,
  interventionCount,
  assignmentCount,
}: {
  lecture: PlanningLecture | null
  links: LecturePanelLinks
  emptyContextLabel: string
  rotationCount: number
  interventionCount: number
  assignmentCount: number
}) {
  if (!lecture) {
    return (
      <aside className="rounded-lg border-l-2 border-reading-border bg-card px-5 py-5">
        <h2 className="text-base font-semibold text-foreground">Lecture</h2>
        <p className="mt-1 text-xs text-muted-foreground">{emptyContextLabel}</p>
        <p className="mt-6 text-xl font-semibold tracking-tight text-foreground">
          {rotationCount > 0
            ? 'Aucun point ne nécessite votre attention.'
            : 'Aucun roulement à lire pour cette période.'}
        </p>
        <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
          <li>• {rotationCount} roulement{rotationCount > 1 ? 's' : ''} couvre{rotationCount > 1 ? 'nt' : ''} la période</li>
          <li>• aucune rupture d’affectation détectée</li>
          <li>• {interventionCount} intervention{interventionCount > 1 ? 's' : ''} prise{interventionCount > 1 ? 's' : ''} en compte</li>
        </ul>
        <p className="mt-7 text-xs font-medium text-muted-foreground">Construit à partir de</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">{rotationCount} roulement{rotationCount > 1 ? 's' : ''}</span>
          <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">{interventionCount} intervention{interventionCount > 1 ? 's' : ''}</span>
          <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">{assignmentCount} affectation{assignmentCount > 1 ? 's' : ''}</span>
        </div>
        <p className="mt-7 border-t pt-3 text-xs text-muted-foreground">
          Lecture construite à partir des faits du planning.
        </p>
      </aside>
    )
  }

  const { primary, evidence } = lecture
  const gapLabel = `${primary.gapCount} jour${primary.gapCount > 1 ? 's' : ''} sans équipe`
  const missionLabel = `${primary.missionCount} chantier${primary.missionCount > 1 ? 's' : ''} concerné${primary.missionCount > 1 ? 's' : ''}`
  const missionEvidenceLabel = `${evidence.missions} mission${evidence.missions > 1 ? 's' : ''}`
  const assignmentEvidenceLabel = `${evidence.assignments} affectation${evidence.assignments > 1 ? 's' : ''}`

  return (
    <aside className="rounded-lg border-l-2 border-reading-border bg-card px-5 py-5">
      <h2 className="text-base font-semibold text-foreground">Lecture</h2>
      <p className="mt-1 text-xs text-muted-foreground">{lecture.contextLabel}</p>

      <p className="mt-6 text-xl font-semibold tracking-tight text-foreground">
        {lecture.headline}
      </p>
      <p className="mt-5 text-sm font-semibold text-foreground">Parce que…</p>

      <div className="relative mt-3 space-y-2 pl-8 before:absolute before:bottom-3 before:left-3 before:top-3 before:border-l before:border-border">
        <Link
          href={links.rotation}
          aria-label={primary.sourceLabel}
          className="relative flex items-center gap-2 py-1 text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="absolute -left-8 flex h-6 w-6 items-center justify-center rounded-full border bg-card text-[10px] font-semibold text-primary">
            1
          </span>
          <span>
            {primary.sourceLabel}
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              {primary.endsOn ? `se termine le ${primary.endsOn}` : 'roulement actif'}
            </span>
          </span>
        </Link>

        <Link
          href={links.gaps}
          aria-label={gapLabel}
          className="relative flex items-center gap-2 py-1 text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="absolute -left-8 flex h-6 w-6 items-center justify-center rounded-full border bg-card text-[10px] font-semibold text-primary">
            2
          </span>
          <span>
            {gapLabel}
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              dont le {primary.gapDates[0]?.slice(-2) ?? 'jour'}
            </span>
          </span>
        </Link>

        <Link
          href={links.missions[0] ?? links.gaps}
          aria-label={missionLabel}
          className="relative flex items-center gap-2 py-1 text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="absolute -left-8 flex h-6 w-6 items-center justify-center rounded-full border bg-card text-[10px] font-semibold text-primary">
            3
          </span>
          <span>
            {missionLabel}
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              couverture issue du planning
            </span>
          </span>
        </Link>
      </div>

      <p className="mt-5 text-xs font-medium text-muted-foreground">Construit à partir de</p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
          1 roulement
        </span>
        <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
          {missionEvidenceLabel}
        </span>
        <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
          {assignmentEvidenceLabel}
        </span>
      </div>

      <Link
        href={links.rotation}
        className="mt-5 block border-t pt-3 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Voir la fiche du {primary.sourceLabel} →
      </Link>
    </aside>
  )
}
