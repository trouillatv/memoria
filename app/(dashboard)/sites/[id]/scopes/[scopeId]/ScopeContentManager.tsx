'use client'

// Sprint 3 — rattachement du contenu à un nœud de mémoire.
// Générique : fonctionne pour les actions ET les anomalies (kind). Prouve la
// chaîne Site → Scope → Contenu. Pas de recherche, pas d'IA.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Link2, Unlink, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setActionScopeAction, setAnomalyScopeAction } from '../../scope-actions'

export type ContentKind = 'action' | 'anomaly'

export interface AttachItem {
  id: string
  label: string
  sub: string | null
  scopeId: string | null
}

async function setScopeFor(
  kind: ContentKind,
  args: { id: string; scopeId: string | null; siteId: string },
) {
  if (kind === 'action') {
    return setActionScopeAction({ actionId: args.id, scopeId: args.scopeId, siteId: args.siteId })
  }
  return setAnomalyScopeAction({ anomalyId: args.id, scopeId: args.scopeId, siteId: args.siteId })
}

const KIND_LABEL: Record<ContentKind, string> = {
  action: 'des actions',
  anomaly: 'des anomalies',
}

interface Props {
  siteId: string
  scopeId: string
  kind: ContentKind
  /** Tous les éléments de ce type pour le site. */
  items: AttachItem[]
}

export function ScopeContentManager({ siteId, scopeId, kind, items }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const others = items.filter((a) => a.scopeId !== scopeId)

  function attach(id: string) {
    startTransition(async () => {
      const res = await setScopeFor(kind, { id, scopeId, siteId })
      if (res.ok) {
        toast.success('Rattaché')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium"
      >
        <span className="inline-flex items-center gap-2">
          <Link2 className="h-4 w-4 text-brand-600" />
          Rattacher {KIND_LABEL[kind]}
        </span>
        <ChevronDown className={'h-4 w-4 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && (
        <div className="border-t px-3 py-3">
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Rien à rattacher ici (déjà rattaché, ou aucun élément sur le site).
            </p>
          ) : (
            <ul className="space-y-1.5">
              {others.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">
                    {a.label}
                    {a.sub && <span className="ml-1.5 text-[11px] text-muted-foreground">· {a.sub}</span>}
                    {a.scopeId && a.scopeId !== scopeId && (
                      <span className="ml-1.5 text-[11px] text-amber-600">(déjà ailleurs)</span>
                    )}
                  </span>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => attach(a.id)}>
                    <Link2 className="h-3.5 w-3.5" />
                    Rattacher
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Bouton de dé-rattachement, à côté de chaque contenu rattaché. */
export function DetachButton({
  siteId,
  itemId,
  kind,
}: {
  siteId: string
  itemId: string
  kind: ContentKind
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await setScopeFor(kind, { id: itemId, scopeId: null, siteId })
          if (res.ok) {
            toast.success('Dé-rattaché')
            router.refresh()
          } else {
            toast.error(res.error)
          }
        })
      }
      className="text-muted-foreground hover:text-destructive p-1 shrink-0"
      aria-label="Dé-rattacher"
      title="Dé-rattacher"
    >
      <Unlink className="h-3.5 w-3.5" />
    </button>
  )
}
