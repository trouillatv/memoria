'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play, ClipboardCheck } from 'lucide-react'
import { toast } from 'sonner'
import { startInterventionMobileAction } from './actions'

export function StartInterventionButton({
  interventionId,
  label,
  controlMode = false,
}: {
  interventionId: string
  /** Libellé alternatif (ex. « Contrôler et clôturer » après validation externe). */
  label?: string
  /** Icône de contrôle plutôt que « lecture » quand on contrôle un travail externe. */
  controlMode?: boolean
}) {
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

  const Icon = controlMode ? ClipboardCheck : Play

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background text-base font-medium px-4 py-4 active:bg-foreground/90 active:scale-[0.99] disabled:opacity-50 transition-[transform,background-color]"
      style={{ minHeight: 64 }}
    >
      <Icon className="h-5 w-5" />
      {pending ? 'Ouverture…' : (label ?? "Commencer l'intervention")}
    </button>
  )
}
