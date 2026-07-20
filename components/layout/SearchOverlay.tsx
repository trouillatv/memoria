'use client'

// Phase 2.3 — Overlay de recherche transversale dans la mémoire.
//
// Trigger : bouton « Rechercher » dans la topbar OU raccourci ⌘K / Ctrl+K.
// Interroge la RPC search_memory (migration 044) via une server action.
// Pas de page dédiée — overlay modal pour ne pas casser le contexte.

import { useState, useEffect, useTransition, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { 
  UserSquare, Search, Users, X, AlertTriangle, FileText, Camera, MapPin, ListTodo, FileCheck2,
  ShieldCheck, Eye, Gavel, Lightbulb, Ban, ClipboardCheck, GitBranch, BookOpen, CalendarClock } from 'lucide-react'
import { searchMemoryAction } from './search-action'
import type { MemoryHit, MemoryHitType } from '@/lib/db/memory-search'
import { memoryHitHref } from '@/lib/memory/hit-href'
import { HIT_LABEL_FR } from '@/lib/memory/search-grouping'

// Un seul vocabulaire pour toutes les surfaces de recherche (⌘K et /recherche) :
// deux listes de libellés divergeraient au premier ajout de corpus.
const TYPE_LABEL: Record<MemoryHitType, string> = HIT_LABEL_FR

const TYPE_ICON: Record<MemoryHitType, React.ComponentType<{ className?: string }>> = {
  anomaly: AlertTriangle,
  site_note: MapPin,
  intervention: FileText,
  photo: Camera,
  site_action: ListTodo,
  meeting_decision: FileCheck2,
  meeting: Users,
  intervenant: UserSquare,
  site_reserve: ShieldCheck,
  site_deadline: CalendarClock,
  report_document: FileText,
  // Mig 200 — le reste de la mémoire.
  observation: Eye,
  site_decision: Gavel,
  knowledge: Lightbulb,
  blocage: Ban,
  obligation: ClipboardCheck,
  subject: GitBranch,
  document: BookOpen,
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const days = Math.round(diff / 86400000)
  if (days < 1) return "aujourd'hui"
  if (days < 7) return `il y a ${days}j`
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function SearchOverlay() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<MemoryHit[]>([])
  const [pending, startTransition] = useTransition()
  // Le résultat visé par le clavier. Index dans l'ordre AFFICHÉ, pas dans
  // l'ordre de pertinence : ce que ↓ suit, c'est ce que l'œil suit.
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const runSearch = useCallback((query: string) => {
    if (query.trim().length < 2) {
      setHits([])
      return
    }
    startTransition(async () => {
      const result = await searchMemoryAction(query)
      setHits(result)
      // La sélection repart en tête avec les nouveaux résultats, sinon Entrée
      // ouvrirait un objet qui n'est plus celui qu'on regarde. Ici, à la source,
      // plutôt que dans un effet qui réagirait après coup.
      setSel(0)
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) {
      // Focus input à l'ouverture après le rendu.
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQ('')
      setHits([])
    }
  }, [open])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(q), 250)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [q, runSearch])

  function navigate(hit: MemoryHit) {
    setOpen(false)
    // L'overlay avait sa PROPRE règle de destination — toujours la fiche site —
    // pendant que /recherche utilisait memoryHitHref(). Deux portes, deux
    // comportements : corriger la fonction n'aurait ouvert que l'une des deux.
    // Une seule règle de destination, partagée.
    router.push(memoryHitHref(hit))
  }

  const groupedHits = hits.reduce<Record<MemoryHitType, MemoryHit[]>>((acc, hit) => {
    if (!acc[hit.type]) acc[hit.type] = []
    acc[hit.type].push(hit)
    return acc
  }, {} as Record<MemoryHitType, MemoryHit[]>)

  // L'ordre AFFICHÉ, aplati. Les résultats sont regroupés par type, donc l'ordre
  // à l'écran n'est pas celui de `hits` : le clavier doit suivre les yeux, pas
  // la pertinence brute.
  const ordreAffiche = (Object.values(groupedHits) as MemoryHit[][]).flat()

  function toucheDansChamp(e: React.KeyboardEvent<HTMLInputElement>) {
    if (ordreAffiche.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault() // sinon le curseur file en fin de saisie
      setSel((i) => (i + 1) % ordreAffiche.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((i) => (i - 1 + ordreAffiche.length) % ordreAffiche.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // À défaut de sélection explicite, on ouvre le premier : taper puis
      // valider est le geste le plus courant.
      navigate(ordreAffiche[sel] ?? ordreAffiche[0])
    }
  }

  // Garder le résultat visé à l'écran quand on descend au-delà du pli.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${sel}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        title="Rechercher dans la mémoire (⌘K)"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Rechercher</span>
        <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border bg-muted/30 px-1 py-0.5 text-[10px] font-mono">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              {/* Le clavier reste DANS le champ : on continue de taper pendant
                  qu'on parcourt. D'où aria-activedescendant plutôt qu'un focus
                  déplacé — un lecteur d'écran annonce le résultat visé sans que
                  la saisie perde le focus. */}
              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={toucheDansChamp}
                placeholder="Chercher dans la mémoire : anomalie, note, photo…"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                role="combobox"
                aria-expanded={ordreAffiche.length > 0}
                aria-controls="recherche-resultats"
                aria-autocomplete="list"
                aria-activedescendant={
                  ordreAffiche.length > 0 ? `recherche-resultat-${sel}` : undefined
                }
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
              {q.trim().length < 2 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Tape au moins 2 caractères pour chercher.
                </p>
              ) : pending && hits.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">Recherche…</p>
              ) : hits.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Aucun résultat pour « {q} ».
                </p>
              ) : (
                <div className="py-1" id="recherche-resultats" role="listbox">
                  {(Object.entries(groupedHits) as [MemoryHitType, MemoryHit[]][]).map(([type, items]) => {
                    const Icon = TYPE_ICON[type]
                    return (
                      <div key={type} role="group" aria-label={TYPE_LABEL[type]}>
                        <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/20">
                          {TYPE_LABEL[type]} ({items.length})
                        </div>
                        {items.map((hit) => {
                          const index = ordreAffiche.indexOf(hit)
                          const vise = index === sel
                          return (
                          <button
                            key={`${hit.type}-${hit.id}`}
                            type="button"
                            id={`recherche-resultat-${index}`}
                            data-index={index}
                            role="option"
                            aria-selected={vise}
                            tabIndex={-1}
                            onMouseEnter={() => setSel(index)}
                            onClick={() => navigate(hit)}
                            className={`w-full text-left px-4 py-2.5 transition-colors border-b last:border-b-0 flex items-start gap-3 ${vise ? 'bg-muted/50' : 'hover:bg-muted/30'}`}
                          >
                            <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{hit.title || '—'}</div>
                              {hit.snippet && hit.snippet !== hit.title && (
                                <div className="text-xs text-muted-foreground truncate mt-0.5">{hit.snippet}</div>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                              {formatDate(hit.occurredAt)}
                            </span>
                          </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
