'use client'

// Slice 6.4 — Modal « Pas aujourd'hui »
//
// Doctrine impérative :
//   - Wording « Pas aujourd'hui » partout, jamais « Annuler / Reporter / Skip »
//     pour désigner l'action. Le bouton « Annuler » désigne ici uniquement la
//     fermeture de la modale (UX standard) — pas le geste métier.
//   - Raison obligatoire (min 3 chars). Validation côté client + serveur.
//   - Pas de mass-skip : la modal vise une seule intervention identifiée par
//     `interventionId`.
//   - Bouton sobre côté trigger (gris foncé sur fond clair, non alarmant).
//   - Affichage conditionnel : on suppose que le caller ne rend ce composant
//     que pour une intervention `status === 'planned'`. La server action
//     refuse aussi côté serveur si le statut a changé entre-temps.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { skipInterventionAction } from './actions'

interface Props {
  interventionId: string
  /**
   * Optionnel : action serveur custom (utilisée par la version superviseur).
   * Si omise, on appelle l'action mobile par défaut.
   */
  action?: (fd: FormData) => Promise<{ ok: true } | { ok: false; error?: string } | { error: string }>
}

/**
 * Wrapper exposant le bouton « Pas aujourd'hui » + sa modal.
 * Le caller ne doit instancier ce composant que si
 * `intervention.status === 'planned'`. La doctrine UX dit : pas de bouton
 * sur intervention déjà commencée / terminée / déjà sautée.
 */
export function SkipInterventionTrigger({ interventionId, action }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 text-sm font-medium text-amber-900 px-4 py-3 hover:bg-amber-100 active:bg-amber-200/70"
        style={{ minHeight: 48 }}
        data-testid="skip-trigger"
      >
        Annuler l&apos;opération de ce jour
      </button>
      {open && (
        <SkipModal
          interventionId={interventionId}
          action={action}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function SkipModal({
  interventionId,
  action,
  onClose,
}: {
  interventionId: string
  action?: Props['action']
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const trimmed = reason.trim()
  const tooShort = trimmed.length < 3
  const tooLong = trimmed.length > 500

  function handleClose() {
    if (pending) return
    setReason('')
    setError(null)
    onClose()
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) handleClose()
  }

  function submit() {
    if (tooShort || tooLong) return
    setError(null)
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('reason', trimmed)

    startTransition(async () => {
      const fn = action ?? skipInterventionAction
      const r = await fn(fd)
      // Format de retour hétérogène (mobile vs superviseur) — on accepte
      // { ok:true } | { ok:false, error } | { error } (legacy).
      const ok =
        r && 'ok' in r ? (r as { ok: boolean }).ok :
        !(r && 'error' in r && (r as { error?: string }).error)
      if (!ok) {
        const msg =
          (r && 'error' in r ? (r as { error?: string }).error : undefined) ??
          'Une erreur est survenue'
        setError(msg)
        return
      }
      setReason('')
      onClose()
      router.refresh()
    })
  }

  return (
    <div
      ref={overlayRef}
      role="presentation"
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skip-modal-title"
        className="w-full sm:max-w-md bg-background rounded-t-2xl sm:rounded-2xl shadow-lg border-t sm:border max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <h2 id="skip-modal-title" className="text-lg font-semibold">
              Annuler l&apos;opération de ce jour&nbsp;?
            </h2>
            <p className="text-sm text-muted-foreground">
              Indiquez la raison. L&apos;intervention restera visible, marquée
              comme annulée pour ce jour.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="skip-reason" className="text-sm font-medium">
              Raison
            </label>
            <textarea
              id="skip-reason"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={pending}
              data-testid="skip-reason-input"
              className="w-full rounded-lg border border-border bg-background p-3 text-base resize-none focus:outline-none focus:ring-2 focus:ring-foreground/20"
              placeholder="Chantier fermé, accès condamné, agent indisponible..."
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{trimmed.length < 3 ? 'Minimum 3 caractères' : ' '}</span>
              <span>{trimmed.length}/500</span>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              data-testid="skip-error"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={pending}
              data-testid="skip-cancel"
              className="inline-flex items-center justify-center rounded-xl border border-border bg-card text-base font-medium px-4 py-3 active:bg-muted/40 disabled:opacity-50"
              style={{ minHeight: 48 }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || tooShort || tooLong}
              data-testid="skip-confirm"
              className="inline-flex items-center justify-center rounded-xl bg-foreground text-background text-base font-medium px-4 py-3 active:bg-foreground/90 disabled:opacity-50"
              style={{ minHeight: 48 }}
            >
              {pending ? 'Enregistrement...' : 'Confirmer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
