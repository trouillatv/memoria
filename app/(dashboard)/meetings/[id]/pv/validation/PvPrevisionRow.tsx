'use client'

// Prévision STRUCTURÉE (Vincent 2026-06-21) : « une prévision n'est pas une phrase ».
// On montre QUI / QUAND / FIABILITÉ — la donnée derrière la ligne, socle des futurs
// « préparer la réunion / détecter les retards / comparer prévu-réalisé ». L'exclusion
// reste possible (décision sur la mémoire, ≠ édition du document).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { User, CalendarClock, EyeOff, RotateCcw, Loader2 } from 'lucide-react'
import { excludePvItemAction, includePvItemAction } from '../../pv-actions'
import type { PvValidationItem } from '@/lib/documents/pv-validation'

function ddmmyyyy(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso); if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

export function PvPrevisionRow({ reportId, item }: { reportId: string; item: PvValidationItem }) {
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
      } catch (e) { setError(e instanceof Error ? e.message : 'Erreur serveur.') }
    })
  }

  const echeance = ddmmyyyy(item.echeance)
  const titre = item.titre || item.texte

  return (
    <li className={`rounded-lg border bg-card px-3 py-2 text-sm ${item.excluded ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`min-w-0 flex-1 ${item.excluded ? 'text-muted-foreground line-through' : ''}`}>{titre}</span>
        {/* Badge FIABILITÉ : confirmée (vert) vs à confirmer (ambre). */}
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
          item.confiance === 'à confirmer' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
        }`}>
          {item.confiance === 'à confirmer' ? 'à confirmer' : 'confirmée'}
        </span>
        {item.excluded ? (
          <button type="button" disabled={pending} title="Réintégrer" onClick={toggle} className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50">
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          </button>
        ) : (
          <button type="button" disabled={pending} title="Exclure du PV" onClick={toggle} className="shrink-0 text-muted-foreground hover:text-rose-600 disabled:opacity-50">
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
          </button>
        )}
      </div>
      {/* Méta structurée : responsable + échéance, quand connus (sinon trou honnête). */}
      {(item.responsable || echeance) && (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {item.responsable && <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> {item.responsable}</span>}
          {echeance && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {echeance}</span>}
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-rose-600">{error}</p>}
    </li>
  )
}
