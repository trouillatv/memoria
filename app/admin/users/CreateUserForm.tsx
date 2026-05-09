'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createUserAction } from './actions'
import { toast } from 'sonner'

function Submit() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending}>{pending ? 'Création…' : 'Créer'}</Button>
}

export function CreateUserForm() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Créer un utilisateur</CardTitle></CardHeader>
      <CardContent>
        <form
          action={async (fd) => {
            const r = await createUserAction(fd)
            if (r?.error) toast.error(r.error)
            else toast.success('Utilisateur créé')
          }}
          className="grid gap-3 md:grid-cols-5"
        >
          <div className="md:col-span-2">
            <Label htmlFor="email" className="text-xs">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="md:col-span-1">
            <Label htmlFor="full_name" className="text-xs">Nom complet</Label>
            <Input id="full_name" name="full_name" required />
          </div>
          <div>
            <Label className="text-xs">Rôle</Label>
            <Select name="role" defaultValue="chef_equipe">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="chef_equipe">Chef d&apos;équipe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Mode</Label>
            <Select name="mode" defaultValue="invite">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="invite">Inviter par email</SelectItem>
                <SelectItem value="temp_password">Mdp temporaire</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-5 flex justify-end">
            <Submit />
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
