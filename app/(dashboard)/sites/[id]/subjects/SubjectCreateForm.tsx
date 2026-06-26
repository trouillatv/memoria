'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { createSubjectAction } from './actions'
import { looksLikeAction, subjectDedupKey, SUBJECT_DOCTRINE } from '@/lib/db/subject-doctrine'

interface Props {
  siteId: string
  scopes: { id: string; label: string }[]
  /** Noms des sujets existants — pour avertir d'un doublon probable avant l'envoi. */
  existingNames?: string[]
}

export function SubjectCreateForm({ siteId, scopes, existingNames = [] }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [pending, start] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  const existingKeys = useMemo(() => new Set(existingNames.map(subjectDedupKey)), [existingNames])
  // Avertissements DÉTERMINISTES, non bloquants (la doctrine guide, l'humain décide).
  const isDuplicate = name.trim().length > 0 && existingKeys.has(subjectDedupKey(name))
  const isActionLike = looksLikeAction(name)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('siteId', siteId)
    start(async () => {
      const r = await createSubjectAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Sujet créé')
      formRef.current?.reset()
      setName('')
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
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input name="name" required maxLength={160} autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Nom du sujet (ex. Porte coupe-feu, Local TGBT, Étanchéité toiture)"
          disabled={pending} className="flex-1 min-w-[220px] rounded border bg-background px-2 py-1.5 text-sm" />
        {scopes.length > 0 && (
          <select name="scopeId" disabled={pending} defaultValue=""
            className="rounded border bg-background px-2 py-1.5 text-sm">
            <option value="">Sous-périmètre (optionnel)</option>
            {scopes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
        <button type="submit" disabled={pending || isDuplicate}
          className="rounded bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-50">
          {pending ? 'Création…' : 'Créer'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setName('') }} className="text-sm text-muted-foreground">Annuler</button>
      </div>
      {isDuplicate ? (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-rose-700"><AlertTriangle className="h-3 w-3" /> Un sujet identique existe déjà — rattachez-le plutôt que d&apos;en créer un doublon.</p>
      ) : isActionLike ? (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-amber-700"><AlertTriangle className="h-3 w-3" /> Ça ressemble à une action. {SUBJECT_DOCTRINE}</p>
      ) : (
        <p className="text-[10px] text-muted-foreground/70">{SUBJECT_DOCTRINE}</p>
      )}
    </form>
  )
}
