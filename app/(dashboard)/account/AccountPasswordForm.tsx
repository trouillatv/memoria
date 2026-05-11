'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { changePasswordAction } from './actions'

export function AccountPasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const tooShort = newPassword.length > 0 && newPassword.length < 8
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword
  const ready =
    currentPassword.length > 0 && newPassword.length >= 8 && confirmPassword === newPassword

  const handleSubmit = () => {
    setError(null)
    startTransition(async () => {
      const result = await changePasswordAction({
        current_password: currentPassword,
        new_password: newPassword,
      })
      if (result.ok) {
        toast.success('Mot de passe modifié.')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setError(result.error ?? 'Échec.')
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
        <Label htmlFor="current_password">Mot de passe actuel</Label>
        <Input
          id="current_password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="new_password">Nouveau mot de passe</Label>
        <Input
          id="new_password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
        {tooShort && <p className="text-xs text-rose-600">Au moins 8 caractères.</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm_password">Confirmer le nouveau mot de passe</Label>
        <Input
          id="confirm_password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        {mismatch && (
          <p className="text-xs text-rose-600">Les mots de passe ne correspondent pas.</p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={!ready || isPending}>
          {isPending ? 'Modification…' : 'Modifier le mot de passe'}
        </Button>
      </div>
    </form>
  )
}
