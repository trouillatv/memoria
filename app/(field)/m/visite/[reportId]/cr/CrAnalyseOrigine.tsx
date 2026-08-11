'use client'

// « VOIR L'ANALYSE D'ORIGINE » — toutes les propositions IA pour ce rapport,
// statut inclus (proposé, remplacé, écarté, créé). Ne modifie rien : lecture seule.
//
// Règle : on montre CE QUE L'IA AVAIT VU, pas ce qui a survécu aux corrections.
// La distinction est essentielle pour comprendre pourquoi le CR actuel s'éloigne
// de la proposition initiale — et retrouver ce qui a peut-être été perdu en route.

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { DbKnowledgeProposal, ProposalStatus } from '@/lib/db/knowledge-proposals'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<ProposalStatus, string> = {
  proposed: "En attente",
  confirmed: "Accepté",
  fulfilled: "Créé",
  dismissed: "Écarté",
  superseded: "Remplacé",
  masked: "Masqué",
}

const STATUS_CLS: Record<ProposalStatus, string> = {
  proposed: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  confirmed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  fulfilled: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  dismissed: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
  superseded: "bg-muted text-muted-foreground",
  masked: "bg-muted text-muted-foreground",
}

const KIND_LABEL: Record<string, string> = {
  action: "Actions",
  decision: "Décisions",
  deadline: "Échéances",
  vigilance: "Vigilances",
  knowledge: "Mémoire",
  stakeholder: "Intervenants",
}

export function CrAnalyseOrigine({ proposals }: { proposals: DbKnowledgeProposal[] }) {
  const [open, setOpen] = useState(false)

  if (proposals.length === 0) return null

  const byKind: Record<string, DbKnowledgeProposal[]> = {}
  for (const p of proposals) {
    if (!byKind[p.kind]) byKind[p.kind] = []
    byKind[p.kind]!.push(p)
  }

  const total = proposals.length
  const created = proposals.filter((p) => p.promoted_object_id || p.status === "fulfilled").length
  const dismissed = proposals.filter((p) => p.status === "dismissed").length
  const superseded = proposals.filter((p) => p.status === "superseded").length

  return (
    <div className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div>
          <p className="text-sm font-semibold">Analyse d'origine</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {total} proposition{total > 1 ? "s" : ""} IA
            {created > 0 && ` · ${created} créée${created > 1 ? "s" : ""}`}
            {dismissed > 0 && ` · ${dismissed} écartée${dismissed > 1 ? "s" : ""}`}
            {superseded > 0 && ` · ${superseded} remplacée${superseded > 1 ? "s" : ""}`}
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {Object.entries(byKind).map(([kind, list]) => (
            <div key={kind}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {KIND_LABEL[kind] ?? kind}
              </p>
              <ul className="space-y-1">
                {list.map((p) => (
                  <li key={p.id} className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        STATUS_CLS[p.status],
                      )}
                    >
                      {STATUS_LABEL[p.status]}
                    </span>
                    <span className={cn("flex-1 text-[12px] leading-snug", p.status === "superseded" || p.status === "masked" ? "line-through opacity-50" : "")}>
                      {p.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
