'use client'

// ── « POURQUOI ? » — LE RACCOURCI TRANSVERSAL DU MOTEUR D'EXPLICATION ────────
// Posé sur une échéance, une action, une décision — PARTOUT où la provenance
// est réellement disponible, et seulement là (le parent vérifie `report_id`
// avant de rendre ce bouton : un bouton qui ne tient pas sa promesse est pire
// qu'aucun bouton).
//
// Il déplie la chaîne remontée par le read model : chantier → visite → mémo
// mot pour mot → objet. Aucune navigation, aucun nouvel écran : la réponse
// vient à l'objet, pas l'inverse. L'onglet Explorer offrira le même chemin en
// mode carte — même source, autre lecture.

import { useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { getProvenanceAction } from '@/app/(dashboard)/sites/[id]/provenance-actions'
import type { ProvenanceChain, ProvenanceObjectType } from '@/lib/knowledge/provenance'
import { cn } from '@/lib/utils'

const DOT: Record<string, string> = {
  site: 'bg-foreground',
  visite: 'bg-sky-500',
  memo: 'bg-teal-600',
  objet: 'bg-violet-600',
}

export function WhyButton({
  objectType,
  objectId,
  label = 'Pourquoi ?',
}: {
  objectType: ProvenanceObjectType
  objectId: string
  /** « Pourquoi ? » (échéance, action) · « Voir l'origine » (décision). */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [chain, setChain] = useState<ProvenanceChain | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggle() {
    if (open) return setOpen(false)
    setOpen(true)
    if (chain || error) return
    start(async () => {
      const res = await getProvenanceAction({ type: objectType, id: objectId })
      if (res.ok) setChain(res.chain)
      else setError(res.error)
    })
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
      >
        {label}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-2 rounded-xl border bg-muted/20 p-3">
          {pending && (
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Je remonte la trace…
            </p>
          )}
          {error && <p className="text-[12px] text-muted-foreground">{error}</p>}
          {chain && (
            <ol className="space-y-2">
              {chain.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className={cn('mt-[5px] h-2 w-2 shrink-0 rounded-full', DOT[s.kind])} />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug text-foreground">
                      {i > 0 && <span className="mr-1 text-muted-foreground">↳</span>}
                      {s.label}
                      {s.sub && <span className="ml-1.5 text-[11px] text-muted-foreground">· {s.sub}</span>}
                    </p>
                    {/* La preuve, mot pour mot — jamais une paraphrase. */}
                    {s.excerpt && (
                      <p className="mt-1 border-l-2 border-teal-600/50 pl-2 text-[12px] italic leading-snug text-muted-foreground">
                        «&nbsp;{s.excerpt}&nbsp;»
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
