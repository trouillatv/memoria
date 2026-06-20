'use client'

// Carte d'un « point à confirmer ». 4 verbes (Vincent 2026-06-20) :
//   Compléter      → écrit la MÉMOIRE via resolver (boucle A) → le signal tombe.
//   Reporter       → « pas encore » : reste bloquant, juste marqué (auditable).
//   Ignorer        → « on s'en fiche » : levé du gate (auditable).
//   Faux positif   → « le détecteur s'est trompé » : levé + retour détection.
// Compléter corrige la donnée ; les 3 autres n'écrivent QUE la décision (table 125).
// Sans cible (DNS/date sans stockage…) : pas de bouton Compléter (pas de mensonge).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, X, Clock, BellOff, Bug, Undo2 } from 'lucide-react'
import { completePvSignalAction, decidePvSignalAction, undoPvSignalDecisionAction } from '../../pv-actions'
import type { PvGapAnnote } from '@/lib/documents/pv-validation'

const DECISION_BADGE = {
  reported: { label: 'Reporté', cls: 'bg-amber-100 text-amber-700' },
  ignored: { label: 'Ignoré', cls: 'bg-slate-200 text-slate-600' },
  false_positive: { label: 'Faux positif', cls: 'bg-slate-200 text-slate-600' },
} as const

export function PvConfirmCard({ reportId, signal }: { reportId: string; signal: PvGapAnnote }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const resolvable = !!signal.cible
  const isDate = signal.type === 'Échéance'
  const decision = signal.decision
  // Un point MÉTIER (responsable / échéance) ne peut être ni ignoré ni classé faux
  // positif (garde-fou serveur aussi) : au maximum reporté. On le complète ou on l'assume.
  const metier = signal.nature === 'metier'

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res.ok) { setOpen(false); setValue(''); router.refresh() }
        else setError(res.error)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur serveur.')
      }
    })
  }

  const complete = () => { if (signal.cible) run(() => completePvSignalAction(reportId, signal.cible!.resolver, signal.cible!.refId, value)) }
  const decide = (statut: 'reported' | 'ignored' | 'false_positive') => run(() => decidePvSignalAction(reportId, signal.id, statut))
  const undo = () => run(() => undoPvSignalDecisionAction(reportId, signal.id))

  const badge = decision ? DECISION_BADGE[decision.statut] : null

  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm">{signal.libelle}</span>
            {badge && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.label}</span>}
          </div>
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
                onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) complete() }}
                placeholder={isDate ? 'AAAA-MM-JJ' : 'Saisir…'}
                disabled={pending}
                className="rounded-lg border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60"
              />
              <button type="button" onClick={complete} disabled={pending || !value.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Enregistrer
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(null) }} disabled={pending}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" /> Annuler
              </button>
            </div>
          )}

          {/* Verbes de décision (cachés pendant la saisie « Compléter »). */}
          {!open && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {decision ? (
                <button type="button" onClick={undo} disabled={pending}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                  <Undo2 className="h-3.5 w-3.5" /> Annuler la décision
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => decide('reported')} disabled={pending}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-amber-700 disabled:opacity-50">
                    <Clock className="h-3.5 w-3.5" /> Reporter
                  </button>
                  {/* Ignorer / Faux positif : interdits sur un point métier. */}
                  {!metier && (
                    <>
                      <button type="button" onClick={() => decide('ignored')} disabled={pending}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                        <BellOff className="h-3.5 w-3.5" /> Ignorer
                      </button>
                      <button type="button" onClick={() => decide('false_positive')} disabled={pending}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50">
                        <Bug className="h-3.5 w-3.5" /> Faux positif
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>

        {/* Compléter : seulement si adressable et pas encore en saisie. */}
        {resolvable && !open && (
          <button type="button" onClick={() => setOpen(true)} disabled={pending}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/40 disabled:opacity-50">
            <Pencil className="h-3.5 w-3.5" /> Compléter
          </button>
        )}
      </div>
    </li>
  )
}
