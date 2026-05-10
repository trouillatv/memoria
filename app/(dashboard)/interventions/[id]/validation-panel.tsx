'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, MessageSquareWarning, Stamp } from 'lucide-react'
import { toast } from 'sonner'
import { validateInterventionAction, requestCorrectionAction } from './intervention-actions'
import type { DbInterventionValidation } from '@/types/db'

interface Props {
  interventionId: string
  status: 'planned' | 'in_progress' | 'completed' | 'validated' | 'skipped'
  existingValidation: DbInterventionValidation | null
}

export function ValidationPanel({ interventionId, status, existingValidation }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'validate' | 'correction'>('idle')
  const [comment, setComment] = useState('')
  const [pending, startTransition] = useTransition()

  function reset() { setMode('idle'); setComment('') }

  function validate() {
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    if (comment.trim()) fd.set('comment', comment.trim())
    startTransition(async () => {
      const r = await validateInterventionAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Intervention validée'); reset(); router.refresh() }
    })
  }

  function requestCorrection() {
    if (!comment.trim()) { toast.error('Précisez ce qui doit être corrigé'); return }
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('comment', comment.trim())
    startTransition(async () => {
      const r = await requestCorrectionAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Demande de correction envoyée'); reset(); router.refresh() }
    })
  }

  if (status === 'validated' && existingValidation) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
        <div className="flex items-start gap-2">
          <Stamp className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-emerald-800">Intervention validée</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {new Date(existingValidation.validated_at).toLocaleString('fr-FR')}
            </div>
            {existingValidation.comment && (
              <p className="text-xs text-emerald-900 mt-1.5 italic">« {existingValidation.comment} »</p>
            )}
          </div>
        </div>
      </section>
    )
  }

  if (status !== 'completed') return null

  if (mode === 'idle') {
    return (
      <section className="rounded-lg border bg-card p-4 space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Validation
        </h2>
        <p className="text-xs text-muted-foreground">
          L&apos;intervention est terminée. Validez-la, ou demandez une correction si besoin.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('validate')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-emerald-600 text-white text-sm hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4" /> Valider
          </button>
          <button
            type="button"
            onClick={() => setMode('correction')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-card text-sm hover:bg-muted/50"
          >
            <MessageSquareWarning className="h-4 w-4" /> Demander correction
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">
        {mode === 'validate' ? 'Validation' : 'Demande de correction'}
      </h2>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={mode === 'validate' ? 'Commentaire (optionnel)' : 'Précisez ce qui doit être corrigé'}
        rows={3}
        maxLength={2000}
        disabled={pending}
        className="w-full rounded border p-2 text-sm"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="px-3 py-1.5 rounded border text-sm disabled:opacity-50"
        >
          Annuler
        </button>
        {mode === 'validate' ? (
          <button
            type="button"
            onClick={validate}
            disabled={pending}
            className="px-3 py-1.5 rounded border bg-emerald-600 text-white text-sm disabled:opacity-50"
          >
            {pending ? '...' : 'Confirmer la validation'}
          </button>
        ) : (
          <button
            type="button"
            onClick={requestCorrection}
            disabled={pending || !comment.trim()}
            className="px-3 py-1.5 rounded border bg-foreground text-background text-sm disabled:opacity-50"
          >
            {pending ? '...' : 'Envoyer la demande'}
          </button>
        )}
      </div>
    </section>
  )
}
