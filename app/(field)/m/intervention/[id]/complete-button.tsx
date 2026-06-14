'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ArrowLeft, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { completeInterventionMobileAction } from './actions'
import { SignaturePad } from './SignaturePad'

interface Props {
  interventionId: string
  hasMissingRequired: boolean
}

type Step = 'idle' | 'comment' | 'signature'

export function CompleteButton({ interventionId, hasMissingRequired: _hasMissingRequired }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState<Step>('idle')
  const [comment, setComment] = useState('')

  function attemptComplete(opts: { comment?: string; signatureDataUrl?: string }) {
    const fd = new FormData()
    fd.set('id', interventionId)
    if (opts.comment?.trim()) fd.set('comment', opts.comment.trim())
    if (opts.signatureDataUrl) fd.set('signature_data_url', opts.signatureDataUrl)

    startTransition(async () => {
      const r = await completeInterventionMobileAction(fd)
      if (r && 'error' in r) {
        if (r.error === 'comment_required') {
          setStep('comment')
        } else if (r.error) {
          toast.error(r.error)
        }
      } else if (r && 'ok' in r) {
        toast.success('Mission terminée', { duration: 2000 })
        router.push('/m')
      }
    })
  }

  function handleInitialClick() {
    // Tente d'abord via le serveur pour détecter les items manquants
    attemptComplete({})
  }

  function handleCommentNext() {
    if (!comment.trim()) return
    // Après le commentaire, on passe à la signature
    setStep('signature')
  }

  function handleSign(dataUrl: string) {
    attemptComplete({ comment: comment || undefined, signatureDataUrl: dataUrl })
  }

  function goBack() {
    if (step === 'signature') {
      // Retour au commentaire si on avait un commentaire, sinon retour à idle
      setStep(comment ? 'comment' : 'idle')
    } else {
      setStep('idle')
      setComment('')
    }
  }

  // Étape : commentaire (items non cochés)
  if (step === 'comment') {
    return (
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Vous n&apos;avez pas coché toutes les tâches.</h3>
          <button
            type="button"
            onClick={goBack}
            disabled={pending}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground"
            style={{ minHeight: 44 }}
          >
            <ArrowLeft className="h-4 w-4" />
            Retour
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Pourquoi&nbsp;? Un mot pour expliquer au superviseur.
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={140}
          disabled={pending}
          autoFocus
          className="w-full rounded-lg border p-3 text-base resize-none"
          placeholder="Ex: pas pu nettoyer le couloir, accès fermé..."
        />
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground tabular-nums">
            {comment.length} / 140
          </span>
          <button
            type="button"
            onClick={handleCommentNext}
            disabled={pending || !comment.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-foreground text-background text-base font-medium px-5 py-3 active:bg-foreground/90 disabled:opacity-50"
            style={{ minHeight: 56 }}
          >
            <PenLine className="h-4 w-4" />
            Signer et terminer
          </button>
        </div>
      </div>
    )
  }

  // Étape : signature
  if (step === 'signature') {
    return (
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Signature de clôture</h3>
          <button
            type="button"
            onClick={goBack}
            disabled={pending}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground"
            style={{ minHeight: 44 }}
          >
            <ArrowLeft className="h-4 w-4" />
            Retour
          </button>
        </div>
        <SignaturePad onSign={handleSign} disabled={pending} />
      </div>
    )
  }

  // Étape initiale : bouton "Mission terminée"
  return (
    <button
      type="button"
      onClick={handleInitialClick}
      disabled={pending}
      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-foreground text-background text-base font-medium px-4 py-4 active:bg-foreground/90 disabled:opacity-50"
      style={{ minHeight: 64 }}
    >
      <CheckCircle2 className="h-5 w-5" />
      {pending ? 'Envoi...' : 'Mission terminée'}
    </button>
  )
}
