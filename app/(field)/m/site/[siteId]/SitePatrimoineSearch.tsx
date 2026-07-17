'use client'

// LA porte d'entrée du patrimoine : « Retrouve-moi ce que je sais sur ce chantier. »
// Recherche transversale, résultats REGROUPÉS par type (pas une liste chrono).
// Quand la recherche est vide : les sujets les plus fréquents comme suggestions.
// Déterministe, zéro IA. Cf. searchPatrimoineAction.

import { useEffect, useState, useTransition } from 'react'
import {
  Search, Camera, Pencil, AlertTriangle, ListTodo, Gavel, FileText, Wrench, X,
  Eye, Lightbulb, Ban, ClipboardCheck, GitBranch, BookOpen, CalendarClock,
} from 'lucide-react'
import { searchPatrimoineAction, type SearchPatrimoineResult } from './patrimoine-actions'
import type { MemoryHitType } from '@/lib/db/memory-search'

const META: Record<MemoryHitType, { label: string; Icon: typeof Camera; cls: string; ring: string }> = {
  photo: { label: 'Photos', Icon: Camera, cls: 'text-sky-600', ring: 'bg-sky-100 dark:bg-sky-950/40' },
  site_note: { label: 'Notes', Icon: Pencil, cls: 'text-slate-600', ring: 'bg-slate-100 dark:bg-slate-800/60' },
  site_reserve: { label: 'Réserves', Icon: AlertTriangle, cls: 'text-rose-600', ring: 'bg-rose-100 dark:bg-rose-950/40' },
  site_deadline: { label: 'Échéances', Icon: CalendarClock, cls: 'text-emerald-600', ring: 'bg-emerald-100 dark:bg-emerald-950/40' },
  site_action: { label: 'Actions', Icon: ListTodo, cls: 'text-violet-600', ring: 'bg-violet-100 dark:bg-violet-950/40' },
  meeting_decision: { label: 'Décisions', Icon: Gavel, cls: 'text-indigo-600', ring: 'bg-indigo-100 dark:bg-indigo-950/40' },
  report_document: { label: 'Documents', Icon: FileText, cls: 'text-slate-600', ring: 'bg-slate-100 dark:bg-slate-800/60' },
  intervention: { label: 'Interventions', Icon: Wrench, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40' },
  anomaly: { label: 'Anomalies', Icon: AlertTriangle, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40' },
  // Mig 200 — le reste de la mémoire entre dans la recherche.
  observation: { label: 'Observations', Icon: Eye, cls: 'text-teal-600', ring: 'bg-teal-100 dark:bg-teal-950/40' },
  site_decision: { label: 'Décisions', Icon: Gavel, cls: 'text-indigo-600', ring: 'bg-indigo-100 dark:bg-indigo-950/40' },
  knowledge: { label: 'Connaissances', Icon: Lightbulb, cls: 'text-amber-600', ring: 'bg-amber-100 dark:bg-amber-950/40' },
  blocage: { label: 'Blocages', Icon: Ban, cls: 'text-rose-600', ring: 'bg-rose-100 dark:bg-rose-950/40' },
  obligation: { label: 'Obligations', Icon: ClipboardCheck, cls: 'text-slate-600', ring: 'bg-slate-100 dark:bg-slate-800/60' },
  subject: { label: 'Sujets suivis', Icon: GitBranch, cls: 'text-brand-700', ring: 'bg-brand-100 dark:bg-brand-950/40' },
  document: { label: 'Documents', Icon: BookOpen, cls: 'text-indigo-600', ring: 'bg-indigo-100 dark:bg-indigo-950/40' },
}

export function SitePatrimoineSearch({ siteId, suggestions }: { siteId: string; suggestions: string[] }) {
  const [q, setQ] = useState('')
  const [result, setResult] = useState<SearchPatrimoineResult | null>(null)
  const [pending, startTransition] = useTransition()

  // Recherche vivante, débouncée : on tape, MemorIA retrouve.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResult(null); return }
    const t = setTimeout(() => {
      startTransition(async () => {
        const r = await searchPatrimoineAction(siteId, term)
        setResult(r)
      })
    }, 350)
    return () => clearTimeout(t)
  }, [q, siteId])

  const empty = q.trim().length < 2

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher dans ce chantier…"
          className="w-full rounded-xl border border-input bg-background py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
          enterKeyHint="search"
        />
        {q && (
          <button type="button" onClick={() => setQ('')} aria-label="Effacer" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Recherche vide → suggestions = sujets les plus fréquents (déterministe). */}
      {empty && suggestions.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recherches fréquentes</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQ(s)}
                className="rounded-full border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground active:bg-accent"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Résultats regroupés par type. */}
      {!empty && (
        <div className="space-y-2">
          {pending && !result && <p className="px-1 py-2 text-sm text-muted-foreground">Recherche…</p>}
          {result?.ok && result.total === 0 && (
            <p className="rounded-xl border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              Rien trouvé pour « {result.q} » dans ce chantier.
            </p>
          )}
          {result?.ok && result.groups.map((g) => {
            const m = META[g.type]
            return (
              <div key={g.type} className="rounded-2xl border bg-background p-3.5 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${m.ring}`}>
                    <m.Icon className={`h-[18px] w-[18px] ${m.cls}`} />
                  </span>
                  <p className="text-sm font-semibold">{m.label}</p>
                  <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{g.count}</span>
                </div>
                <ul className="mt-2 space-y-1.5 pl-[42px]">
                  {g.items.map((it) => (
                    <li key={it.id} className="text-[13px] leading-snug">
                      {it.title && <span className="font-medium">{it.title}</span>}
                      {it.title && it.snippet ? ' — ' : ''}
                      {it.snippet && <span className="text-muted-foreground">{it.snippet}</span>}
                    </li>
                  ))}
                  {g.count > g.items.length && (
                    <li className="text-[12px] text-muted-foreground">+{g.count - g.items.length} autre{g.count - g.items.length > 1 ? 's' : ''}</li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
