'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Sparkles, X, Loader2, ExternalLink } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { askCopilotAction, type CopilotActionResult } from '@/app/(dashboard)/sites/[id]/copilot-action'
import type { CopilotIntent } from '@/lib/visits/copilot-context'

const QUESTIONS: { intent: CopilotIntent; label: string }[] = [
  { intent: 'attention',  label: "Qu'est-ce qui mérite mon attention ?" },
  { intent: 'changes',    label: "Qu'est-ce qui a changé récemment ?" },
  { intent: 'stale',      label: "Qu'est-ce qui traîne ?" },
  { intent: 'next_visit', label: "Que dois-je vérifier à ma prochaine visite ?" },
]

export function CopilotMobileSheet({ siteId }: { siteId: string }) {
  const [open, setOpen]             = useState(false)
  const [loading, setLoading]       = useState(false)
  const [activeIntent, setActive]   = useState<CopilotIntent | null>(null)
  const [result, setResult]         = useState<CopilotActionResult | null>(null)

  async function ask(intent: CopilotIntent) {
    if (loading) return
    setLoading(true)
    setActive(intent)
    setResult(null)
    try {
      const res = await askCopilotAction({ siteId, intent })
      setResult(res)
    } finally {
      setLoading(false)
    }
  }

  const hasAnswer = !loading && result !== null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-violet-300 bg-violet-50/50 px-4 py-3 text-left dark:border-violet-800/50 dark:bg-violet-950/10 active:opacity-70"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
        <span className="text-[13px] font-medium text-violet-700 dark:text-violet-300">
          Demander à MemorIA
        </span>
      </button>

      <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setResult(null); setActive(null) } }}>
        <SheetContent side="bottom" className="max-h-[85svh] overflow-y-auto rounded-t-2xl px-4 pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Demander à MemorIA
            </SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-2 mb-4">
            {QUESTIONS.map(({ intent, label }) => {
              const isActive = activeIntent === intent && (loading || hasAnswer)
              return (
                <button
                  key={intent}
                  type="button"
                  onClick={() => ask(intent)}
                  disabled={loading}
                  className={[
                    'rounded-xl border px-4 py-3 text-[14px] font-medium text-left transition-colors',
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse…
            </div>
          )}

          {hasAnswer && (
            <div className="space-y-3 rounded-xl border border-foreground/[0.06] bg-muted/40 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="flex-1 whitespace-pre-line text-[14px] leading-relaxed text-foreground">
                  {result.text}
                </p>
                <button
                  type="button"
                  onClick={() => { setResult(null); setActive(null) }}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Effacer la réponse"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {result.references.filter((r) => r.href !== null).length > 0 && (
                <div className="flex flex-col gap-2 pt-0.5">
                  {result.references
                    .filter((ref) => ref.href !== null)
                    .map((ref) => (
                      <Link
                        key={ref.id}
                        href={ref.href!}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1 rounded-lg border border-foreground/10 bg-background px-2.5 py-2 text-[13px] font-medium text-foreground/70 active:opacity-70"
                      >
                        Voir {ref.label}
                        <ExternalLink className="ml-auto h-3 w-3" />
                      </Link>
                    ))}
                </div>
              )}

              {result.source === 'fallback' && (
                <p className="pt-0.5 text-[11px] text-muted-foreground">
                  Réponse déterministe — assistant IA temporairement indisponible.
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
