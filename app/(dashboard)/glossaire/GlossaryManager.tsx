'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Loader2, BookA } from 'lucide-react'
import { createGlossaryTermAction, deleteGlossaryTermAction } from './glossary-actions'
import type { GlossaryTerm } from '@/lib/db/glossary'

export function GlossaryManager({ terms }: { terms: GlossaryTerm[] }) {
  const router = useRouter()
  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')
  const [aliases, setAliases] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function add() {
    setError(null)
    start(async () => {
      const res = await createGlossaryTermAction({ term, definition, aliases })
      if (res.ok) { setTerm(''); setDefinition(''); setAliases(''); router.refresh() }
      else setError(res.error ?? 'Échec')
    })
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteGlossaryTermAction(id)
      if (res.ok) router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {/* Ajout */}
      <section className="rounded-xl border bg-card p-4 space-y-2.5">
        <h2 className="text-sm font-semibold">Ajouter un terme</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={term} onChange={(e) => setTerm(e.target.value)} maxLength={120}
            placeholder="Terme (ex : finisseur)"
            className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={aliases} onChange={(e) => setAliases(e.target.value)} maxLength={500}
            placeholder="Alias / fautes fréquentes (ex : finisher, finiseur)"
            className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <textarea
          value={definition} onChange={(e) => setDefinition(e.target.value)} maxLength={1000} rows={2}
          placeholder="Définition (optionnel)"
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {error && <p className="text-xs text-rose-700">{error}</p>}
        <button
          type="button" onClick={add} disabled={pending || !term.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ajouter
        </button>
      </section>

      {/* Liste */}
      {terms.length === 0 ? (
        <div className="rounded-xl border bg-muted/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Aucun terme pour l&apos;instant. Ajoutez le vocabulaire du métier (finisseur, grader, PAQ, DOE…)
            et ses fautes fréquentes.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {terms.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium inline-flex items-center gap-1.5">
                  <BookA className="h-3.5 w-3.5 text-muted-foreground" /> {t.term}
                </p>
                {t.definition && <p className="text-xs text-muted-foreground mt-0.5">{t.definition}</p>}
                {t.aliases.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {t.aliases.map((a) => (
                      <span key={a} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{a}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button" onClick={() => remove(t.id)} disabled={pending}
                className="shrink-0 text-muted-foreground hover:text-rose-700 disabled:opacity-50"
                aria-label="Supprimer"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
