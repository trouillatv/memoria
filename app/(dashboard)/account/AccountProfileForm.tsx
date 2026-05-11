'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { updateProfileAction } from './actions'

interface Props {
  initialFullName: string
  email: string
  roleLabel: string
}

export function AccountProfileForm({ initialFullName, email, roleLabel }: Props) {
  const [fullName, setFullName] = useState(initialFullName)
  const [savedFullName, setSavedFullName] = useState(initialFullName)
  const [isPending, startTransition] = useTransition()

  const trimmed = fullName.trim()
  const dirty = trimmed !== savedFullName.trim()
  const valid = trimmed.length >= 2

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await updateProfileAction({ full_name: fullName })
      if (result.ok) {
        toast.success('Profil mis à jour.')
        setSavedFullName(trimmed)
      } else {
        toast.error(result.error ?? 'Échec de la mise à jour.')
      }
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Nom complet</Label>
        <Input
          id="full_name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={100}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} disabled />
        <p className="text-xs text-muted-foreground">
          L&apos;email ne peut pas être modifié depuis cette interface.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role">Rôle</Label>
        <Input id="role" value={roleLabel} disabled />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || !valid || isPending}>
          {isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  )
}
