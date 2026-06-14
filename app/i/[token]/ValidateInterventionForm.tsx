'use client'

import { useState, useTransition } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { validateInterventionViaToken } from './actions-public'

export function ValidateInterventionForm({ token }: { token: string }) {
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-sm font-medium text-emerald-800">Validé. Merci !</p>
          <p className="text-xs text-emerald-700 mt-0.5">
            Votre confirmation a été enregistrée.
          </p>
        </div>
      </div>
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await validateInterventionViaToken(token, name, comment)
      if (result.ok) {
        setDone(true)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border p-4 space-y-4">
      <h2 className="text-sm font-medium">Confirmer la réalisation</h2>

      <div className="space-y-1.5">
        <label htmlFor="it-name" className="text-xs text-muted-foreground">
          Votre nom <span className="text-amber-600">*</span>
        </label>
        <input
          id="it-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Prénom Nom"
          required
          maxLength={100}
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="it-comment" className="text-xs text-muted-foreground">
          Commentaire <span className="text-muted-foreground/50">(optionnel)</span>
        </label>
        <textarea
          id="it-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Ex : 3 montants manquants — livraison incomplète"
          rows={2}
          maxLength={500}
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isPending || !name.trim()}
        className="w-full rounded-lg bg-foreground text-background py-3 text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-opacity"
      >
        {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Valider
      </button>
    </form>
  )
}
