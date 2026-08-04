'use client'

// Copilote Phase 2 — bloc "Demander à MemorIA" dans l'Aperçu.
// 4 questions prédéfinies (fire-and-return). Pas de chat libre.
// Les références affichées viennent exclusivement du contexte déterministe.

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles, X, Loader2, ExternalLink } from 'lucide-react'
import { askCopilotAction, type CopilotActionResult } from '../../copilot-action'
import type { CopilotIntent } from '@/lib/visits/copilot-context'

const QUESTIONS: { intent: CopilotIntent; label: string }[] = [
  { intent: 'attention',  label: "Qu'est-ce qui mérite mon attention ?" },
  { intent: 'changes',    label: "Qu'est-ce qui a changé récemment ?" },
  { intent: 'stale',      label: "Qu'est-ce qui traîne ?" },
  { intent: 'next_visit', label: "Que dois-je vérifier à ma prochaine visite ?" },
]

export function CopilotBlock({ siteId }: { siteId: string }) {
  const [loading, setLoading]           = useState(false)
  const [activeIntent, setActiveIntent] = useState<CopilotIntent | null>(null)
  const [result, setResult]             = useState<CopilotActionResult | null>(null)

  async function ask(intent: CopilotIntent) {
    if (loading) return
    setLoading(true)
    setActiveIntent(intent)
    setResult(null)
    try {
      const res = await askCopilotAction({ siteId, intent })
      setResult(res)
    } finally {
      setLoading(false)
    }
  }

  function dismiss() {
    setResult(null)
    setActiveIntent(null)
  }

  const hasAnswer = !loading && result !== null

  return (
    <section className="rounded-[18px] border border-dashed border-foreground/15 bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
        <h2 className="text-sm font-semibold text-foreground/80">Demander à MemorIA</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map(({ intent, label }) => {
          const isActive = activeIntent === intent && (loading || hasAnswer)
          return (
            <button
              key={intent}
              type="button"
              onClick={() => ask(intent)}
              disabled={loading}
              className={[
                'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                isActive
                  ? 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300'
                  : 'border-border bg-background text-foreground/70 hover:bg-muted disabled:opacity-50',
              ].join(' ')}
            >
              {label}
            </button>
          )
        })}
      </div>

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyse…
        </div>
      )}

      {hasAnswer && (
        <div className="mt-3 space-y-3 rounded-xl border border-foreground/[0.06] bg-muted/40 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[14px] leading-relaxed text-foreground whitespace-pre-line flex-1">{result.text}</p>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {result.references.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {result.references
                .filter((ref) => ref.href !== null)
                .map((ref) => (
                  <Link
                    key={ref.id}
                    href={ref.href!}
                    className="inline-flex items-center gap-1 rounded-lg border border-foreground/10 bg-background px-2.5 py-1 text-[12px] font-medium text-foreground/70 hover:bg-muted"
                  >
                    Voir {ref.label}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                ))}
            </div>
          )}

          {result.source === 'fallback' && (
            <p className="text-[11px] text-muted-foreground pt-0.5">
              Réponse déterministe — assistant IA temporairement indisponible.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
