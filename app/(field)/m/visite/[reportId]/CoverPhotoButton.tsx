'use client'

// Choisir une photo comme couverture du chantier (mig 243). Toggle : re-cliquer
// sur la photo courante la retire. Non bloquant, feedback immédiat par toast.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Star } from 'lucide-react'
import { setSiteCoverAction } from '@/app/(field)/m/site/[siteId]/cover-actions'

export function CoverPhotoButton({
  siteId,
  captureId,
  isCover,
}: {
  siteId: string
  captureId: string
  isCover: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // État optimiste local : la coche répond au doigt, la revalidation confirme.
  const [active, setActive] = useState(isCover)

  function toggle() {
    const next = !active
    setActive(next)
    startTransition(async () => {
      const r = await setSiteCoverAction({ siteId, captureId: next ? captureId : null })
      if (!r.ok) {
        setActive(!next)
        toast.error(r.error)
        return
      }
      toast.success(next ? 'Photo principale du chantier définie.' : 'Photo principale retirée.')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 ${
        active
          ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300'
          : 'border-border bg-background text-muted-foreground active:bg-accent'
      }`}
    >
      <Star className={`h-3.5 w-3.5 ${active ? 'fill-amber-500 text-amber-500' : ''}`} />
      {active ? 'Photo du chantier' : 'Définir comme photo du chantier'}
    </button>
  )
}
