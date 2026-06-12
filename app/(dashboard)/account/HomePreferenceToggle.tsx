'use client'

import { useEffect, useState, useTransition } from 'react'
import { Check, Hammer, Monitor } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { applyHomePreferenceAndLogoutAction } from './actions'

interface Props {
  current: 'dashboard' | 'terrain'
}

export function HomePreferenceToggle({ current }: Props) {
  const [selected, setSelected] = useState(current)
  const [isPending, startTransition] = useTransition()
  const hasChange = selected !== current

  useEffect(() => {
    setSelected(current)
  }, [current])

  const apply = () => {
    if (!hasChange || isPending) return
    startTransition(async () => {
      const result = await applyHomePreferenceAndLogoutAction(selected)
      if (result.ok) {
        toast.success('Préférence appliquée. Reconnectez-vous pour ouvrir la vue choisie.')
      } else {
        toast.error('Impossible de modifier la préférence.')
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSelected('dashboard')}
          disabled={isPending}
          aria-pressed={selected === 'dashboard'}
          className={`flex-1 flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors ${
            selected === 'dashboard'
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
          onClick={() => setSelected('terrain')}
          disabled={isPending}
          aria-pressed={selected === 'terrain'}
          className={`flex-1 flex flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors ${
            selected === 'terrain'
              ? 'border-foreground bg-foreground/5 font-medium'
              : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
          }`}
        >
          <Hammer className="h-5 w-5" />
          <span>Vue terrain</span>
          <span className="text-xs font-normal text-muted-foreground">Chantiers & actions</span>
        </button>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={apply} disabled={!hasChange || isPending}>
          <Check />
          {isPending ? 'Application...' : 'Appliquer'}
        </Button>
      </div>
    </div>
  )
}
