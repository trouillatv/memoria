'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Hammer, Monitor } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { applyHomePreferenceAction } from './actions'

interface Props {
  current: 'dashboard' | 'terrain'
}

export function HomePreferenceToggle({ current }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState(current)
  const [isPending, startTransition] = useTransition()
  const hasChange = selected !== current

  useEffect(() => {
    setSelected(current)
  }, [current])

  const apply = () => {
    if (!hasChange || isPending) return
    startTransition(async () => {
      // On enregistre, puis on OUVRE la vue choisie. Pas de déconnexion : c'est
      // la même application, vue autrement.
      const result = await applyHomePreferenceAction(selected)
      if (result.ok && result.destination) {
        router.push(result.destination)
        router.refresh()
      } else {
        toast.error('Impossible de modifier la page d’accueil.')
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
