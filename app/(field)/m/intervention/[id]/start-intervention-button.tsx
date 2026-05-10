'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { startInterventionMobileAction } from './actions'

export function StartInterventionButton({ interventionId }: { interventionId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    const fd = new FormData()
    fd.set('id', interventionId)
    startTransition(async () => {
      const r = await startInterventionMobileAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background text-base font-medium px-4 py-4 active:bg-foreground/90 disabled:opacity-50 transition-colors"
      style={{ minHeight: 64 }}
    >
      <Play className="h-5 w-5" />
      {pending ? 'Démarrage...' : "Commencer l'intervention"}
    </button>
  )
}
