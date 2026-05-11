'use client'

import { useTransition } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logoutAction } from './actions'

export function AccountLogoutSection() {
  const [isPending, startTransition] = useTransition()

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Vous serez redirigé vers la page de connexion.
      </p>
      <div>
        <Button variant="outline" onClick={handleLogout} disabled={isPending}>
          <LogOut className="h-4 w-4 mr-2" />
          {isPending ? 'Déconnexion…' : 'Se déconnecter'}
        </Button>
      </div>
    </div>
  )
}
