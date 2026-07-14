'use client'

// Combobox cross-contrat pour le sélecteur de site dans MissionEditor.
// Remplace le <select> natif (qui scale mal au-delà de ~20 sites). Inclut :
//  - filtre texte (insensible casse + accents)
//  - 2 sections : "Ce contrat" + "Autres sites du tenant"
//  - click extérieur, Esc, navigation flèches + Enter
//  - lecture seule en mode édition (le site n'est pas modifiable post-create)

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SiteOption {
  id: string
  name: string
  contract_name?: string | null
}

interface Props {
  sites: SiteOption[]
  otherSites?: SiteOption[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}

function normalize(s: string): string {
  return s
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function SiteSelector({ sites, otherSites = [], value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const all: Array<SiteOption & { group: 'current' | 'other' }> = useMemo(
    () => [
      ...sites.map((s) => ({ ...s, group: 'current' as const })),
      ...otherSites.map((s) => ({ ...s, group: 'other' as const })),
    ],
    [sites, otherSites],
  )

  const selected = all.find((s) => s.id === value)

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return all
    return all.filter((s) => {
      if (normalize(s.name).includes(q)) return true
      if (s.contract_name && normalize(s.contract_name).includes(q)) return true
      return false
    })
  }, [all, query])

  // Click extérieur ferme.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Focus l'input au open.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
      setHighlight(0)
    }
  }, [open])

  function commit(id: string) {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = filtered[highlight]
      if (target) commit(target.id)
    }
  }

  const currentItems = filtered.filter((s) => s.group === 'current')
  const otherItems = filtered.filter((s) => s.group === 'other')

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-between gap-2 rounded border p-2 text-sm bg-background',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
          {selected
            ? selected.name +
              (selected.group === 'other' && selected.contract_name
                ? ` — ${selected.contract_name}`
                : '')
            : 'Sélectionner un site...'}
        </span>
        <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1 w-full rounded-lg border bg-card shadow-lg ring-1 ring-black/5 max-h-[280px] overflow-hidden flex flex-col"
          role="dialog"
        >
          <div className="p-2 border-b">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Rechercher un chantier..."
              className="w-full rounded border p-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Rechercher un chantier"
            />
          </div>
          <ul
            role="listbox"
            className="overflow-y-auto flex-1 py-1"
            aria-label="Liste des chantiers"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs italic text-muted-foreground">
                Aucun chantier ne correspond.
              </li>
            )}
            {currentItems.length > 0 && (
              <>
                <li className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Ce contrat
                </li>
                {currentItems.map((s) => {
                  const idx = filtered.indexOf(s)
                  return (
                    <Option
                      key={s.id}
                      site={s}
                      selected={s.id === value}
                      highlighted={idx === highlight}
                      onClick={() => commit(s.id)}
                      onMouseEnter={() => setHighlight(idx)}
                    />
                  )
                })}
              </>
            )}
            {otherItems.length > 0 && (
              <>
                <li
                  className={cn(
                    'px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground',
                    currentItems.length > 0 && 'border-t mt-1 pt-2',
                  )}
                >
                  Autres chantiers du tenant
                </li>
                {otherItems.map((s) => {
                  const idx = filtered.indexOf(s)
                  return (
                    <Option
                      key={s.id}
                      site={s}
                      selected={s.id === value}
                      highlighted={idx === highlight}
                      onClick={() => commit(s.id)}
                      onMouseEnter={() => setHighlight(idx)}
                    />
                  )
                })}
              </>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function Option({
  site,
  selected,
  highlighted,
  onClick,
  onMouseEnter,
}: {
  site: SiteOption & { group: 'current' | 'other' }
  selected: boolean
  highlighted: boolean
  onClick: () => void
  onMouseEnter: () => void
}) {
  return (
    <li
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer',
        highlighted && 'bg-muted/60',
      )}
    >
      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
      <span className="min-w-0 truncate flex-1">
        {site.name}
        {site.group === 'other' && site.contract_name && (
          <span className="text-xs text-muted-foreground"> — {site.contract_name}</span>
        )}
      </span>
      {selected && <Check className="h-3.5 w-3.5 text-foreground shrink-0" aria-hidden />}
    </li>
  )
}
