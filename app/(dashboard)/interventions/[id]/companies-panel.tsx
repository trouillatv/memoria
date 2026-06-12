'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { InterventionCompany } from '@/lib/db/intervention-companies'
import { addCompanyAction, removeCompanyAction } from './companies-actions'

interface Props {
  interventionId: string
  companies: InterventionCompany[]
}

export function CompaniesPanel({ interventionId, companies }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [roleDescription, setRoleDescription] = useState('')
  const [pending, startTransition] = useTransition()

  function reset() {
    setCompanyName('')
    setRoleDescription('')
    setAdding(false)
  }

  function submit() {
    const name = companyName.trim()
    if (name.length < 1) {
      toast.error('Nom de l\'entreprise requis')
      return
    }
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('company_name', name)
    if (roleDescription.trim()) fd.set('role_description', roleDescription.trim())
    startTransition(async () => {
      const r = await addCompanyAction(fd)
      if (r?.error) {
        toast.error(r.error)
        return
      }
      reset()
      router.refresh()
    })
  }

  function remove(companyId: string) {
    const fd = new FormData()
    fd.set('company_id', companyId)
    fd.set('intervention_id', interventionId)
    startTransition(async () => {
      const r = await removeCompanyAction(fd)
      if (r?.error) {
        toast.error(r.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5" />
          Entreprises présentes
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter
          </button>
        )}
      </div>

      {companies.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground italic">
          Aucune entreprise externe enregistrée sur cette intervention.
        </p>
      )}

      {companies.length > 0 && (
        <ul className="space-y-1.5">
          {companies.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-1.5 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium truncate">{c.company_name}</span>
                {c.role_description && (
                  <span className="text-muted-foreground ml-1.5">· {c.role_description}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={pending}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                title="Retirer cette entreprise"
                aria-label={`Retirer ${c.company_name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Raison sociale (ex. : Menuiserie Dupont)"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
          <input
            type="text"
            value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            placeholder="Rôle (optionnel — ex. : Menuiserie, Livraison matériel)"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || companyName.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {pending && <Loader2 className="h-3 w-3 animate-spin" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
