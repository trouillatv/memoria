'use client'

// Sprint 3 — rattachement du contenu à un nœud de mémoire.
// Liste les actions du site ; permet de rattacher / dé-rattacher au scope.
// Prouve la chaîne : Site → Scope → Contenu. Pas de recherche, pas d'IA.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Link2, Unlink, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setActionScopeAction } from '../../scope-actions'

export interface ActionItem {
  id: string
  title: string
  corpsEtat: string | null
  status: string
  scopeId: string | null
}

interface Props {
  siteId: string
  scopeId: string
  /** Toutes les actions « vivantes » du site (open/planned/done). */
  actions: ActionItem[]
}

export function ScopeContentManager({ siteId, scopeId, actions }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const others = actions.filter((a) => a.scopeId !== scopeId)

  function setScope(actionId: string, target: string | null) {
    startTransition(async () => {
      const res = await setActionScopeAction({ actionId, scopeId: target, siteId })
      if (res.ok) {
        toast.success(target ? 'Rattaché' : 'Dé-rattaché')
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
          Rattacher du contenu
        </span>
        <ChevronDown className={'h-4 w-4 transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && (
        <div className="border-t px-3 py-3">
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Toutes les actions du site sont déjà rattachées ici (ou il n&apos;y a pas encore d&apos;action).
            </p>
          ) : (
            <ul className="space-y-1.5">
              {others.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">
                    {a.title}
                    {a.corpsEtat && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">· {a.corpsEtat}</span>
                    )}
                    {a.scopeId && a.scopeId !== scopeId && (
                      <span className="ml-1.5 text-[11px] text-amber-600">(déjà ailleurs)</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setScope(a.id, scopeId)}
                  >
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

/** Bouton de dé-rattachement, affiché à côté de chaque contenu rattaché. */
export function DetachButton({ siteId, actionId }: { siteId: string; actionId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await setActionScopeAction({ actionId, scopeId: null, siteId })
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
