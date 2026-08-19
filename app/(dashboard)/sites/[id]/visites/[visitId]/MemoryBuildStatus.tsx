// Widget "construction de la mémoire" — P1-A, lot UI final (2026-08-20).
//
// Background + statut temporaire + CTA quand une décision humaine est
// nécessaire : rien de plus. Pas de page "Automatisation" dédiée, pas de
// détail technique visible (l'erreur brute reste réservée aux logs/admin).

import Link from 'next/link'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPendingSuggestionCount } from '@/lib/subjects/similarity-analyze'
import { MemoryBuildRetryButton } from './MemoryBuildRetryButton'

export async function MemoryBuildStatus({
  siteId,
  siteReportId,
  startedAt,
  completedAt,
  error,
  subjectCount,
}: {
  siteId: string
  siteReportId: string
  startedAt: string | null
  completedAt: string | null
  error: string | null
  subjectCount: number | null
}) {
  // Jamais déclenché (visite historique antérieure à ce lot) : rien à montrer.
  if (!startedAt) return null

  if (error) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-[13px] dark:border-rose-900 dark:bg-rose-950/30">
        <p className="font-medium text-rose-700 dark:text-rose-300">
          La mémoire du chantier n&apos;a pas pu être finalisée
        </p>
        <MemoryBuildRetryButton siteReportId={siteReportId} />
      </section>
    )
  }

  if (!completedAt) {
    return (
      <section className="rounded-xl border px-4 py-3 text-[13px]">
        <p className="font-medium">MemorIA construit la mémoire du chantier</p>
        <ul className="mt-2 space-y-1.5 text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            PV analysés
          </li>
          <li className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Sujets et lignes de vie mis à jour
          </li>
          <li className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
            Recherche de rapprochements
          </li>
          <li className="flex items-center gap-1.5">
            <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Finalisation
          </li>
        </ul>
      </section>
    )
  }

  const admin = createAdminClient()
  const pendingCount = await getPendingSuggestionCount(admin, siteId)

  if (pendingCount > 0) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-[13px]">
        <p>
          Mémoire à jour — {subjectCount ?? 0} sujets métier analysés · {pendingCount} rapprochement{pendingCount > 1 ? 's' : ''} à examiner
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
    <section className="rounded-xl border px-4 py-3 text-[13px] text-muted-foreground">
      Mémoire à jour — Aucun rapprochement à examiner
    </section>
  )
}
