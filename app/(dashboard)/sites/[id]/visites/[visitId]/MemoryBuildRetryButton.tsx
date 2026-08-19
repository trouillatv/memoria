'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { retryMemoryBuildAction } from '@/app/(dashboard)/documents/[id]/extraction/[runId]/review-actions'

export function MemoryBuildRetryButton({ siteReportId }: { siteReportId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    const fd = new FormData()
    fd.set('site_report_id', siteReportId)
    startTransition(async () => {
      const result = await retryMemoryBuildAction(fd)
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error ?? 'Erreur')
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-background px-3 py-1.5 text-[12px] font-medium hover:bg-rose-100/50 disabled:opacity-50 dark:border-rose-800 dark:hover:bg-rose-950/40"
      >
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
        Réessayer
      </button>
      {error && <span className="text-[12px] text-rose-600 dark:text-rose-400">{error}</span>}
    </div>
  )
}
