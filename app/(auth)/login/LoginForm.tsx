'use client'

import { useFormStatus } from 'react-dom'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { loginAction } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Connexion…' : 'Se connecter'}
    </Button>
  )
}

export function LoginForm({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null)

  async function action(formData: FormData) {
    setError(null)
    const res = await loginAction(formData)
    if (res?.error) setError(res.error)
  }

  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      {/* J3 — Garder ma session active : doctrine V5 Pilier 2, friction cumulative.
          La case est cochée par défaut (comportement attendu). La durée effective
          de la session est gérée côté Supabase (JWT expiry : voir docs/dev/auth-session-config.md).
          La case sert surtout à RASSURER l'utilisateur que le système n'est pas
          en train de l'éjecter en permanence. */}
      <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
        <input
          type="checkbox"
          name="keep_session"
          defaultChecked
          className="h-4 w-4 rounded border-border accent-foreground"
        />
        <span>Garder ma session active sur cet appareil</span>
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <SubmitButton />
    </form>
  )
}
