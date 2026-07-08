'use client'

// « Reprendre cette visite » — une visite n'est JAMAIS figée. Erreur, oubli,
// interruption → on rouvre exactement dans l'état où on en était (captures +
// tags intacts), et le panier terrain se rouvre pour continuer.

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { reopenVisitAction } from '@/app/(field)/m/site/[siteId]/visit-actions'

export function ReopenVisitButton({ reportId, siteId }: { reportId: string; siteId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function reopen() {
    start(async () => {
      const r = await reopenVisitAction({ report_id: reportId, site_id: siteId })
      if (r.ok) {
        toast.success('Visite reprise — vous pouvez continuer', { duration: 1500 })
        // `?live=<id>` : URL neuve (pas de cockpit en cache) + ouverture directe du
        // panier par id — la visite reprise s'ouvre bien en collecte, pas en fiche.
        router.push(`/m/site/${siteId}?live=${reportId}`)
      } else {
        toast.error(r.error)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={reopen}
      disabled={pending}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-background disabled:opacity-50"
    >
      <Pencil className="h-4 w-4" /> Reprendre cette visite
    </button>
  )
}
