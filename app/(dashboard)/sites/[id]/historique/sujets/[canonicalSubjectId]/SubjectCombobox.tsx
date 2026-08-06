'use client'

import { useState, useRef } from 'react'
import { Search } from 'lucide-react'
import type { CanonicalSubjectSummary } from '@/lib/db/canonical-subject-life'

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

interface Props {
  subjects: CanonicalSubjectSummary[]
  name: string
  required?: boolean
  placeholder?: string
}

export default function SubjectCombobox({ subjects, name, required, placeholder = 'Rechercher un sujet…' }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [selectedLabel, setSelectedLabel] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered =
    query.length >= 2
      ? subjects.filter((s) => normalize(s.label).includes(normalize(query))).slice(0, 8)
      : []

  function select(s: CanonicalSubjectSummary) {
    setSelectedId(s.id)
    setSelectedLabel(s.label)
    setQuery(s.label)
    setOpen(false)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setSelectedId('')
    setSelectedLabel('')
    setOpen(true)
  }

  function handleBlur() {
    setTimeout(() => setOpen(false), 150)
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selectedId} required={required} />
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => query.length >= 2 && setOpen(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          autoComplete="off"
          className="h-8 w-full rounded-md border bg-background pl-7 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {filtered.map((s) => (
            <li
              key={s.id}
              onMouseDown={() => select(s)}
              className="cursor-pointer px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {open && query.length >= 2 && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
          Aucun résultat
        </div>
      )}
    </div>
  )
}
