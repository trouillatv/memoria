'use client'

// « Interroger la mémoire de ce chantier ». L'agent synthétise (propose, ne décide
// pas) + preuves + confiance. NAVIGATION (cran 5/6) : l'unité n'est pas l'objet
// mais le SUJET. L'agent extrait les CONCEPTS centraux de sa réponse → boutons
// d'exploration → TIMELINE du sujet (l'histoire), filtre par type secondaire.

import { useState, useTransition } from 'react'
import { Sparkles, Send, Loader2, Lightbulb, ArrowRight, ExternalLink, Compass, X, Clock } from 'lucide-react'
import { askSiteMemoryAgentAction, getSubjectMemoryTimelineAction, type SiteMemoryAnswer, type SiteMemorySource, type SiteMemoryTimelineItem } from './actions'

const SUGGESTIONS = [
  'Résume-moi ce chantier.',
  'Qu’est-ce qui bloque sur ce chantier ?',
  'Quelles actions sont encore ouvertes ?',
  'Quelles décisions ont été prises récemment ?',
  'Qu’est-ce qui a changé depuis la dernière réunion ?',
  'Prépare un point chantier pour demain.',
]

const SRC_LABEL: Record<string, string> = {
  anomaly: 'Anomalie', site_note: 'Note', intervention: 'Intervention', photo: 'Photo',
  site_action: 'Action', meeting_decision: 'Décision', site_reserve: 'Réserve',
  report_document: 'Compte-rendu', document: 'Document',
}
const KIND_LABEL: Record<string, string> = {
  ...SRC_LABEL,
  decision: 'Décision', action: 'Action', reserve: 'Réserve', cr_decision: 'Décision (CR)',
  obligation: 'Obligation', origin: 'Origine',
}
const CONF_META: Record<string, { l: string; cls: string }> = {
  forte: { l: 'Forte', cls: 'bg-emerald-50 text-emerald-700' },
  moyenne: { l: 'Moyenne', cls: 'bg-amber-50 text-amber-800' },
  faible: { l: 'Faible', cls: 'bg-muted text-muted-foreground' },
}
function frDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
const labelPlural = (t: string, n: number) => { const l = SRC_LABEL[t] ?? t; return `${l}${n > 1 && !l.endsWith('s') ? 's' : ''}` }

function SourceCard({ s }: { s: SiteMemorySource }) {
  const inner = (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{SRC_LABEL[s.type] ?? s.type}</span>
        {s.occurredAt && <span>{frDate(s.occurredAt)}</span>}
        {s.href && <ExternalLink className="ml-auto h-3 w-3" />}
      </div>
      {s.title && <p className="mt-0.5 text-sm font-medium">{s.title}</p>}
      {s.snippet && <p className="text-xs text-muted-foreground line-clamp-2">{s.snippet}</p>}
    </div>
  )
  return s.href ? <a href={s.href} className="block transition hover:border-foreground/30">{inner}</a> : inner
}

