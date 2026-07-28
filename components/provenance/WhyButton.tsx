'use client'

// ── « POURQUOI ? » — LA PREUVE CIBLÉE, PAS LE CONTEXTE ───────────────────────
// Posé sur une échéance, une action, une décision — PARTOUT où la provenance
// est réellement disponible, et seulement là (le parent vérifie `report_id`
// avant de rendre ce bouton : un bouton qui ne tient pas sa promesse est pire
// qu'aucun bouton).
//
// Hiérarchie de lecture (Vincent, 2026-07-28), pensée pour comprendre en < 5 s :
//   1. STATUT (validée / en attente / rejetée / remplacée) ;
//   2. DÉTECTÉ LE — quand MemorIA a créé la proposition ;
//   3. SOURCE — la visite d'origine ;
//   4. CITATION — la/les phrase(s) (≤ 2) qui ont justifié l'extraction ;
//   5. LIEN vers la source.
// On ne déverse plus tout le mémo : la preuve ciblée suffit à comprendre.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Loader2, ArrowUpRight } from 'lucide-react'
import { getProvenanceAction } from '@/app/(dashboard)/sites/[id]/provenance-actions'
import type { ProvenanceChain, ProvenanceObjectType, ProposalStatus } from '@/lib/knowledge/provenance'

const STATUS_BADGE: Record<ProposalStatus, { label: string; cls: string; dot: string }> = {
  confirmed: { label: 'Validée', cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
  fulfilled: { label: 'Validée', cls: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300', dot: 'bg-emerald-500' },
  proposed: { label: 'En attente', cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300', dot: 'bg-amber-500' },
  dismissed: { label: 'Rejetée', cls: 'bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300', dot: 'bg-red-500' },
  superseded: { label: 'Remplacée', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
}

const detectedFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Pacific/Noumea', day: '2-digit', month: '2-digit', year: 'numeric',
})

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

  const badge = chain?.status ? STATUS_BADGE[chain.status] : null

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
        <div className="mt-2 space-y-2 rounded-xl border bg-muted/20 p-3">
          {pending && (
            <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Je remonte la trace…
            </p>
          )}
          {error && <p className="text-[12px] text-muted-foreground">{error}</p>}
          {chain && (
            <>
              {/* 1. STATUT — immédiatement identifiable. */}
              {badge && (
                <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                  {badge.label}
                </span>
              )}

              {/* 2. DÉTECTÉ LE — quand l'information est apparue. */}
              {chain.detectedAt && (
                <p className="text-[12px] text-muted-foreground">
                  <span className="font-semibold text-foreground">Détecté le :</span> {detectedFmt.format(new Date(chain.detectedAt))}
                </p>
              )}

              {/* 3. SOURCE — d'où vient la preuve. */}
              {chain.sourceLabel && (
                <p className="text-[12px] text-muted-foreground">
                  <span className="font-semibold text-foreground">Source :</span> {chain.sourceLabel}
                  <span className="text-muted-foreground/70"> · {chain.siteName}</span>
                </p>
              )}

              {/* 4. CITATION CIBLÉE — la phrase qui a justifié l'extraction (≤ 2). */}
              {chain.citations.length > 0 ? (
                <div className="space-y-1.5">
                  {chain.citations.map((c, i) => (
                    <div key={i}>
                      <p className="border-l-2 border-teal-600/50 pl-2 text-[12.5px] italic leading-snug text-foreground/90">
                        «&nbsp;{c.text}&nbsp;»
                      </p>
                      <p className="pl-2 text-[10.5px] text-muted-foreground">{c.source}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11.5px] italic text-muted-foreground">Aucun extrait précis retrouvé dans le mémo.</p>
              )}

              {/* 5. LIEN vers la source. */}
              {chain.origin && (
                <Link
                  href={chain.origin.href}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-teal-700 underline decoration-dotted underline-offset-2 hover:text-teal-900 dark:text-teal-400"
                >
                  {chain.origin.label} <ArrowUpRight className="h-3 w-3" />
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
