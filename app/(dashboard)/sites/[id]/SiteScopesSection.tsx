'use client'

// Sprint 3 — Nœuds de mémoire (scopes) visibles sur la fiche site.
// L'utilisateur ne voit jamais « scope » : il voit « sous-périmètres » et des
// labels (VRD, Réseau EP, Bâtiment B…). Création / affichage / lien vers le
// contenu rattaché. Pas de recherche, pas d'IA.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Layers, Plus, ChevronRight, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createScopeAction, deleteScopeAction } from './scope-actions'

export interface ScopeView {
  id: string
  label: string
  scopeTypeKey: string | null
  description: string | null
  actionCount: number
  anomalyCount: number
}

function countLabel(s: ScopeView): string {
  const parts: string[] = []
  if (s.actionCount > 0) parts.push(`${s.actionCount} action${s.actionCount > 1 ? 's' : ''}`)
  if (s.anomalyCount > 0) parts.push(`${s.anomalyCount} anomalie${s.anomalyCount > 1 ? 's' : ''}`)
  return parts.length > 0 ? parts.join(' · ') : 'vide'
}

interface Props {
  siteId: string
  scopes: ScopeView[]
  /** Vocabulaire de types du métier (org_catalog corps_etat) ; peut être vide. */
  typeOptions: { key: string; label: string }[]
}

export function SiteScopesSection({ siteId, scopes, typeOptions }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [typeKey, setTypeKey] = useState<string>('')
  const [description, setDescription] = useState('')
  const [pending, startTransition] = useTransition()

  function reset() {
    setLabel('')
    setTypeKey('')
    setDescription('')
    setAdding(false)
  }

  function pickType(key: string) {
    setTypeKey(key)
    // Pré-remplit le nom avec le libellé du type si vide (friction zéro).
    if (!label.trim()) {
      const opt = typeOptions.find((o) => o.key === key)
      if (opt) setLabel(opt.label)
    }
  }

  function submit() {
    if (!label.trim()) {
      toast.error('Donnez un nom au sous-périmètre')
      return
    }
    startTransition(async () => {
      const res = await createScopeAction({
        siteId,
        label: label.trim(),
        scopeTypeKey: typeKey || null,
        description: description.trim() || null,
      })
      if (res.ok) {
        toast.success('Sous-périmètre créé')
        reset()
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  function remove(scopeId: string, scopeLabel: string) {
    if (!confirm(`Supprimer le sous-périmètre « ${scopeLabel} » ? Le contenu rattaché reste au niveau du site.`)) return
    startTransition(async () => {
      const res = await deleteScopeAction({ scopeId, siteId })
      if (res.ok) {
        toast.success('Sous-périmètre supprimé')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight inline-flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-600" />
            Sous-périmètres
          </h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Découpez la mémoire du chantier (VRD, réseau, bâtiment…) pour pouvoir l&apos;interroger précisément.
          </p>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="scope-add">
            <Plus className="h-3.5 w-3.5" />
            Ajouter
          </Button>
        )}
      </div>

      {/* Liste */}
      {scopes.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground italic">
          Aucun sous-périmètre. Le contenu vit au niveau du chantier.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {scopes.map((s) => (
            <li key={s.id} className="group flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <Link
                href={`/sites/${siteId}/scopes/${s.id}`}
                className="flex-1 min-w-0 inline-flex items-center gap-2"
              >
                <span className="font-medium truncate">{s.label}</span>
                <span className="text-[11px] text-muted-foreground shrink-0">{countLabel(s)}</span>
              </Link>
              <button
                type="button"
                onClick={() => remove(s.id, s.label)}
                disabled={pending}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1"
                aria-label={`Supprimer ${s.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <Link href={`/sites/${siteId}/scopes/${s.id}`} className="text-muted-foreground" aria-hidden>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Formulaire de création */}
      {adding && (
        <div className="rounded-lg border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Nouveau sous-périmètre</span>
            <button type="button" onClick={reset} className="text-muted-foreground hover:text-foreground" aria-label="Annuler">
              <X className="h-4 w-4" />
            </button>
          </div>

          {typeOptions.length > 0 && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Type (optionnel)
              </label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {typeOptions.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => pickType(typeKey === o.key ? '' : o.key)}
                    className={
                      'px-2.5 h-7 rounded-full border text-xs transition-colors ' +
                      (typeKey === o.key
                        ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-950/30 dark:text-brand-200'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted/40')
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="scope-label">
              Nom
            </label>
            <input
              id="scope-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VRD, Réseau EP, Bâtiment B…"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              maxLength={80}
              autoFocus
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="scope-desc">
              Description (optionnel)
            </label>
            <textarea
              id="scope-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none"
              maxLength={500}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>Annuler</Button>
            <Button size="sm" onClick={submit} disabled={pending} data-testid="scope-create">
              {pending ? 'Création…' : 'Créer'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
