'use client'

// Journal du chantier — LECTURE CHRONOLOGIQUE INTELLIGENTE (pas une liste).
// UNE seule source (getSiteChronicle). Chaque journée : un RÉSUMÉ (« Réunion ·
// 3 décisions · 4 actions »), puis les événements triés par IMPORTANCE (ce qui a
// fait évoluer le chantier d'abord), pas par ordre d'ajout. Filtres sur la même
// source. Les décisions/réserves rattachées à un sujet pointent vers son histoire.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ClipboardList, Hammer, Camera, FileText, ListTodo, Gavel, ClipboardCheck,
  Sparkles, History, AlertTriangle, StickyNote, ShieldAlert, ChevronRight,
} from 'lucide-react'
import type { ChronicleCategory, ChronicleEvent } from '@/lib/db/site-chronicle'

const CAT_META: Record<ChronicleCategory, { label: string; Icon: typeof ListTodo; cls: string }> = {
  meeting: { label: 'Réunions', Icon: ClipboardList, cls: 'text-violet-600' },
  intervention: { label: 'Interventions', Icon: Hammer, cls: 'text-indigo-600' },
  photo: { label: 'Photos', Icon: Camera, cls: 'text-sky-600' },
  document: { label: 'Documents', Icon: FileText, cls: 'text-teal-600' },
  action: { label: 'Actions', Icon: ListTodo, cls: 'text-sky-700' },
  decision: { label: 'Décisions', Icon: Gavel, cls: 'text-amber-700' },
  reserve: { label: 'Réserves', Icon: ClipboardCheck, cls: 'text-rose-600' },
  enrichment: { label: 'Enrichissements', Icon: History, cls: 'text-emerald-600' },
  ai: { label: 'IA', Icon: Sparkles, cls: 'text-violet-500' },
  anomaly: { label: 'Anomalies', Icon: AlertTriangle, cls: 'text-amber-600' },
  note: { label: 'Notes', Icon: StickyNote, cls: 'text-muted-foreground' },
  blocage: { label: 'Blocages', Icon: ShieldAlert, cls: 'text-rose-700' },
}

// IMPORTANCE intra-journée (Vincent 2026-06-26) : « ce qui a fait évoluer le
// chantier » d'abord. Réunion → Décision → Blocage/Réserve/Anomalie → Action →
// Intervention → Document → Photo/Note → IA/Enrichissement.
const RANK: Record<ChronicleCategory, number> = {
  meeting: 1, decision: 2, blocage: 3, reserve: 3, anomaly: 3,
  action: 4, intervention: 5, document: 6, photo: 7, note: 7, ai: 8, enrichment: 8,
}

// Ordre des filtres (= ordre d'importance).
const CAT_ORDER: ChronicleCategory[] = [
  'meeting', 'decision', 'blocage', 'reserve', 'anomaly', 'action',
  'intervention', 'document', 'photo', 'note', 'ai', 'enrichment',
]

const plural = (n: number) => (n > 1 ? 's' : '')
function summaryLabel(c: ChronicleCategory, n: number): string {
  switch (c) {
    case 'meeting': return n === 1 ? 'Réunion' : `${n} réunions`
    case 'decision': return `${n} décision${plural(n)}`
    case 'blocage': return `${n} blocage${plural(n)}`
    case 'reserve': return `${n} réserve${plural(n)}`
    case 'anomaly': return `${n} anomalie${plural(n)}`
    case 'action': return `${n} action${plural(n)}`
    case 'intervention': return `${n} intervention${plural(n)}`
    case 'document': return `${n} document${plural(n)}`
    case 'photo': return `${n} photo${plural(n)}`
    case 'note': return `${n} note${plural(n)}`
    case 'ai': return `${n} résonance${plural(n)}`
    case 'enrichment': return `${n} enrichissement${plural(n)}`
  }
}

function daySummary(items: ChronicleEvent[]): string {
  const counts = new Map<ChronicleCategory, number>()
  for (const e of items) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => RANK[a[0]] - RANK[b[0]])
    .map(([c, n]) => summaryLabel(c, n))
    .join(' · ')
}

function frDay(dayIso: string): string {
  const d = new Date(dayIso)
  if (isNaN(d.getTime())) return ''
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function SiteChronicleView({ events }: { siteId: string; events: ChronicleEvent[] }) {
  const [filter, setFilter] = useState<ChronicleCategory | null>(null)

  const present = useMemo(() => {
    const s = new Set(events.map((e) => e.category))
    return CAT_ORDER.filter((c) => s.has(c))
  }, [events])

  const visible = filter ? events.filter((e) => e.category === filter) : events

  // Regroupe par jour, puis trie CHAQUE journée par importance (et heure ensuite).
  const days = useMemo(() => {
    const map = new Map<string, ChronicleEvent[]>()
    for (const e of visible) {
      const day = e.date.slice(0, 10)
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(e)
    }
    for (const items of map.values()) {
      items.sort((a, b) => RANK[a.category] - RANK[b.category] || (a.date < b.date ? 1 : -1))
    }
    return [...map.entries()] // déjà du jour le plus récent au plus ancien (events triés)
  }, [visible])

  return (
    <div className="space-y-4">
      {/* Filtres — défaut « Tout », sur la même source. */}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFilter(null)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === null ? 'bg-foreground text-background' : 'bg-muted hover:bg-muted/70'}`}>
          Tout ({events.length})
        </button>
        {present.map((c) => {
          const n = events.filter((e) => e.category === c).length
          return (
            <button key={c} type="button" onClick={() => setFilter(c)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${filter === c ? 'bg-foreground text-background' : 'bg-muted hover:bg-muted/70'}`}>
              {CAT_META[c].label} ({n})
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Rien à afficher pour ce filtre.</p>
      ) : (
        <div className="space-y-6">
          {days.map(([day, items]) => (
            <div key={day} className="space-y-2">
              {/* En-tête de journée : date + résumé de ce qui s'est passé. */}
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold">{frDay(day)}</h3>
                <p className="text-xs text-muted-foreground">{daySummary(items)}</p>
              </div>
              <ol className="space-y-0 border-l-2 border-muted pl-3">
                {items.map((e) => {
                  const meta = CAT_META[e.category]
                  const Icon = meta.Icon
                  const inner = (
                    <div className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.cls}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{e.title}</p>
                        {e.detail && <p className="truncate text-xs text-muted-foreground">{e.detail}</p>}
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {meta.label.replace(/s$/, '')}{e.subjectLabel ? ` · ${e.subjectLabel}` : ''}
                        </span>
                      </div>
                      {e.href && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                    </div>
                  )
                  return (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[17px] top-3 h-2 w-2 rounded-full bg-foreground/40" />
                      {e.href ? <Link href={e.href} className="block transition hover:bg-muted/40 rounded-lg">{inner}</Link> : inner}
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
