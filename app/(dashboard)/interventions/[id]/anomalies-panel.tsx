'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Plus, X, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { createAnomalyAction, resolveAnomalyAction } from './intervention-actions'
import type { DbInterventionAnomaly, AnomalyCategory } from '@/types/db'

const CATEGORY_OPTIONS: { value: AnomalyCategory; label: string; icon?: string }[] = [
  { value: 'eau_coupee',       label: 'Eau coupée',       icon: '🚱' },
  { value: 'materiel_casse',   label: 'Matériel cassé',   icon: '⚠' },
  { value: 'acces_bloque',     label: 'Accès bloqué',     icon: '🚪' },
  { value: 'produit_manquant', label: 'Produit manquant', icon: '🧴' },
  { value: 'autre',            label: 'Autre',            icon: '❓' },
]

interface Props {
  interventionId: string
  anomalies: DbInterventionAnomaly[]
  canCreate: boolean
}

export function AnomaliesPanel({ interventionId, anomalies, canCreate }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [category, setCategory] = useState<AnomalyCategory>('eau_coupee')
  const [categoryOther, setCategoryOther] = useState('')
  const [description, setDescription] = useState('')

  function reset() {
    setCategory('eau_coupee')
    setCategoryOther('')
    setDescription('')
  }

  function submit() {
    if (category === 'autre' && !categoryOther.trim()) {
      toast.error('Précisez la catégorie')
      return
    }
    const fd = new FormData()
    fd.set('intervention_id', interventionId)
    fd.set('category', category)
    if (category === 'autre' && categoryOther.trim()) fd.set('category_other', categoryOther.trim())
    if (description.trim()) fd.set('description', description.trim())
    startTransition(async () => {
      const r = await createAnomalyAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Anomalie remontée'); reset(); setOpen(false); router.refresh() }
    })
  }

  function resolve(id: string) {
    const fd = new FormData()
    fd.set('id', id)
    startTransition(async () => {
      const r = await resolveAnomalyAction(fd)
      if (r && 'error' in r && r.error) toast.error(r.error)
      else { toast.success('Anomalie résolue'); router.refresh() }
    })
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          Anomalies ({anomalies.length})
        </h2>
        {canCreate && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs hover:bg-muted/50"
          >
            <Plus className="h-3 w-3" /> Signaler
          </button>
        )}
      </div>

      {open && (
        <div className="rounded border bg-background p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Nouvelle anomalie</span>
            <button type="button" onClick={() => { setOpen(false); reset() }} className="p-0.5 rounded hover:bg-muted/50" aria-label="Fermer">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCategory(opt.value)}
                disabled={pending}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs text-left ${
                  category === opt.value ? 'border-foreground bg-muted/50' : 'hover:bg-muted/30'
                }`}
              >
                {opt.icon && <span>{opt.icon}</span>}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
          {category === 'autre' && (
            <input
              type="text"
              value={categoryOther}
              onChange={(e) => setCategoryOther(e.target.value)}
              placeholder="Précisez..."
              maxLength={100}
              disabled={pending}
              className="w-full rounded border p-1.5 text-sm"
            />
          )}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optionnel)"
            rows={2}
            maxLength={2000}
            disabled={pending}
            className="w-full rounded border p-1.5 text-sm"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => { setOpen(false); reset() }}
              disabled={pending}
              className="px-2.5 py-1 rounded border text-xs disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || (category === 'autre' && !categoryOther.trim())}
              className="px-2.5 py-1 rounded border bg-foreground text-background text-xs disabled:opacity-50"
            >
              {pending ? 'Envoi...' : 'Envoyer'}
            </button>
          </div>
        </div>
      )}

      {anomalies.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Aucune anomalie sur cette intervention.</p>
      ) : (
        <ul className="space-y-1.5">
          {anomalies.map((a) => {
            const opt = CATEGORY_OPTIONS.find((o) => o.value === a.category)
            const labelText = a.category === 'autre' && a.category_other
              ? a.category_other
              : (opt?.label ?? a.category)
            const isOpen = a.status === 'open'
            return (
              <li
                key={a.id}
                className={`rounded border p-2.5 ${
                  isOpen ? 'border-amber-200 bg-amber-50/40' : 'bg-background'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {opt?.icon && <span>{opt.icon}</span>}
                      <span className="text-sm font-medium">{labelText}</span>
                      <span className={`inline-flex items-center px-1.5 py-px rounded-full text-[9px] uppercase font-semibold tracking-widest ${
                        isOpen ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {isOpen ? 'Ouverte' : 'Résolue'}
                      </span>
                    </div>
                    {a.description && (
                      <p className="text-xs text-muted-foreground">{a.description}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Signalée {new Date(a.created_at).toLocaleString('fr-FR')}
                      {a.resolved_at && (
                        <> · Résolue {new Date(a.resolved_at).toLocaleString('fr-FR')}</>
                      )}
                    </p>
                    {a.resolution_note && (
                      <p className="text-[11px] text-muted-foreground italic mt-1">→ {a.resolution_note}</p>
                    )}
                  </div>
                  {isOpen && canCreate && (
                    <button
                      type="button"
                      onClick={() => resolve(a.id)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] hover:bg-muted/50 disabled:opacity-50 shrink-0"
                    >
                      <CheckCircle2 className="h-2.5 w-2.5" /> Résoudre
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
