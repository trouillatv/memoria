'use client'

// 🔍 Interroger toute l'entreprise — UI P7 (cross-site, retrieval + synthèse).
// Question → dossier de traces de TOUS les chantiers (sémantique + plein-texte),
// chaque résultat attribué à SON SITE. MemorIA retrouve, il ne répond jamais à
// la place des preuves.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Search, Loader2, AlertTriangle, StickyNote, Camera, Wrench, MapPin, Sparkles, Flame, Activity, Archive, ShieldCheck, BookOpen, ListTodo, Flag, Hammer } from 'lucide-react'
import {
  askOrgMemoryAction,
  synthesizeOrgMemoryAction,
  type OrgMemoryHit,
  type OrgMemorySummary,
  type MemorySynthesis,
} from './org-memory-actions'

const CONFIDENCE_META: Record<OrgMemorySummary['confidence'], { label: string; cls: string }> = {
  forte:   { label: 'Confiance forte',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  moyenne: { label: 'Confiance moyenne', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  faible:  { label: 'Confiance faible',  cls: 'bg-slate-50 text-slate-600 border-slate-200' },
}

const EXAMPLES = ['fournisseur', 'infiltration', 'SOCOTEC', 'toiture', 'réserve']

const TYPE_META: Record<OrgMemoryHit['type'], { label: string; Icon: typeof StickyNote; cls: string }> = {
  anomaly:      { label: 'Anomalie',     Icon: AlertTriangle, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  site_note:    { label: 'Note',         Icon: StickyNote,    cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  intervention: { label: 'Intervention', Icon: Wrench,        cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  photo:        { label: 'Photo',        Icon: Camera,        cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  document:     { label: 'Document',     Icon: BookOpen,      cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  action:       { label: 'Action',       Icon: ListTodo,      cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  reserve:      { label: 'Réserve',      Icon: Flag,          cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  mission:      { label: 'Mission',      Icon: Hammer,        cls: 'bg-orange-50 text-orange-700 border-orange-200' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '' }
}

export function OrgMemoryQuery() {
  const [q, setQ] = useState('')
  const [searched, setSearched] = useState('')
  const [hits, setHits] = useState<OrgMemoryHit[] | null>(null)
  const [summary, setSummary] = useState<OrgMemorySummary | null>(null)
  const [synthesis, setSynthesis] = useState<MemorySynthesis | null>(null)
  const [synthPending, startSynth] = useTransition()
  const [pending, startTransition] = useTransition()

  function synthesize() {
    if (!hits || hits.length === 0) return
    startSynth(async () => {
      const r = await synthesizeOrgMemoryAction(searched, hits)
      setSynthesis(r.ok ? r.synthesis : { retiens: [], hypothesis: null, themes: [] })
    })
  }

  function runSearch(query: string) {
    const text = query.trim()
    if (text.length < 2) return
    setSearched(text); setSynthesis(null)
    startTransition(async () => {
      const r = await askOrgMemoryAction(text)
      setHits(r.ok ? r.hits : [])
      setSummary(r.ok ? r.summary : null)
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold inline-flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" /> Interroger l&apos;entreprise
        </h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          MemorIA retrouve dans la mémoire de tous les chantiers (anomalies, notes, interventions).
          Chaque trace est rattachée à son site&nbsp;: il ne répond pas à votre place.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); runSearch(q) }} className="flex items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
          placeholder="Que cherchez-vous dans toute l'entreprise ?"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={pending || q.trim().length < 2}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Chercher
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => { setQ(ex); runSearch(ex) }} disabled={pending}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50">
            {ex}
          </button>
        ))}
      </div>

      {/* ── Résultats ───────────────────────────────────────────────────── */}
      {pending && (
        <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recherche…
        </p>
      )}

      {!pending && hits !== null && (
        hits.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-3 text-center">
            Aucune trace ne correspond à «&nbsp;{searched}&nbsp;» dans l&apos;entreprise.
          </p>
        ) : (
          <div>
            {/* Synthèse encadrée (LLM) : réponse en tête, sources dessous */}
            <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-sky-600" /> Synthèse
                  <span className="rounded bg-sky-100 px-1 text-[9px] font-medium text-sky-700">IA</span>
                </h3>
                <button
                  type="button"
                  onClick={synthesize}
                  disabled={synthPending}
                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
                >
                  {synthPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {synthesis === null ? 'Synthétiser' : 'Régénérer'}
                </button>
              </div>
              {synthesis && synthesis.retiens.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ce qu&apos;il faut retenir</p>
                  <ul className="space-y-1">
                    {synthesis.retiens.map((t, i) => (
                      <li key={i} className="flex gap-1.5 text-sm text-sky-950">
                        <span aria-hidden className="text-sky-500">•</span>
                        <span className="min-w-0">{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {synthesis?.hypothesis && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Hypothèse · à confirmer</p>
                  <p className="mt-0.5 text-sm italic text-amber-900">{synthesis.hypothesis}</p>
                </div>
              )}
              {synthesis && synthesis.themes.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Thèmes observés</p>
                  <ul className="space-y-0.5">
                    {synthesis.themes.map((t, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm text-sky-950">
                        <span className="min-w-0">{t.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t.count} trace{t.count > 1 ? 's' : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {synthesis && synthesis.retiens.length === 0 && synthesis.themes.length === 0 && !synthPending && (
                <p className="text-xs italic text-muted-foreground">Pas de synthèse nette à dégager.</p>
              )}
              {synthesis !== null && (
                <p className="text-[10px] text-muted-foreground/70">
                  Synthèse à partir des traces ci-dessous — vérifiez les sources. Une hypothèse est une lecture plausible, pas une vérité.
                </p>
              )}
            </div>

            {/* Confiance + Importance — signal déterministe, zéro LLM */}
            {summary && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium ${CONFIDENCE_META[summary.confidence].cls}`}>
                  <ShieldCheck className="h-2.5 w-2.5" /> {CONFIDENCE_META[summary.confidence].label}
                </span>
                <span className="text-muted-foreground">
                  {summary.count} trace{summary.count > 1 ? 's' : ''} · {summary.distinctDays} date{summary.distinctDays > 1 ? 's' : ''}
                </span>
                {summary.recurring && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-medium text-rose-700">
                    <Flame className="h-2.5 w-2.5" /> Sujet récurrent
                  </span>
                )}
                {!summary.recurring && summary.last30dCount >= 3 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                    <Activity className="h-2.5 w-2.5" /> Sujet actif · {summary.last30dCount} sur 30 j
                  </span>
                )}
                {summary.spanDays !== null && summary.spanDays > 365 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-600">
                    <Archive className="h-2.5 w-2.5" /> Historique · sur {Math.round(summary.spanDays / 365)} an{summary.spanDays > 730 ? 's' : ''}
                  </span>
                )}
              </div>
            )}
            <ul className="space-y-1.5">
              {hits.map((h) => {
                const meta = TYPE_META[h.type]
                const Icon = meta.Icon
                const inner = (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>
                        <Icon className="h-2.5 w-2.5" /> {meta.label}
                      </span>
                      {h.sourceLabel ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-indigo-700">
                          <BookOpen className="h-2.5 w-2.5" /> {h.sourceLabel}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-foreground/80">
                          <MapPin className="h-2.5 w-2.5" /> {h.siteName}
                        </span>
                      )}
                      {h.occurredAt && <span className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(h.occurredAt)}</span>}
                      {h.similarity !== null && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700"><Sparkles className="h-2.5 w-2.5" />proche</span>
                      )}
                      {h.title && <span className="text-xs font-medium truncate">{h.title}</span>}
                    </div>
                    {h.snippet && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{h.snippet}</p>}
                  </>
                )
                return (
                  <li key={`${h.type}-${h.id}`}>
                    {h.siteId ? (
                      <Link href={`/sites/${h.siteId}`} className="block rounded-lg border bg-background p-2.5 hover:border-foreground/30 hover:bg-muted/30 transition-colors">
                        {inner}
                      </Link>
                    ) : (
                      <div className="block rounded-lg border bg-background p-2.5">{inner}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      )}
    </div>
  )
}
