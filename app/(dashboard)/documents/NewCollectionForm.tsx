'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OrgSelectorClient, type OrgOption } from '@/components/ui/org-selector-client'
import { createDocumentCollectionAction } from './actions'

export function NewCollectionForm({ orgs = [] }: { orgs?: OrgOption[] }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    const form = e.currentTarget
    const r = await createDocumentCollectionAction(new FormData(form))
    setPending(false)
    if (!r.ok) {
      setError(r.error ?? 'Échec')
      return
    }
    form.reset()
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="flex-1 min-w-[200px]">
        <label htmlFor="coll-name" className="text-xs text-muted-foreground">
          Nouvelle collection
        </label>
        <Input
          id="coll-name"
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="ex. Procédures CHT"
        />
      </div>
      <OrgSelectorClient orgs={orgs} className="min-w-[200px]" />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Création…' : 'Créer'}
      </Button>
      {error && <p className="w-full text-sm text-muted-foreground">{error}</p>}
    </form>
  )
}
