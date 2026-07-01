'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateHomePreferenceAction } from '@/app/(dashboard)/account/actions'

/**
 * Échappatoire bureau depuis le terrain. Bascule aussi la préférence d'accueil
 * (`home_preference`) sur `dashboard` : cliquer « Vue bureau » vaut choisir le
 * bureau comme surface par défaut, donc le toggle du menu compte reste aligné.
 * Best-effort : on navigue même si la persistance échoue (jamais coincé sur /m).
 */
export function SwitchToDesktopLink() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      await updateHomePreferenceAction('dashboard')
      router.push('/dashboard')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {pending ? 'Ouverture...' : 'Vue bureau'}
    </button>
  )
}
