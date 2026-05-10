'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { logoutAction } from './actions'

export function LogoutButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleLogout() {
    startTransition(async () => {
      await logoutAction()
      router.push('/login')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
    >
      {pending ? 'Déconnexion...' : 'Se déconnecter'}
    </button>
  )
}
