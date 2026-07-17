'use client'

// Propositions « à savoir » issues de l'AO — matérialisation vers un site réel.
// Vincent 2026-05-25. L'IA a proposé un savoir du lieu ; l'humain choisit le
// site et crée le « à savoir » (lien terrain). Silence si aucune proposition.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Lightbulb, Plus, Loader2 } from 'lucide-react'
import { materializeASavoirAction } from './asavoir-actions'

interface Proposition {
  id: string
  short_label: string
  source_excerpt: string
}

export function ASavoirPropositionsPanel({
  propositions,
  sites,
  contractId,
}: {
  propositions: Proposition[]
  sites: { id: string; name: string }[]
  contractId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [siteByProp, setSiteByProp] = useState<Record<string, string>>({})

  if (propositions.length === 0) return null

  function materialize(propId: string) {
    const siteId = siteByProp[propId] ?? sites[0]?.id
    if (!siteId) return
    setBusyId(propId)
    startTransition(async () => {
      const fd = new FormData()
      fd.set('engagement_id', propId)
      fd.set('site_id', siteId)
      fd.set('contract_id', contractId)
      const r = await materializeASavoirAction(fd)
      setBusyId(null)
      if (r.ok) {
        toast.success('« À savoir » ajouté au chantier')
        router.refresh()
      } else {
        toast.error(r.error)
      }
    })
  }

  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/30 dark:bg-sky-950/15 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold inline-flex items-center gap-2 text-sky-900 dark:text-sky-200">
          <Lightbulb className="h-4 w-4" />
          Mémoire du lieu proposée par le dossier
          <span className="text-xs font-normal text-sky-800/70 dark:text-sky-200/60">({propositions.length})</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Savoir opérationnel détecté dans le dossier. Choisissez le chantier concerné pour le transformer en « à savoir ».
        </p>
      </div>

      {sites.length === 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Ajoutez d&apos;abord un chantier à ce contrat pour pouvoir y rattacher ces savoirs.
        </p>
      ) : (
        <ul className="space-y-2">
          {propositions.map((p) => (
            <li key={p.id} className="rounded-md border bg-card p-3">
              <div className="text-sm font-medium">{p.short_label}</div>
              <p className="mt-0.5 text-xs text-muted-foreground italic">« {p.source_excerpt} »</p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <select
                  value={siteByProp[p.id] ?? sites[0]!.id}
                  onChange={(e) => setSiteByProp((m) => ({ ...m, [p.id]: e.target.value }))}
                  disabled={pending}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => materialize(p.id)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50 dark:bg-sky-950/30 dark:text-sky-200"
                >
                  {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Créer l&apos;à savoir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
