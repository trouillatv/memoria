'use client'

// « Interroger la mémoire de ce site » — PAS un chat généraliste. Questions
// suggérées + une zone de saisie. L'agent synthétise depuis le digest du chantier
// (il propose, il ne décide pas). MVP : une question → une réponse (historique
// de conversation = plus tard).

import { useState, useTransition } from 'react'
import { Sparkles, Send, Loader2, Lightbulb, ArrowRight } from 'lucide-react'
import { askSiteMemoryAction, type SiteMemoryAnswer } from './actions'

const SUGGESTIONS = [
  'Résume-moi ce chantier.',
  'Qu’est-ce qui bloque sur ce chantier ?',
  'Quelles actions sont encore ouvertes ?',
  'Quelles décisions ont été prises récemment ?',
  'Qu’est-ce qui a changé depuis la dernière réunion ?',
  'Prépare un point chantier pour demain.',
]

export function SiteMemoryChat({ siteId }: { siteId: string }) {
  const [q, setQ] = useState('')
  const [askedQ, setAskedQ] = useState('')
  const [answer, setAnswer] = useState<SiteMemoryAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mock, setMock] = useState(false)
  const [pending, start] = useTransition()

  function ask(question: string) {
    const qq = question.trim()
    if (qq.length < 3) return
    setError(null)
    setAskedQ(qq)
    setQ(qq)
    start(async () => {
      const r = await askSiteMemoryAction(siteId, qq)
      if (r.ok) { setAnswer(r.answer); setMock(r.mock) } else { setError(r.error); setAnswer(null) }
    })
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-600" />
        <h2 className="text-sm font-semibold">Interroger la mémoire de ce site</h2>
      </div>

      {/* Questions suggérées — pas « posez n'importe quelle question ». */}
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => ask(s)}
            className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>

      {/* Saisie libre. */}
      <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Poser une question sur ce chantier…"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <button type="submit" disabled={pending || q.trim().length < 3}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {/* Réponse. */}
      {answer && (
        <div className="space-y-3 border-t pt-3">
          {askedQ && <p className="text-xs text-muted-foreground">Question : {askedQ}</p>}
          {answer.answer && <p className="whitespace-pre-line text-sm leading-relaxed">{answer.answer}</p>}

          {answer.retiens.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Lightbulb className="h-3.5 w-3.5 text-amber-600" /> À retenir
              </div>
              <ul className="space-y-1 text-sm">{answer.retiens.map((x, i) => <li key={i}>• {x}</li>)}</ul>
            </div>
          )}

          {answer.next.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ArrowRight className="h-3.5 w-3.5 text-sky-600" /> Prochains points (à votre main)
              </div>
              <ul className="space-y-1 text-sm">{answer.next.map((x, i) => <li key={i}>• {x}</li>)}</ul>
            </div>
          )}

          {mock && <p className="text-[11px] italic text-muted-foreground/70">Réponse de démonstration — aucune clé IA configurée.</p>}
        </div>
      )}
    </section>
  )
}
