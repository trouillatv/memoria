'use client'

// Sprint 6 — Dialog de clôture mentale d'un dossier de preuves.
//
// Doctrine V5 verrou V3 (verrouillé) :
//   - Wording autorisé : "Clôturer", "Clôturé", "Dossier clôturé",
//     "Échange finalisé", "Incident traité", "Réclamation refermée".
//   - Wording INTERDIT : "résolu", "résolus", "résolue", "résolues",
//     "resolved", "issue closed", "conflit terminé".
//
// Le dossier reste consultable après clôture (le lien public ne change pas).
// La clôture est un signal mental d'apaisement, pas une révocation.
//
// Mode props injection pour faciliter le test unitaire (cf. AddSiteNoteButton).

import * as React from 'react'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatDateLong } from '@/lib/format'

/** Cap applicatif aligné sur lib/db/proof-share.ts + closure-actions.ts. */
const CLOSURE_NOTE_MAX = 200

type CloseResult = { ok: boolean; error?: string }
type CloseAction = (input: { tokenId: string; note?: string }) => Promise<CloseResult>
type ReopenAction = (tokenId: string) => Promise<CloseResult>

export interface CloseDossierDialogProps {
  tokenId: string
  closedAt: string | null
  closureNote?: string | null
  /** Server action injectée — facilite le test sans 'use server' réseau. */
  closeAction: CloseAction
  /** Server action de réouverture (cas Guillaume a cliqué par erreur). */
  reopenAction: ReopenAction
}

export function CloseDossierDialog({
  tokenId,
  closedAt,
  closureNote,
  closeAction,
  reopenAction,
}: CloseDossierDialogProps) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [_, startReopen] = useTransition()

  // -------------------------------------------------------------------------
  // État "clôturé" : badge calme + lien Rouvrir + note si présente
  // -------------------------------------------------------------------------
  if (closedAt) {
    return (
      <div
        data-testid="close-dossier-closed-state"
        className="flex flex-wrap items-center gap-2"
      >
        <span
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
          aria-label="Dossier clôturé"
        >
          <CheckCircle2 className="size-3" aria-hidden />
          Clôturé
        </span>
        <span className="text-xs text-muted-foreground">
          le {formatDateLong(closedAt)}
        </span>
        {closureNote && (
          <span
            data-testid="close-dossier-closure-note"
            className="text-xs italic text-muted-foreground"
          >
            « {closureNote} »
          </span>
        )}
        <button
          type="button"
          data-testid="close-dossier-reopen"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
          disabled={submitting}
          onClick={() => {
            setError(null)
            startReopen(async () => {
              const res = await reopenAction(tokenId)
              if (!res.ok) {
                toast.error(res.error || 'Erreur lors de la réouverture')
                return
              }
              toast.success('Dossier rouvert')
            })
          }}
        >
          <RotateCcw className="size-3" aria-hidden />
          Rouvrir
        </button>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // État "ouvert" : bouton "Clôturer ce dossier" + dialog
  // -------------------------------------------------------------------------
  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Reset différé pour ne pas voir le contenu flicker pendant la sortie.
      setTimeout(() => {
        setNote('')
        setError(null)
      }, 200)
    }
  }

  function handleSubmit() {
    setError(null)
    const trimmed = note.trim()
    startTransition(async () => {
      const res = await closeAction({
        tokenId,
        note: trimmed.length > 0 ? trimmed : undefined,
      })
      if (!res.ok) {
        setError(res.error || 'Erreur lors de la clôture')
        return
      }
      toast.success('Dossier clôturé')
      handleOpenChange(false)
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="close-dossier-trigger"
        onClick={() => setOpen(true)}
      >
        Clôturer ce dossier
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-md"
          data-testid="close-dossier-dialog"
        >
          <DialogHeader>
            <DialogTitle>Clôturer ce dossier</DialogTitle>
            <DialogDescription>
              Le dossier reste consultable. Cette action signale simplement
              que l&apos;échange est terminé.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label
              htmlFor="closure-note"
              className="text-sm font-medium"
            >
              Note de clôture (optionnelle)
            </label>
            <Textarea
              id="closure-note"
              data-testid="close-dossier-note"
              placeholder="Ex : Échange finalisé après réunion du 15 mai"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={CLOSURE_NOTE_MAX}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {note.length} / {CLOSURE_NOTE_MAX} caractères.
            </p>
          </div>

          {error && (
            <div
              data-testid="close-dossier-error"
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
              data-testid="close-dossier-cancel"
            >
              Annuler
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              data-testid="close-dossier-submit"
            >
              {submitting && (
                <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
              )}
              Clôturer le dossier
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
