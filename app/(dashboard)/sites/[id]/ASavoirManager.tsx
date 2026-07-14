'use client'

// Composant de gestion des « À savoir » d'un site (Phase 3.2).
//
// Affiche les À savoir actifs en bandeau au-dessus de la fiche site,
// avec un bouton d'ajout inline. Pas d'acquittement, pas de tracking de
// lecture. Le wording du placeholder rappelle la doctrine : décrire le
// lieu, jamais les personnes.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Plus, Trash2, X, Check, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import type { DbSiteNote } from '@/types/db'
import { createSiteASavoirAction, deleteSiteASavoirAction } from './actions'

interface Props {
  siteId: string
  active: DbSiteNote[]
}

function formatActiveUntil(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.ceil(diff / 86400000)
  if (days <= 0) return 'expire aujourd\'hui'
  if (days === 1) return 'expire demain'
  if (days < 14) return `expire dans ${days} j`
  return `expire le ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}`
}

export function ASavoirManager({ siteId, active }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [body, setBody] = useState('')
  const [activeUntil, setActiveUntil] = useState('')
  const [pending, startTransition] = useTransition()

  function reset() {
    setBody('')
    setActiveUntil('')
    setAdding(false)
  }

  function submit() {
    if (body.trim().length < 3) {
      toast.error('Au moins 3 caractères')
      return
    }
    const fd = new FormData()
    fd.set('site_id', siteId)
    fd.set('body', body.trim())
    fd.set('kind', 'a_savoir')
    if (activeUntil) fd.set('active_until', activeUntil)
    startTransition(async () => {
      const r = await createSiteASavoirAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('À savoir ajouté')
        reset()
        router.refresh()
      }
    })
  }

  function remove(noteId: string) {
    if (!confirm('Supprimer cet À savoir ?')) return
    const fd = new FormData()
    fd.set('site_id', siteId)
    fd.set('note_id', noteId)
    startTransition(async () => {
      const r = await deleteSiteASavoirAction(fd)
      if (r && 'error' in r && r.error) {
        toast.error(r.error)
      } else {
        toast.success('Retiré')
        router.refresh()
      }
    })
  }

  return (
    <section className="rounded-xl border border-violet-200/70 bg-violet-50/50 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2 text-violet-900">
          <Sparkles className="h-4 w-4" />
          À savoir sur ce chantier
          {active.length > 0 && <span className="font-normal text-violet-700/70">· {active.length}</span>}
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </button>
        )}
      </div>

      {active.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic">
          Rien de particulier à savoir sur ce chantier pour l&apos;instant — ajoutez ce qu&apos;un ancien dirait à un nouveau qui arrive.
        </p>
      )}

      {active.length > 0 && (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {active.map((n) => {
            const expiry = formatActiveUntil(n.active_until)
            return (
              <li
                key={n.id}
                className="group relative flex items-start gap-3 rounded-xl border border-violet-100 bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md"
              >
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-violet-100">
                  <StickyNote className="h-3.5 w-3.5" />
                </span>
                <div className="flex-1 min-w-0 pr-4">
                  <p className="text-sm leading-relaxed text-foreground">{n.body}</p>
                  {expiry && (
                    <p className="mt-1.5 text-[10px] uppercase tracking-wider text-violet-500">
                      {expiry}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  disabled={pending}
                  className="absolute right-2 top-2 p-1 rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted/50 hover:text-foreground group-hover:opacity-100"
                  title="Retirer"
                  aria-label="Retirer cet à savoir"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {adding && (
        <div className="mt-3 space-y-2 rounded-md bg-card border border-violet-200 p-3">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Décris le chantier, pas les personnes (3-140 caractères)…"
            maxLength={140}
            disabled={pending}
            autoFocus
            className="w-full rounded border p-1.5 text-sm bg-background"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') reset()
            }}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-muted-foreground inline-flex items-center gap-2">
              Expire le (optionnel) :
              <input
                type="date"
                value={activeUntil}
                onChange={(e) => setActiveUntil(e.target.value)}
                disabled={pending}
                className="rounded border px-2 py-1 text-xs bg-background"
              />
            </label>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={submit}
                disabled={pending || body.trim().length < 3}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-violet-300 bg-violet-50 text-violet-700 text-xs disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Ajouter
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={pending}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Annuler
              </button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            Ces informations décrivent le chantier (code temporaire, accès particulier,
            sensibilité client…). Elles ne sont jamais lues-trackées.
          </p>
        </div>
      )}
    </section>
  )
}