export function SiteMemoryChat({ siteId }: { siteId: string }) {
  const [q, setQ] = useState('')
  const [askedQ, setAskedQ] = useState('')
  const [answer, setAnswer] = useState<SiteMemoryAnswer | null>(null)
  const [sources, setSources] = useState<SiteMemorySource[]>([])
  const [confidence, setConfidence] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mock, setMock] = useState(false)
  const [pending, start] = useTransition()
  // Timeline d'un sujet (navigation).
  const [tl, setTl] = useState<{ subject: string | null; concept: string; items: SiteMemoryTimelineItem[] } | null>(null)
  const [tlFilter, setTlFilter] = useState<string | null>(null)
  const [tlLoading, startTl] = useTransition()

  function ask(question: string) {
    const qq = question.trim()
    if (qq.length < 3) return
    setError(null); setAskedQ(qq); setQ(qq); setTl(null); setTlFilter(null)
    start(async () => {
      const r = await askSiteMemoryAgentAction(siteId, qq)
      if (r.ok) { setAnswer(r.answer); setSources(r.sources); setConfidence(r.confidence); setMock(r.mock) }
      else { setError(r.error); setAnswer(null); setSources([]); setConfidence(null) }
    })
  }

  function openTimeline(concept: string) {
    setTlFilter(null)
    startTl(async () => {
      const r = await getSubjectMemoryTimelineAction(siteId, concept)
      if (r.ok) setTl({ subject: r.subjectName, concept, items: r.items })
    })
  }

  const conf = confidence ? CONF_META[confidence] : null
  const breakdown = sources.reduce<Record<string, number>>((a, s) => { a[s.type] = (a[s.type] ?? 0) + 1; return a }, {})
  const tlKinds = tl ? Array.from(new Set(tl.items.map((i) => i.kind))) : []
  const tlVisible = tl ? tl.items.filter((i) => !tlFilter || i.kind === tlFilter) : []

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-600" />
        <h2 className="text-sm font-semibold">Interroger la mémoire de ce chantier</h2>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => ask(s)}
            className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(q) }} className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Poser une question sur ce chantier…"
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

          {/* Explorer par CONCEPT (cran 6) — l'agent sait de quoi il parle. */}
          {answer.concepts.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Compass className="h-3.5 w-3.5" /> Explorer :</span>
              {answer.concepts.map((c) => (
                <button key={c} type="button" disabled={tlLoading} onClick={() => openTimeline(c)}
                  className="rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50 dark:bg-violet-950/30 dark:text-violet-200">
                  {c}
                </button>
              ))}
              {tlLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
          )}

          {/* Preuves (ventilation informative). */}
          {sources.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Cette réponse mobilise :</span>
                {Object.entries(breakdown).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                  <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{n} {labelPlural(t, n)}</span>
                ))}
                {conf && <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${conf.cls}`}>Confiance : {conf.l}</span>}
              </div>
              <ul className="space-y-1.5">{sources.map((s, i) => <li key={i}><SourceCard s={s} /></li>)}</ul>
            </div>
          )}

          {/* TIMELINE du sujet — l'histoire (cran 5). Chronologie d'abord, type ensuite. */}
          {tl !== null && (
            <div className="space-y-2 rounded-xl border bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {tl.subject ? `Histoire du sujet « ${tl.subject} »` : `Mémoire · « ${tl.concept} »`}
                </span>
                <button type="button" onClick={() => { setTl(null); setTlFilter(null) }} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>

              {tl.items.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucune trace pour « {tl.concept} ».</p>
              ) : (
                <>
                  {/* Filtre par type — SECONDAIRE. */}
                  {tlKinds.length > 1 && (
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" onClick={() => setTlFilter(null)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tlFilter === null ? 'bg-foreground text-background' : 'bg-muted hover:bg-muted/70'}`}>Chronologie</button>
                      {tlKinds.map((k) => (
                        <button key={k} type="button" onClick={() => setTlFilter(k)}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tlFilter === k ? 'bg-foreground text-background' : 'bg-muted hover:bg-muted/70'}`}>{KIND_LABEL[k] ?? k}</button>
                      ))}
                    </div>
                  )}

                  {/* La chronologie. */}
                  <ol className="max-h-96 space-y-0 overflow-auto border-l-2 border-muted pl-3">
                    {tlVisible.map((it, i) => (
                      <li key={i} className="relative pb-3">
                        <span className="absolute -left-[17px] top-1 h-2 w-2 rounded-full bg-foreground/40" />
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{frDate(it.date)}</span>
                          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{KIND_LABEL[it.kind] ?? it.kind}</span>
                        </div>
                        <p className="text-sm">{it.label}</p>
                        {it.meta && <p className="text-xs text-muted-foreground">{it.meta}</p>}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}

          {mock && <p className="text-[11px] italic text-muted-foreground/70">Réponse de démonstration — aucune clé IA configurée (preuves & timeline réelles).</p>}
        </div>
      )}
    </section>
  )
}
