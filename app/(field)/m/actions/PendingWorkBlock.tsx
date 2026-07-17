'use client'

// ── « À CONFIRMER » — DU TRAVAIL, PAS DE L'EXÉCUTION ─────────────────────────
// Une proposition est du travail humain restant : quelqu'un doit la lire et
// trancher. La cacher laisserait le conducteur croire qu'il n'a rien à faire
// pendant que dix faits attendent.
//
// Mais elle n'est PAS exécutable, et rien ici ne doit le laisser croire :
//   · pas de case « terminé » ;
//   · pas d'assignation ;
//   · pas de statut d'exécution ;
//   · le mot est « à confirmer », jamais « ouvert ».
// Un seul geste est possible, et il vient du contrat : « Créer l'action ».

import { useState, useTransition } from 'react'
import { Check, Loader2, MapPin, X, ChevronRight } from 'lucide-react'
import { promoteFromMemoryAction, dismissFromMemoryAction } from '../site/[siteId]/memory-actions'
import type { PendingItem, PendingWork } from '@/lib/knowledge/pending-work'

export function PendingWorkBlock({ work }: { work: PendingWork }) {
  // Le déplacement instantané : l'élément quitte la liste au geste. Le serveur
  // reste la source — on ne fabrique pas une ligne « confirmée » ici, elle
  // apparaîtra dans « À exécuter » au rechargement, lue de l'objet réel.
  const [done, setDone] = useState<Set<string>>(new Set())

  const items = [...work.actions, ...work.deadlines].filter((i) => !done.has(i.proposalId))
  if (items.length === 0) return null

  const nbActions = work.actions.filter((i) => !done.has(i.proposalId)).length
  const nbEcheances = work.deadlines.filter((i) => !done.has(i.proposalId)).length

  return (
    <section className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
      <div>
        <h2 className="text-sm font-semibold text-sky-800 dark:text-sky-200">À confirmer</h2>
        {/* « à confirmer », JAMAIS « ouvertes ». Un mot qui compte une
            proposition comme une action ouverte ment sur l'engagement pris. */}
        <p className="text-[13px] text-sky-700/80 dark:text-sky-300/80">
          {[
            nbActions > 0 ? `${nbActions} action${nbActions > 1 ? 's' : ''} à confirmer` : null,
            nbEcheances > 0 ? `${nbEcheances} échéance${nbEcheances > 1 ? 's' : ''} à confirmer` : null,
          ].filter(Boolean).join(' · ')}
          {' — relevées par MemorIA, personne ne s’est encore engagé.'}
        </p>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <PendingCard key={item.proposalId} item={item} onDone={() => setDone((s) => new Set(s).add(item.proposalId))} />
        ))}
      </ul>
    </section>
  )
}

function PendingCard({ item, onDone }: { item: PendingItem; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function promote() {
    setError(null)
    start(async () => {
      const res = await promoteFromMemoryAction({ site_id: item.siteId, proposal_id: item.proposalId })
      if (res.ok) return onDone()
      setError(res.error)
    })
  }

  function dismiss() {
    setError(null)
    start(async () => {
      const res = await dismissFromMemoryAction({ site_id: item.siteId, proposal_id: item.proposalId })
      if (res.ok) return onDone()
      setError(res.error)
    })
  }

  return (
    <li className="rounded-xl border bg-background p-2.5 text-[13px] leading-snug">
      <p className="font-medium text-foreground/90">{item.title}</p>
      {item.detail && <p className="mt-0.5 text-[12px] text-muted-foreground">{item.detail}</p>}
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {item.siteName}
        {item.owner && ` · ${item.owner}`}
      </p>
      {/* La provenance : sans elle, le conducteur croirait MemorIA sur parole. */}
      {item.reportId && (
        <a
          href={`/m/visite/${item.reportId}/cr`}
          className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground active:text-foreground"
        >
          <MapPin className="h-3 w-3 shrink-0" /> Voir la visite <ChevronRight className="h-3 w-3 shrink-0" />
        </a>
      )}
      {error && <p className="mt-1.5 text-[12px] text-rose-600">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        {/* Le verbe vient du contrat — « Créer l'action », « Ajouter au
            planning ». Jamais un « Confirmer » nu, jamais codé en dur. */}
        <button
          type="button"
          disabled={!item.capability.available || pending}
          onClick={promote}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground active:opacity-80 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {item.capability.label}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={dismiss}
          className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-[13px] text-muted-foreground active:brightness-95 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> Écarter
        </button>
      </div>
    </li>
  )
}
