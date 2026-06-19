'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { createSubjectAction } from './actions'

interface Props {
  siteId: string
  scopes: { id: string; label: string }[]
}

export function SubjectCreateForm({ siteId, scopes }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('siteId', siteId)
    start(async () => {
      const r = await createSubjectAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Sujet créé')
      formRef.current?.reset()
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted/40">
        <Plus className="h-3.5 w-3.5" /> Nouveau sujet
      </button>
    )
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-3">
      <input name="name" required maxLength={160} autoFocus
        placeholder="Nom du sujet (ex. Essais à la plaque, DOE, Fissure voile nord)"
        disabled={pending} className="flex-1 min-w-[220px] rounded border bg-background px-2 py-1.5 text-sm" />
      {scopes.length > 0 && (
        <select name="scopeId" disabled={pending} defaultValue=""
          className="rounded border bg-background px-2 py-1.5 text-sm">
          <option value="">Sous-périmètre (optionnel)</option>
          {scopes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}
      <button type="submit" disabled={pending}
        className="rounded bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-50">
        {pending ? 'Création…' : 'Créer'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground">Annuler</button>
    </form>
  )
}
