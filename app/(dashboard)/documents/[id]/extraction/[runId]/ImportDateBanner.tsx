'use client'

// P0-B — bandeau de confirmation de date à la revue (Vincent, 2026-08-27).
// Compare la DATE SAISIE (documents.effective_date, déclarée à l'upload) à la DATE
// DÉTECTÉE dans le document. Jamais de substitution silencieuse : en cas de divergence
// ou d'ambiguïté, l'humain choisit explicitement. Sinon, confirmation discrète.

import { useState, useTransition } from 'react'
import { AlertTriangle, CalendarCheck, HelpCircle } from 'lucide-react'
import { setImportDocumentDateAction } from './review-actions'

type Detected = { iso: string; semantics: string; evidence: string } | null

const SEMANTICS_FR: Record<string, string> = {
  visit_date: 'date de la visite',
  meeting_date: 'date de la réunion',
  report_date: 'date du compte-rendu',
  previous_visit_date: 'visite précédente',
  event_date: 'date d’un contrôle/événement',
  deadline_date: 'échéance',
  reference_date: 'référence réglementaire',
  unknown: 'date',
}

function fr(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function ImportDateBanner({
  documentId,
  enteredDate,
  detected,
  ambiguous,
}: {
  documentId: string
  enteredDate: string | null
  detected: Detected
  ambiguous: boolean
}) {
  const [dismissed, setDismissed] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  const diverges = !!detected && detected.iso !== enteredDate

  // Rien à signaler : date détectée == date saisie (confirmation discrète), ou aucune détection.
  if (!detected && !ambiguous) return null
  if (detected && !diverges && !ambiguous) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CalendarCheck className="h-4 w-4 shrink-0" />
        Date du document confirmée : <strong>{fr(detected.iso)}</strong> ({SEMANTICS_FR[detected.semantics] ?? 'date'}).
      </div>
    )
  }

  function applyDetected(iso: string) {
    setError(null)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('document_id', documentId)
      fd.set('effective_date', iso)
      const res = await setImportDocumentDateAction(fd)
      if (!res.ok) setError(res.error ?? 'Échec de la mise à jour')
      else setDismissed(true)
    })
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex items-start gap-2">
        {ambiguous ? <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0">
          {ambiguous && !diverges ? (
            <p className="font-medium">Plusieurs dates possibles dans le document — vérifiez la date de la visite avant de créer la visite.</p>
          ) : (
            <>
              <p className="font-medium">Les deux dates diffèrent — vérifiez avant de créer la visite.</p>
              <p className="mt-1">
                Date saisie : <strong>{enteredDate ? fr(enteredDate) : '—'}</strong> ·{' '}
                Date détectée dans le document : <strong>{detected ? fr(detected.iso) : '—'}</strong>
                {detected ? ` (${SEMANTICS_FR[detected.semantics] ?? 'date'})` : ''}
              </p>
              {detected?.evidence && (
                <p className="mt-1 truncate text-[12px] text-amber-700 dark:text-amber-300/80">« …{detected.evidence}… »</p>
              )}
            </>
          )}
          {error && <p className="mt-1 text-[12px] text-red-600">{error}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {detected && diverges && (
              <button
                type="button"
                disabled={pending}
                onClick={() => applyDetected(detected.iso)}
                className="rounded-md bg-amber-600 px-2.5 py-1 text-[12px] font-medium text-white active:opacity-80 disabled:opacity-50"
              >
                Utiliser le {fr(detected.iso)}
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => setDismissed(true)}
              className="rounded-md border border-amber-400 px-2.5 py-1 text-[12px] font-medium text-amber-800 active:opacity-80 disabled:opacity-50 dark:text-amber-200"
            >
              {enteredDate ? `Conserver le ${fr(enteredDate)}` : 'Conserver la date saisie'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
