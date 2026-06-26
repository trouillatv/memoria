'use client'

// « Interroger cette réunion » — agent scopé à UNE réunion (≠ Atelier mémoire du
// site). L'agent synthétise (propose, ne décide pas), cite des extraits verbatim
// courts, et affiche les sources mobilisées (transcription, décisions, actions…).

import { useState, useTransition } from 'react'
import { MessageCircleQuestion, Send, Loader2, Quote } from 'lucide-react'
import { askMeetingAction, type MeetingAnswer } from './ask-meeting-actions'

const SUGGESTIONS = [
  'Résume les décisions',
  'Liste les actions demandées',
  'Quels points sont à confirmer ?',
  'Qui doit faire quoi ?',
  'Quels points sont restés flous ?',
]

export function MeetingChat({ reportId }: { reportId: string }) {
  const [q, setQ] = useState('')
  const [askedQ, setAskedQ] = useState('')
  const [answer, setAnswer] = useState<MeetingAnswer | null>(null)
  const [basedOn, setBasedOn] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [mock, setMock] = useState(false)
  const [pending, start] = useTransition()

  function ask(question: string) {
    const qq = question.trim()
    if (qq.length < 3) return
    setError(null); setAskedQ(qq); setQ(qq)
    start(async () => {
      const r = await askMeetingAction(reportId, qq)
      if (r.ok) { setAnswer(r.answer); setBasedOn(r.basedOn); setMock(r.mock) }
      else { setError(r.error); setAnswer(null); setBasedOn([]) }
    })
  }

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="h-4 w-4 text-violet-600" />
        <h2 className="text-sm font-semibold">Interroger cette réunion</h2>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Répond uniquement à partir de cette réunion (transcription, décisions, actions, participants).
      </p>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => ask(s)}
            className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qu’a-t-on dit sur… ?"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <button type="submit" disabled={pending || q.trim().length < 3}
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {answer && (
        <div className="space-y-3 border-t pt-3">
          {askedQ && <p className="text-xs text-muted-foreground">Question : {askedQ}</p>}
          {answer.answer && <p className="whitespace-pre-line text-sm leading-relaxed">{answer.answer}</p>}

          {/* Citations verbatim — grounding sur la transcription. */}
          {answer.citations.length > 0 && (
            <ul className="space-y-1.5">
              {answer.citations.map((c, i) => (
                <li key={i} className="flex gap-2 rounded-lg border-l-2 border-violet-300 bg-muted/40 px-3 py-1.5 text-xs italic text-muted-foreground">
                  <Quote className="h-3 w-3 shrink-0 mt-0.5 text-violet-400" />
                  <span>« {c} »</span>
                </li>
              ))}
            </ul>
          )}

          {/* Sources mobilisées — déterministes. */}
          {basedOn.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Réponse basée sur :</span>
              {basedOn.map((s) => (
                <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{s}</span>
              ))}
            </div>
          )}

          {mock && <p className="text-[11px] italic text-muted-foreground/70">Réponse de démonstration — aucune clé IA configurée (sources réelles).</p>}
        </div>
      )}
    </section>
  )
}
