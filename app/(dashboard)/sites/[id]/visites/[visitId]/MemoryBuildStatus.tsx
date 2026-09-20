// Widget de construction mémoire historique.
//
// Source de vérité unique : statut end-to-end du post-processing importé
// (matérialisation -> Canonical -> similarité -> CBO -> Live Writer -> NeedsYou).

import Link from 'next/link'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPendingSuggestionCount } from '@/lib/subjects/similarity-analyze'
import { loadHistoricalMemoryUpdateStatus } from '@/lib/subjects/historical-memory-update-status'
import { MemoryBuildRetryButton } from './MemoryBuildRetryButton'

export async function MemoryBuildStatus({
  siteId,
  siteReportId,
  runId,
}: {
  siteId: string
  siteReportId: string
  runId: string
}) {
  const status = await loadHistoricalMemoryUpdateStatus(siteReportId, runId)
  if (!status) return null

  if (status.state === 'interrupted') {
    return (
      <section className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-[13px] dark:border-rose-900 dark:bg-rose-950/30">
        <p className="font-medium text-rose-700 dark:text-rose-300">
          Mise à jour de la mémoire interrompue
        </p>
        <MemoryBuildRetryButton siteReportId={siteReportId} />
      </section>
    )
  }

  if (status.state === 'updating') {
    return (
      <section className="rounded-xl border px-4 py-3 text-[13px]">
        <p className="font-medium">MemorIA met à jour la mémoire du chantier</p>
        <ul className="mt-2 space-y-1.5 text-muted-foreground">
          {status.steps.map((step) => (
            <li key={step.key} className="flex items-center gap-1.5">
              {step.status === 'done' ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : step.status === 'current' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {step.label}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  const admin = createAdminClient()
  const pendingCount = await getPendingSuggestionCount(admin, siteId)

  if (pendingCount > 0) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-[13px] dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Mémoire à jour — {status.subjectCount} sujets métier analysés · {pendingCount} rapprochement{pendingCount > 1 ? 's' : ''} à examiner
        </p>
        <Link
          href={`/sites/${siteId}/historique`}
          className="shrink-0 rounded-lg border px-3 py-1.5 text-[12px] font-medium hover:bg-muted"
        >
          Examiner
        </Link>
      </section>
    )
  }

  return (
    <section className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-[13px] text-muted-foreground dark:border-emerald-900/50 dark:bg-emerald-950/20">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      Mémoire à jour — Aucun rapprochement à examiner
    </section>
  )
}
