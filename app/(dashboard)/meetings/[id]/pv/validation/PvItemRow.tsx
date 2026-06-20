'use client'

// Ligne de contenu du PV (points examinés / prévisions). « Exclure du PV » retire
// une ligne parasite (ex. anomalie « szdz ») de la CR — c'est une décision sur la
// MÉMOIRE, pas une édition du document. L'item exclu reste visible barré, réintégrable.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EyeOff, RotateCcw, Loader2 } from 'lucide-react'
import { excludePvItemAction, includePvItemAction } from '../../pv-actions'
import { PvActionCodes } from './PvActionCodes'
import type { PvValidationItem } from '@/lib/documents/pv-validation'

export function PvItemRow({ reportId, item, excludable }: { reportId: string; item: PvValidationItem; excludable: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggle() {
    setError(null)
    startTransition(async () => {
      try {
        const res = item.excluded
          ? await includePvItemAction(reportId, item.source)
          : await excludePvItemAction(reportId, item.source)
        if (res.ok) router.refresh()
        else setError(res.error)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur serveur.')
      }
    })
  }

  // Colonne ACTION éditable (mig 132) : seulement sur les points examinés (pas les
  // prévisions), et pas sur une ligne exclue du PV. Stocke les codes en MÉMOIRE.
  const showActions = item.section === 'points_examines' && !item.excluded

  return (
    <li className="rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        {item.blocking && !item.excluded && <span title="Blocage métier" className="mt-0.5 text-rose-600">⛔</span>}
        <span className={`min-w-0 flex-1 ${item.excluded ? 'text-muted-foreground line-through' : ''}`}>{item.texte}</span>
        {item.excluded ? (
          <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">exclu du PV</span>
        ) : (
          item.confiance === 'à confirmer' && (
            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">à confirmer</span>
          )
        )}
        {excludable && (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            title={item.excluded ? 'Réintégrer dans le PV' : 'Exclure du PV (ligne parasite)'}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : item.excluded ? <RotateCcw className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {item.excluded ? 'Réintégrer' : 'Exclure'}
          </button>
        )}
        {error && <span className="shrink-0 text-[11px] text-rose-600">{error}</span>}
      </div>
      {showActions && (
        <div className="mt-2 border-t pt-2">
          <PvActionCodes reportId={reportId} source={item.source} codes={item.actionCodes ?? []} />
        </div>
      )}
    </li>
  )
}
