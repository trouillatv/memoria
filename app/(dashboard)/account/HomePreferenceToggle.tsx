'use client'

import { useTransition } from 'react'
import { Monitor, Hammer } from 'lucide-react'
import { toast } from 'sonner'
import { updateHomePreferenceAction } from './actions'

interface Props {
  current: 'dashboard' | 'terrain'
}

export function HomePreferenceToggle({ current }: Props) {
  const [isPending, startTransition] = useTransition()

  const toggle = (next: 'dashboard' | 'terrain') => {
    if (next === current || isPending) return
    startTransition(async () => {
      const result = await updateHomePreferenceAction(next)
      if (result.ok) {
        toast.success(
          next === 'terrain'
            ? 'Ouverture sur la vue terrain au prochain login.'
            : 'Ouverture sur le tableau de bord au prochain login.',
        )
      } else {
        toast.error('Impossible de modifier la préférence.')
      }
    })
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => toggle('dashboard')}
        disabled={isPending}
        className={`flex-1 flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors ${
          current === 'dashboard'
            ? 'border-foreground bg-foreground/5 font-medium'
            : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
        }`}
      >
        <Monitor className="h-5 w-5" />
        <span>Tableau de bord</span>
        <span className="text-xs font-normal text-muted-foreground">Pilotage & bureau</span>
      </button>

      <button
        type="button"
        onClick={() => toggle('terrain')}
        disabled={isPending}
        className={`flex-1 flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors ${
          current === 'terrain'
            ? 'border-foreground bg-foreground/5 font-medium'
            : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
        }`}
      >
        <Hammer className="h-5 w-5" />
        <span>Vue terrain</span>
        <span className="text-xs font-normal text-muted-foreground">Chantiers & actions</span>
      </button>
    </div>
  )
}
