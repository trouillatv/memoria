'use client'

import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { acceptInviteAction } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending} className="w-full">{pending ? 'Validation…' : 'Définir mon mot de passe'}</Button>
}

export function AcceptInviteForm() {
  const [error, setError] = useState<string | null>(null)
  async function action(fd: FormData) {
    setError(null)
    const r = await acceptInviteAction(fd)
    if (r?.error) setError(r.error)
  }
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input id="password" name="password" type="password" required minLength={8} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton />
    </form>
  )
}
