'use client'

import { Button } from '@/components/ui/button'
import { deleteUserAction } from './actions'
import { toast } from 'sonner'

export function DeleteUserButton({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  if (isSelf) {
    return <Button size="sm" variant="ghost" disabled>—</Button>
  }
  return (
    <Button
      size="sm"
      variant="destructive"
      onClick={async () => {
        if (!confirm('Supprimer cet utilisateur ?')) return
        const fd = new FormData()
        fd.set('userId', userId)
        const r = await deleteUserAction(fd)
        if (r?.error) toast.error(r.error)
        else toast.success('Utilisateur supprimé')
      }}
    >
      Supprimer
    </Button>
  )
}
