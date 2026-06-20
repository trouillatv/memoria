'use client'

// Carte d'un « point à confirmer ». Si le signal porte une `cible` (resolver),
// elle devient interactive : Compléter → écrit la MÉMOIRE (server action) →
// recalcul → le signal disparaît (boucle A). Sans cible (DNS/date sans stockage,
// organisme, photos) : affichage seul pour l'instant — pas de bouton mensonger.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { completePvSignalAction } from '../../pv-actions'
import type { PvPointAConfirmer } from '@/lib/documents/meeting-to-cr-becib'

export function PvConfirmCard({ reportId, signal }: { reportId: string; signal: PvPointAConfirmer }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const resolvable = !!signal.cible
  const isDate = signal.type === 'Échéance'

  function submit() {
    if (!signal.cible) return
    setError(null)
    const { resolver, refId } = signal.cible
    startTransition(async () => {
      try {
        const res = await completePvSignalAction(reportId, resolver, refId, value)
        if (res.ok) { setOpen(false); setValue(''); router.refresh() }
        else setError(res.error)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Échec de la complétion (erreur serveur).')
      }
    })
  }

  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-sm">{signal.libelle}</div>
          <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="font-medium">{signal.type}</span>
            {signal.nature && <span>· {signal.nature === 'metier' ? 'métier' : 'documentaire'}</span>}
            {signal.proposition && <span className="normal-case text-sky-700">· proposition : {signal.proposition}</span>}
          </div>

          {open && resolvable && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) submit() }}
                placeholder={isDate ? 'AAAA-MM-JJ' : 'Saisir…'}
                disabled={pending}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={submit}
                disabled={pending || !value.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); setError(null) }}
                disabled={pending}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" /> Annuler
              </button>
            </div>
          )}

          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>

        {resolvable && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40"
          >
            <Pencil className="h-3.5 w-3.5" /> Compléter
          </button>
        )}
      </div>
    </li>
  )
}
