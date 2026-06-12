'use client'

import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createOrgAction, createUserInOrgAction, assignUserToOrgAction } from './actions'
import { toast } from 'sonner'

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return <Button type="submit" size="sm" disabled={pending}>{pending ? pendingLabel : label}</Button>
}

export function CreateOrgForm() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Créer une entreprise</CardTitle></CardHeader>
      <CardContent>
        <form
          action={async (fd) => {
            const r = await createOrgAction(fd)
            if (r?.error) toast.error(r.error)
            else toast.success('Entreprise créée — espace vierge')
          }}
          className="flex items-end gap-3"
        >
          <div className="flex-1">
            <Label htmlFor="org-name" className="text-xs">Nom de l&apos;entreprise</Label>
            <Input id="org-name" name="name" required placeholder="Ex : ContraBat" />
          </div>
          <Submit label="Créer" pendingLabel="Création…" />
        </form>
      </CardContent>
    </Card>
  )
}

export function CreateUserInOrgForm({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Ajouter un utilisateur
      </Button>
    )
  }
  return (
    <form
      action={async (fd) => {
        const r = await createUserInOrgAction(fd)
        if (r?.error) toast.error(r.error)
        else { toast.success('Utilisateur créé'); setOpen(false) }
      }}
      className="mt-3 p-3 bg-muted/30 rounded-lg border grid gap-2 md:grid-cols-5"
    >
      <input type="hidden" name="org_id" value={orgId} />
      <div className="md:col-span-2">
        <Label className="text-xs">Email</Label>
        <Input name="email" type="email" required placeholder={`prenom.nom@${orgName.toLowerCase()}.nc`} />
      </div>
      <div>
        <Label className="text-xs">Nom complet</Label>
        <Input name="full_name" required />
      </div>
      <div>
        <Label className="text-xs">Rôle</Label>
        <Select name="role" defaultValue="manager">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="chef_equipe">Chef d&apos;équipe</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Mode</Label>
        <Select name="mode" defaultValue="temp_password">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="temp_password">Mdp temporaire (memoria2026)</SelectItem>
            <SelectItem value="invite">Invitation email</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Annuler</Button>
        <Submit label="Créer" pendingLabel="Création…" />
      </div>
    </form>
  )
}

export function MoveUserOrgForm({
  userId,
  currentOrgId,
  orgs,
}: {
  userId: string
  currentOrgId: string | null
  orgs: Array<{ id: string; name: string }>
}) {
  const [orgId, setOrgId] = useState(currentOrgId ?? '')
  return (
    <form
      action={async (fd) => {
        const r = await assignUserToOrgAction(fd)
        if (r?.error) toast.error(r.error)
        else toast.success('Entreprise mise à jour')
      }}
      className="flex items-center gap-1"
    >
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="org_id" value={orgId} />
      <Select value={orgId} onValueChange={(v) => setOrgId(v ?? '')}>
        <SelectTrigger className="h-7 text-xs w-36">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">OK</Button>
    </form>
  )
}
