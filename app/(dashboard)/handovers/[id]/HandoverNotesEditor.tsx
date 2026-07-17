'use client'

// Éditeur des notes manuelles d'un brief.
//
// Vincent 2026-05-22 — Les notes sont la seule partie du payload qui peut être
// modifiée après création (le snapshot des sites reste immuable). C'est l'espace
// éditorial où le manager peut ajouter contexte, contact direct, choses qu'il
// ne veut PAS mettre dans le snapshot automatique.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pin, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { updateBriefNotesAction } from '../actions'

interface Props {
  briefId: string
  initialNotes: string | null
  disabled?: boolean
}

export function HandoverNotesEditor({ briefId, initialNotes, disabled }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialNotes ?? '')
  const [pending, startTransition] = useTransition()

  function save() {
    startTransition(async () => {
      const r = await updateBriefNotesAction({
        id: briefId,
        notes: draft.trim() || null,
      })
      if (r.ok) {
        toast.success('Notes enregistrées')
        setEditing(false)
        router.refresh()
      } else {
        toast.error(r.error ?? 'Erreur')
      }
    })
  }

  function cancel() {
    setDraft(initialNotes ?? '')
    setEditing(false)
  }

  if (disabled) return null

  if (!editing) {
    return (
      <section className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Pin className="h-4 w-4 text-brand-600" />
            Notes du manager
          </h2>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {initialNotes ? 'Modifier' : 'Ajouter'}
          </Button>
        </div>
        {initialNotes ? (
          <p className="text-sm whitespace-pre-wrap">{initialNotes}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Aucune note. Ajoute ici le contexte spécifique : contact client direct,
            point d&apos;attention particulier, deadline interne…
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Pin className="h-4 w-4 text-brand-600" />
          Notes du manager
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
            <X className="h-3.5 w-3.5" />
            Annuler
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            <Save className="h-3.5 w-3.5" />
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={4000}
        rows={6}
        placeholder="Contexte spécifique, contact client direct, point d&apos;attention particulier…"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-y"
      />
      <p className="text-[11px] text-muted-foreground">
        {draft.length}/4000 caractères. Ces notes sont éditoriales et restent
        modifiables. Le reste du brief (snapshot des chantiers) est immuable.
      </p>
    </section>
  )
}
