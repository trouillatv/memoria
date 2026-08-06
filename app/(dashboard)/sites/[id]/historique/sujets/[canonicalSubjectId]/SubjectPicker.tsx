'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Search, Plus, Loader2, ChevronDown, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SubjectPickerItem } from '@/lib/db/canonical-subject-life'
import { createCanonicalSubjectForLink } from './link-actions'

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function matchesQuery(item: SubjectPickerItem, q: string): boolean {
  const n = normalize(q)
  if (normalize(item.label).includes(n)) return true
  return item.aliases.some((a) => normalize(a).includes(n))
}

const FAMILY_LABELS: Record<string, string> = {
  observation: 'Obs.',
  reservation: 'Réserve',
  non_conformity: 'NC',
  action: 'Action',
  decision: 'Décision',
  knowledge_fact: 'Info',
  deadline: 'Échéance',
}

// ── Sous-composants ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  )
}

function ItemRow({ item, onSelect }: { item: SubjectPickerItem; onSelect: (item: SubjectPickerItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="flex w-full flex-col items-start px-4 py-2 text-left hover:bg-accent"
    >
      <span className="text-sm font-medium leading-snug">{item.label}</span>
      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {item.family && (
          <span className="rounded bg-muted px-1 py-0.5 font-medium">
            {FAMILY_LABELS[item.family] ?? item.family}
          </span>
        )}
        {item.pvCount > 0 && <span>{item.pvCount} PV</span>}
        {item.status !== 'active' && (
          <span className="rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            {item.status === 'merged' ? 'Fusionné' : 'Divisé'}
          </span>
        )}
      </span>
    </button>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────

interface Props {
  items: SubjectPickerItem[]
  name: string
  siteId: string
  required?: boolean
}

export default function SubjectPicker({ items, name, siteId, required }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [localItems, setLocalItems] = useState(items)
  const [isPending, startTransition] = useTransition()
  const searchRef = useRef<HTMLInputElement>(null)

  const selectedItem = localItems.find((i) => i.id === selectedId)

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
    else setQuery('')
  }, [open])

  function handleSelect(item: SubjectPickerItem) {
    setSelectedId(item.id)
    setOpen(false)
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedId('')
  }

  function handleCreate() {
    const label = query.trim()
    if (!label) return
    startTransition(async () => {
      const result = await createCanonicalSubjectForLink(siteId, label)
      if ('id' in result) {
        const newItem: SubjectPickerItem = {
          id: result.id,
          label: result.label,
          aliases: [],
          status: 'active',
          family: null,
          pvCount: 0,
          coOccurrenceCount: 0,
        }
        setLocalItems((prev) => [...prev, newItem])
        handleSelect(newItem)
      }
    })
  }

  // ── Sections (mode exploration) ───────────────────────────────────────────

  const nearby = localItems
    .filter((i) => i.coOccurrenceCount > 0)
    .sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount)
    .slice(0, 6)
  const nearbyIds = new Set(nearby.map((i) => i.id))

  const activeItems = localItems.filter((i) => i.status === 'active' && !nearbyIds.has(i.id))
  const archivedItems = localItems.filter((i) => i.status !== 'active')

  // ── Résultats de recherche ────────────────────────────────────────────────

  const searchResults = query.length >= 2
    ? localItems.filter((i) => matchesQuery(i, query)).slice(0, 12)
    : []

  const isSearching = query.length >= 2

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <>
      <input type="hidden" name={name} value={selectedId} required={required} />

      {/* Déclencheur */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm hover:bg-muted/40"
      >
        {selectedItem ? (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{selectedItem.label}</span>
            <X
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={handleClear}
            />
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Choisir un sujet…</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>

      {/* Panneau */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[80vh] max-w-lg flex-col gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">Choisir un sujet</DialogTitle>

          {/* Barre de recherche */}
          <div className="border-b px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher dans les sujets du chantier…"
                className="h-9 w-full rounded-md bg-muted/50 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Corps scrollable */}
          <div className="flex-1 overflow-y-auto pb-2">
            {isSearching ? (
              /* ── Mode recherche ── */
              <>
                {searchResults.length > 0 ? (
                  <>
                    <SectionHeading>Résultats</SectionHeading>
                    {searchResults.map((item) => (
                      <ItemRow key={item.id} item={item} onSelect={handleSelect} />
                    ))}
                  </>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground">Aucun sujet correspondant</p>
                )}
                {/* Créer */}
                <div className="mt-1 border-t px-4 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Aucun de ceux-ci ?
                  </p>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={isPending}
                    className="flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Créer un nouveau sujet &ldquo;{query.trim()}&rdquo;
                  </button>
                </div>
              </>
            ) : (
              /* ── Mode exploration ── */
              <>
                {nearby.length > 0 && (
                  <>
                    <SectionHeading>Sujets proches</SectionHeading>
                    {nearby.map((item) => (
                      <ItemRow key={item.id} item={item} onSelect={handleSelect} />
                    ))}
                  </>
                )}

                {activeItems.length > 0 && (
                  <>
                    <SectionHeading>Tous les sujets actifs</SectionHeading>
                    {activeItems.map((item) => (
                      <ItemRow key={item.id} item={item} onSelect={handleSelect} />
                    ))}
                  </>
                )}

                {archivedItems.length > 0 && (
                  <>
                    <SectionHeading>Archivés / fusionnés</SectionHeading>
                    {archivedItems.map((item) => (
                      <ItemRow key={item.id} item={item} onSelect={handleSelect} />
                    ))}
                  </>
                )}

                {/* Créer en bas */}
                <div className="mt-1 border-t px-4 py-3">
                  <p className="mb-0.5 text-xs text-muted-foreground">
                    Le sujet que vous cherchez n&apos;apparaît pas ?
                  </p>
                  <button
                    type="button"
                    onClick={() => searchRef.current?.focus()}
                    className="text-sm text-primary hover:underline"
                  >
                    Recherchez-le d&apos;abord, puis créez-le si besoin.
                  </button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
