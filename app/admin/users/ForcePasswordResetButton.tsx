'use client'

import { Button } from '@/components/ui/button'
import { forcePasswordResetAction } from './actions'
import { toast } from 'sonner'

export function ForcePasswordResetButton({ userId, isAdminUser }: { userId: string; isAdminUser: boolean }) {
  if (isAdminUser) {
    return <Button size="sm" variant="ghost" disabled title="Reset admin via Supabase Studio">🔒</Button>
  }
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        if (!confirm('Réinitialiser le mot de passe de cet utilisateur ?')) return
        const fd = new FormData()
        fd.set('userId', userId)
        const r = await forcePasswordResetAction(fd)
        if (r?.error) toast.error(r.error)
        else toast.success('Mot de passe réinitialisé')
      }}
    >
      Reset
    </Button>
  )
}
