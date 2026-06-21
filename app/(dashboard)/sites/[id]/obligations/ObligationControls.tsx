'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { instantiateObligationsAction, setObligationStatusAction } from './actions'
import type { ObligationStatus } from '@/lib/db/obligations'

type TemplateChoice = { id: string; label: string; themes: string[]; responsible: string }

const STATUS: { value: ObligationStatus; label: string }[] = [
  { value: 'a_produire', label: 'À produire' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'satisfaite', label: 'Satisfaite' },
  { value: 'non_applicable', label: 'Non applicable' },
]

/** Proposition de la bibliothèque standard — l'humain coche, MemorIA instancie. */
export function ProposeObligations({ siteId, choices }: { siteId: string; choices: TemplateChoice[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [sel, setSel] = useState<Set<string>>(new Set())

  if (choices.length === 0) return null
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  function add() {
    if (sel.size === 0) return
    const fd = new FormData()
    fd.set('siteId', siteId)
    for (const id of sel) fd.append('templateIds', id)
    start(async () => {
      const r = await instantiateObligationsAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success(`${r.count ?? 0} obligation(s) ajoutée(s)`)
      setSel(new Set())
      router.refresh()
    })
  }

  return (
    <section className="space-y-3 rounded-xl border bg-muted/20 p-4">
      <div>
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-muted-foreground" /> Proposer les obligations standard</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">MemorIA propose la bibliothèque ; cochez celles qui s&apos;appliquent à ce chantier.</p>
      </div>
      <ul className="space-y-1">
        {choices.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-sm cursor-pointer hover:border-foreground/30">
              <input type="checkbox" checked={sel.has(c.id)} disabled={pending} onChange={() => toggle(c.id)} className="mt-1" />
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="block text-[11px] text-muted-foreground">{c.responsible}{c.themes.length ? ` · ${c.themes.join(', ')}` : ''}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" disabled={pending || sel.size === 0} onClick={add}
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted/40 disabled:opacity-50">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ajouter au chantier ({sel.size})
      </button>
    </section>
  )
}

/** Boutons de statut d'une obligation instanciée. */
export function ObligationStatusButtons({ siteId, obligationId, status }: { siteId: string; obligationId: string; status: ObligationStatus }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function change(next: ObligationStatus) {
    if (next === status) return
    const fd = new FormData()
    fd.set('siteId', siteId); fd.set('obligationId', obligationId); fd.set('status', next)
    start(async () => {
      const r = await setObligationStatusAction(fd)
      if ('error' in r) { toast.error(r.error); return }
      toast.success('Mis à jour')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {STATUS.map((s) => (
        <button key={s.value} type="button" disabled={pending} onClick={() => change(s.value)}
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            s.value === status ? 'bg-foreground text-background' : 'bg-background hover:bg-muted/40'
          }`}>
          {s.label}
        </button>
      ))}
      {pending && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  )
}
