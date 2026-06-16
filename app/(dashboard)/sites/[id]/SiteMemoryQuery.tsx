'use client'

// 🔍 Interroger ce site — UI Phase 1 (retrieval-only).
// Une question → un dossier de hits (type, date, extrait, lien). Jamais une
// réponse générée : MemorIA retrouve, il ne répond pas à la place des preuves.

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Search, Loader2, AlertTriangle, StickyNote, Camera, Wrench } from 'lucide-react'
import { askSiteMemoryAction, type SiteMemoryHit } from './memory-query-actions'

// Exemples = graines de requête (mots-clés). NB Phase 1 : recherche plein-texte,
// donc des MOTS du chantier marchent mieux qu'une question complète.
const EXAMPLES = ['réservation', 'étanchéité', 'accès', 'reprise', 'béton']

const TYPE_META: Record<SiteMemoryHit['type'], { label: string; Icon: typeof StickyNote; cls: string }> = {
  anomaly:      { label: 'Anomalie',     Icon: AlertTriangle, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  site_note:    { label: 'Note',         Icon: StickyNote,    cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  intervention: { label: 'Intervention', Icon: Wrench,        cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  photo:        { label: 'Photo',        Icon: Camera,        cls: 'bg-violet-50 text-violet-700 border-violet-200' },
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

export function SiteMemoryQuery({ siteId }: { siteId: string }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SiteMemoryHit[] | null>(null)
  const [searched, setSearched] = useState('')
  const [pending, startTransition] = useTransition()

  function run(query: string) {
    const text = query.trim()
    if (text.length < 2) return
    setSearched(text)
    startTransition(async () => {
      const r = await askSiteMemoryAction(siteId, text)
      setHits(r.ok ? r.hits : [])
    })
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold inline-flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" /> Interroger ce site
        </h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          MemorIA retrouve dans la mémoire du site (anomalies, notes, interventions, photos).
          Il ne répond pas à votre place&nbsp;: il vous montre les traces.
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); run(q) }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={200}
          placeholder="Que cherchez-vous sur ce site ?"
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
          <button
            key={ex}
            type="button"
            onClick={() => { setQ(ex); run(ex) }}
            disabled={pending}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {hits !== null && (
        <div className="pt-1">
          {hits.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">
              Aucune trace ne correspond à «&nbsp;{searched}&nbsp;» sur ce site.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground mb-2">
                {hits.length} trace{hits.length > 1 ? 's' : ''} pour «&nbsp;{searched}&nbsp;»
              </p>
              <ul className="space-y-1.5">
                {hits.map((h) => {
                  const meta = TYPE_META[h.type]
                  const Icon = meta.Icon
                  return (
                    <li key={`${h.type}-${h.id}`}>
                      <Link
                        href={h.href}
                        className="block rounded-lg border bg-background p-2.5 hover:border-foreground/30 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}>
                            <Icon className="h-2.5 w-2.5" /> {meta.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">{formatDate(h.occurredAt)}</span>
                          {h.title && <span className="text-xs font-medium truncate">{h.title}</span>}
                        </div>
                        {h.snippet && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{h.snippet}</p>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
