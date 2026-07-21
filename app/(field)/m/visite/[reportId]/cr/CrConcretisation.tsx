'use client'

// « REPRENDRE LA SUITE DEPUIS MES CORRECTIONS » (Vincent, 2026-07-21).
//
//   Modifier   corrige le récit.
//   Valider    approuve le récit.
//   Concrétiser  transforme ce récit approuvé en travail réel.
//
// Ce bloc fait le troisième temps. Il relit le CR TEL QUE GUILLAUME L'A
// CORRIGÉ — jamais la proposition d'origine — et montre ce que ce texte
// produirait dans le chantier. Rien n'est créé tant qu'il n'a pas coché puis
// cliqué : MemorIA propose, l'humain tranche.

import { useState } from 'react'
import { Loader2, Check, ListTodo, CalendarClock, Gavel, Users, BookOpen, ArrowRight } from 'lucide-react'
import {
  prepareCrConcretisationAction,
  createFromCrAction,
  type ReviewItem,
} from './cr-concretisation-actions'

const FAMILLE: Record<string, { label: string; Icon: typeof ListTodo }> = {
  action: { label: 'Actions à créer', Icon: ListTodo },
  echeance: { label: 'Échéances à ajouter', Icon: CalendarClock },
  decision: { label: 'Décisions à enregistrer', Icon: Gavel },
  memoire: { label: 'À retenir en mémoire', Icon: BookOpen },
  intervenant: { label: 'Intervenants cités', Icon: Users },
}

const ORDRE = ['action', 'echeance', 'decision', 'memoire', 'intervenant']

export function CrConcretisation({ reportId }: { reportId: string }) {
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)

  const prepare = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    setDone(null)
    const res = await prepareCrConcretisationAction(reportId)
    setPending(false)
    if (!res.ok) return setError(res.error)
    setItems(res.items)
    // Tout ce qui est créable et pas déjà créé part coché : le cas courant est
    // « je confirme », pas « je resélectionne tout ».
    setChosen(new Set(res.items.filter((i) => i.creatable && !i.alreadyCreated).map((i) => i.key)))
  }

  const create = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    const res = await createFromCrAction(reportId, [...chosen])
    setPending(false)
    if (!res.ok) return setError(res.error)
    setDone(res.created)
    void prepare() // on relit : ce qui vient d'être créé se marque comme tel
  }

  const toggle = (key: string) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (items === null) {
    return (
      <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
        <h2 className="text-sm font-semibold">Et maintenant ?</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          MemorIA relit le compte-rendu <strong>tel que vous l’avez corrigé</strong> et prépare ce
          qu’il faut créer dans le chantier.
        </p>
        <button
          type="button"
          onClick={prepare}
          disabled={pending}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-[13px] font-semibold text-background disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
          Reprendre la suite depuis mes corrections
        </button>
        {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
      </section>
    )
  }

  const aCreer = items.filter((i) => i.creatable && !i.alreadyCreated)

  return (
    <section data-slot="cr-concretisation" className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">À créer dans le chantier</h2>
        <button
          type="button"
          onClick={prepare}
          disabled={pending}
          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          Reprendre
        </button>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Relu depuis votre texte corrigé. Décochez ce qui ne doit pas être créé.
      </p>

      {done !== null && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[12px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {done} élément{done > 1 ? 's' : ''} créé{done > 1 ? 's' : ''} dans le chantier.
        </p>
      )}

      {aCreer.length === 0 && done === null && (
        <p className="mt-3 text-[12px] italic text-muted-foreground">
          Rien à créer depuis ce compte-rendu.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {ORDRE.map((kind) => {
          const famille = items.filter((i) => i.kind === kind)
          if (famille.length === 0) return null
          const { label, Icon } = FAMILLE[kind]!
          return (
            <div key={kind} data-famille={kind}>
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                <span className="font-normal">({famille.length})</span>
              </p>
              <ul className="mt-1 space-y-1">
                {famille.map((item) => (
                  <li key={item.key} className="rounded-lg border bg-card px-2.5 py-2">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-foreground disabled:opacity-40"
                        checked={chosen.has(item.key)}
                        disabled={!item.creatable || item.alreadyCreated || pending}
                        onChange={() => toggle(item.key)}
                        aria-label={item.label}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-snug">{item.label}</span>
                        {(item.owner || item.due || item.constraint) && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {[item.owner, item.due ? `pour le ${item.due}` : item.constraint]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                        {item.alreadyCreated && (
                          <span className="mt-0.5 block text-[11px] text-emerald-700 dark:text-emerald-400">
                            Déjà créé depuis cette visite.
                          </span>
                        )}
                        {!item.creatable && (
                          // On ne fabrique pas une ligne de casting depuis un
                          // nom : le rôle et l'entreprise seraient inventés.
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            Cité dans le compte-rendu. L’associer au chantier se fait depuis le casting
                            — son rôle ne s’invente pas.
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}

      {aCreer.length > 0 && (
        <button
          type="button"
          onClick={create}
          disabled={pending || chosen.size === 0}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-[13px] font-semibold text-background disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
          Créer dans le chantier ({chosen.size})
        </button>
      )}
    </section>
  )
}
