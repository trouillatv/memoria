'use client'

// Sprint 3.5 — Rattachement assisté du contenu terrain aux sous-périmètres.
// MemorIA PROPOSE (déterministe, zéro coût), l'humain VALIDE / CORRIGE. Le flux
// mobile n'est jamais ralenti : tout le tri se fait ici, côté desktop.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Inbox, ListTodo, AlertTriangle, Camera, Check, Sparkles } from 'lucide-react'
import {
  setActionScopeAction,
  setAnomalyScopeAction,
  setPhotoScopeAction,
} from './scope-actions'

export interface UnattachedItemView {
  kind: 'action' | 'anomaly' | 'photo'
  id: string
  label: string
  sub: string | null
  suggestion: { scopeId: string; scopeLabel: string; reason: string } | null
}

const KIND_META = {
  action: { Icon: ListTodo, label: 'Action', noun: 'Cette action' },
  anomaly: { Icon: AlertTriangle, label: 'Anomalie', noun: 'Cette anomalie' },
  photo: { Icon: Camera, label: 'Photo', noun: 'Cette photo' },
} as const

async function attach(kind: UnattachedItemView['kind'], id: string, scopeId: string, siteId: string) {
  if (kind === 'action') return setActionScopeAction({ actionId: id, scopeId, siteId })
  if (kind === 'anomaly') return setAnomalyScopeAction({ anomalyId: id, scopeId, siteId })
  return setPhotoScopeAction({ photoId: id, scopeId, siteId })
}

export function UnattachedContentPanel({
  siteId,
  items,
  scopes,
}: {
  siteId: string
  items: UnattachedItemView[]
  scopes: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  if (items.length === 0) return null // tout est rattaché → on n'affiche rien

  function rattacher(item: UnattachedItemView, scopeId: string) {
    if (!scopeId) return
    setBusyId(item.id)
    startTransition(async () => {
      const res = await attach(item.kind, item.id, scopeId, siteId)
      setBusyId(null)
      if (res.ok) {
        const sc = scopes.find((s) => s.id === scopeId)
        toast.success(`Rattaché à « ${sc?.label ?? 'sous-périmètre'} »`)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight inline-flex items-center gap-2">
          <Inbox className="h-4 w-4 text-amber-600" />
          À rattacher
          <span className="text-[11px] font-normal text-muted-foreground">({items.length})</span>
        </h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Contenu déposé au niveau du site, pas encore rangé dans un sous-périmètre.
          MemorIA propose&nbsp;: vous validez.
        </p>
      </div>

      <ul className="space-y-1.5">
        {items.map((item) => {
          const meta = KIND_META[item.kind]
          const Icon = meta.Icon
          const isBusy = pending && busyId === item.id
          return (
            <li key={`${item.kind}-${item.id}`} className="rounded-lg border bg-card px-3 py-2.5">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                  <Icon className="h-2.5 w-2.5" /> {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{item.label}</div>
                  {item.sub && <div className="text-[11px] text-muted-foreground truncate">{item.sub}</div>}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.suggestion ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-foreground">
                      <Sparkles className="h-3 w-3 text-sky-600 shrink-0" />
                      {meta.noun} semble concerner{' '}
                      <strong className="font-semibold">{item.suggestion.scopeLabel}</strong>
                      <span className="text-muted-foreground">· {item.suggestion.reason}</span>
                    </span>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => rattacher(item, item.suggestion!.scopeId)}
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-600 bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" /> Valider
                    </button>
                    <ScopeSelect
                      scopes={scopes}
                      disabled={isBusy}
                      placeholder="Changer…"
                      onPick={(sid) => rattacher(item, sid)}
                    />
                  </>
                ) : (
                  <ScopeSelect
                    scopes={scopes}
                    disabled={isBusy}
                    placeholder="Rattacher à…"
                    onPick={(sid) => rattacher(item, sid)}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ScopeSelect({
  scopes,
  disabled,
  placeholder,
  onPick,
}: {
  scopes: { id: string; label: string }[]
  disabled?: boolean
  placeholder: string
  onPick: (scopeId: string) => void
}) {
  return (
    <select
      defaultValue=""
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value
        e.target.value = '' // reset → réutilisable
        if (v) onPick(v)
      }}
      className="rounded-lg border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      <option value="" disabled>{placeholder}</option>
      {scopes.map((s) => (
        <option key={s.id} value={s.id}>{s.label}</option>
      ))}
    </select>
  )
}
