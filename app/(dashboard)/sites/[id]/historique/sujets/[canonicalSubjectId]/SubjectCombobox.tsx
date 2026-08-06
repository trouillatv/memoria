'use client'

import { useState, useRef, useTransition } from 'react'
import { Search, Plus, Loader2 } from 'lucide-react'
import type { CanonicalSubjectSummary } from '@/lib/db/canonical-subject-life'
import { createCanonicalSubjectForLink } from './link-actions'

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function matchesQuery(subject: CanonicalSubjectSummary, q: string): boolean {
  const n = normalize(q)
  if (normalize(subject.label).includes(n)) return true
  return subject.aliases.some((a) => normalize(a).includes(n))
}

interface Props {
  subjects: CanonicalSubjectSummary[]
  name: string
  siteId: string
  required?: boolean
  placeholder?: string
}

export default function SubjectCombobox({ subjects, name, siteId, required, placeholder = 'Rechercher un sujet…' }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [open, setOpen] = useState(false)
  const [localSubjects, setLocalSubjects] = useState(subjects)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const active = localSubjects.filter((s) => s.status === 'active')
  const inactive = localSubjects.filter((s) => s.status !== 'active')

  const filteredActive = query.length >= 2 ? active.filter((s) => matchesQuery(s, query)).slice(0, 8) : []
  const filteredInactive = query.length >= 2 ? inactive.filter((s) => matchesQuery(s, query)).slice(0, 3) : []

  const hasResults = filteredActive.length > 0 || filteredInactive.length > 0
  const showCreate = query.length >= 2 && query.trim().length > 0

  const selectedLabel = localSubjects.find((s) => s.id === selectedId)?.label ?? ''

  function select(s: CanonicalSubjectSummary) {
    setSelectedId(s.id)
    setQuery(s.label)
    setOpen(false)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setSelectedId('')
    setOpen(true)
  }

  function handleBlur() {
    setTimeout(() => setOpen(false), 150)
  }

  function handleCreate() {
    const label = query.trim()
    if (!label) return
    startTransition(async () => {
      const result = await createCanonicalSubjectForLink(siteId, label)
      if ('id' in result) {
        const newSubject: CanonicalSubjectSummary = { id: result.id, label: result.label, aliases: [], status: 'active' }
        setLocalSubjects((prev) => [...prev, newSubject])
        select(newSubject)
      }
    })
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedId} required={required} />
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={selectedId ? selectedLabel : query}
          onChange={handleChange}
          onFocus={() => {
            if (!selectedId) setOpen(true)
            else { setQuery(''); setSelectedId(''); setOpen(true) }
          }}
          onBlur={handleBlur}
          placeholder={placeholder}
          autoComplete="off"
          className="h-8 w-full rounded-md border bg-background pl-7 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {open && query.length >= 2 && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
          {filteredActive.length > 0 && (
            <>
              <li className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sujets existants
              </li>
              {filteredActive.map((s) => (
                <li
                  key={s.id}
                  onMouseDown={() => select(s)}
                  className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  {s.label}
                </li>
              ))}
            </>
          )}

          {filteredInactive.length > 0 && (
            <>
              <li className="mt-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Archivés / fusionnés
              </li>
              {filteredInactive.map((s) => (
                <li
                  key={s.id}
                  onMouseDown={() => select(s)}
                  className="cursor-pointer px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  {s.label}
                  <span className="ml-1.5 text-[10px] text-muted-foreground/60">({s.status})</span>
                </li>
              ))}
            </>
          )}

          {!hasResults && (
            <li className="px-3 py-2 text-sm text-muted-foreground">Aucun résultat correspondant</li>
          )}

          {showCreate && (
            <>
              {hasResults && (
                <li className="mt-1 border-t px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Aucun de ceux-ci ?
                </li>
              )}
              <li
                onMouseDown={handleCreate}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-accent"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Créer un nouveau sujet &ldquo;{query.trim()}&rdquo;
              </li>
            </>
          )}
        </ul>
      )}
    </div>
  )
}
