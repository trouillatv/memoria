'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { changeUserRoleAction } from './actions'
import { toast } from 'sonner'
import type { UserRole } from '@/types/db'

export function UserRoleSelect({ userId, currentRole }: { userId: string; currentRole: UserRole }) {
  return (
    <Select
      defaultValue={currentRole}
      onValueChange={async (newRole) => {
        if (newRole === currentRole) return
        const fd = new FormData()
        fd.set('userId', userId)
        fd.set('role', newRole as string)
        const r = await changeUserRoleAction(fd)
        if (r?.error) toast.error(r.error)
        else toast.success('Rôle mis à jour')
      }}
    >
      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="manager">Manager</SelectItem>
        <SelectItem value="chef_equipe">Chef d&apos;équipe</SelectItem>
      </SelectContent>
    </Select>
  )
}
