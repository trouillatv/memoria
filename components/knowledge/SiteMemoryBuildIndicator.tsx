// Sous-lot 4, stabilisation UX Points/Suivi (mandat Vincent 2026-09-17).
// Habillage compact, jargon-free, du signal `SiteMemoryBuildStatus`
// (lib/db/site-reports.ts) — réutilisé sur les en-têtes Suivi/Points et sur
// la liste « Chantiers à surveiller » d'Aujourd'hui. Ne rend rien tant que
// rien n'est en cours ni en échec (jamais une bannière permanente).

import { AlertTriangle, Loader2 } from 'lucide-react'
import { MemoryBuildRetryButton } from '@/app/(dashboard)/sites/[id]/visites/[visitId]/MemoryBuildRetryButton'
import type { SiteMemoryBuildStatus } from '@/lib/db/site-reports'
import { cn } from '@/lib/utils'

export function SiteMemoryBuildIndicator({
  status,
  className,
}: {
  status: SiteMemoryBuildStatus
  className?: string
}) {
  if (status.hasError) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-[12px] font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
          className,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        La mémoire du chantier n&apos;a pas pu être finalisée
        {status.siteReportId && <MemoryBuildRetryButton siteReportId={status.siteReportId} />}
      </div>
    )
  }

  if (status.isProcessing) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] text-muted-foreground',
          className,
        )}
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        MemorIA met à jour la mémoire du chantier
      </div>
    )
  }

  return null
}
