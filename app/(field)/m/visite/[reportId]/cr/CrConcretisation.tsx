'use client'

// « MEMORIA A PRÉPARÉ VOTRE CHANTIER » (Vincent, 2026-07-21).
//
//   Modifier   corrige le récit.
//   Valider    approuve le récit.
//   Concrétiser  transforme ce récit approuvé en travail réel.
//
// Ce bloc fait le troisième temps. Il relit le CR TEL QUE GUILLAUME L'A
// CORRIGÉ — jamais la proposition d'origine — et montre ce que ce texte
// produirait dans le chantier. Rien n'est créé tant qu'il n'a pas coché puis
// cliqué : MemorIA propose, l'humain tranche.
//
// LE COMPTEUR EST LE HÉROS. Une liste de cases à cocher dit « voici du travail
// à faire » ; un nombre annoncé dit « voici du travail DÉJÀ FAIT ». C'est la
// même donnée, ce n'est pas la même chose à lire. Le détail vient après.
//
// La couleur ici ne dit pas un état métier — elle dit DE QUOI on parle. Une
// teinte par famille, en pastille et en colonne à gauche, jamais en fond plein.
// Et la colonne colorée n'est pas un ornement importé : c'est déjà la grammaire
// du dépôt (la bande de lecture du LecturePanel).

import { useState } from 'react'
import {
  Loader2, Check, ListTodo, CalendarClock, Gavel, Users, BookOpen, ArrowRight, Sparkles,
} from 'lucide-react'
import {
  prepareCrConcretisationAction,
  createFromCrAction,
  type ReviewItem,
} from './cr-concretisation-actions'
import type { OperationalDiff } from '@/lib/visits/cr-concretisation'
import { cn } from '@/lib/utils'

interface FamilleStyle {
  label: string
  court: string
  pluriel: string
  Icon: typeof ListTodo
  spine: string
  chip: string
  dot: string
  accent: string
}

const FAMILLE: Record<string, FamilleStyle> = {
  action: {
    label: 'Actions à créer', court: 'action', pluriel: 'actions', Icon: ListTodo,
    spine: 'border-l-violet-400 dark:border-l-violet-500',
    chip: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
    dot: 'bg-violet-500', accent: 'accent-violet-600',
  },
  echeance: {
    label: 'Échéances à ajouter', court: 'échéance', pluriel: 'échéances', Icon: CalendarClock,
    spine: 'border-l-rose-400 dark:border-l-rose-500',
    chip: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
    dot: 'bg-rose-500', accent: 'accent-rose-600',
  },
  decision: {
    label: 'Décisions à enregistrer', court: 'décision', pluriel: 'décisions', Icon: Gavel,
    spine: 'border-l-emerald-400 dark:border-l-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    dot: 'bg-emerald-500', accent: 'accent-emerald-600',
  },
  memoire: {
    label: 'À retenir en mémoire', court: 'à mémoriser', pluriel: 'à mémoriser', Icon: BookOpen,
    spine: 'border-l-sky-400 dark:border-l-sky-500',
    chip: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
    dot: 'bg-sky-500', accent: 'accent-sky-600',
  },
  intervenant: {
    label: 'Intervenants cités', court: 'intervenant', pluriel: 'intervenants', Icon: Users,
    spine: 'border-l-slate-300 dark:border-l-slate-600',
    chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400', accent: 'accent-slate-600',
  },
}

const ORDRE = ['action', 'echeance', 'decision', 'memoire', 'intervenant']

export function CrConcretisation({ reportId }: { reportId: string }) {
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [diff, setDiff] = useState<OperationalDiff | null>(null)
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
    setDiff(res.diff)
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

  // ── Avant la relecture ────────────────────────────────────────────────────
  if (items === null) {
    return (
      <section className="rounded-2xl border bg-background p-3.5 shadow-sm">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />
          Et maintenant ?
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          MemorIA relit le compte-rendu <strong className="text-foreground">tel que vous l’avez
          corrigé</strong>, dit ce que vos corrections ont changé, et prépare ce qu’il faut créer
          dans le chantier.
        </p>
        <button
          type="button"
          onClick={prepare}
          disabled={pending}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-[13px] font-semibold text-background disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
          Mettre à jour les propositions
        </button>
        {error && <p className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</p>}
      </section>
    )
  }

  const aCreer = items.filter((i) => i.creatable && !i.alreadyCreated)

  return (
    <section data-slot="cr-concretisation" className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />
          MemorIA a préparé votre chantier
        </h2>
        <button
          type="button"
          onClick={prepare}
          disabled={pending}
          className="shrink-0 text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          Relire
        </button>
      </div>

      {/* LE NOMBRE D'ABORD — c'est un résultat, pas une liste de corvées. */}
      <p className="mt-2 text-[13px] text-muted-foreground">
        À partir de vos corrections, MemorIA propose{' '}
        <strong className="text-foreground">{items.length} élément{items.length > 1 ? 's' : ''}</strong> :
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ORDRE.map((kind) => {
          const n = items.filter((i) => i.kind === kind).length
          if (n === 0) return null
          const f = FAMILLE[kind]!
          return (
            <span
              key={kind}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium', f.chip)}
            >
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', f.dot)} />
              {n} {n > 1 ? f.pluriel : f.court}
            </span>
          )
        })}
      </div>
      {aCreer.length > 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Tout est sélectionné. Décochez ce que vous ne voulez pas créer.
        </p>
      )}

      {/* CE QUE MES CORRECTIONS ONT CHANGÉ — sans ce repère, on relit une liste
          sans savoir ce que son propre travail a produit. */}
      {diff && !diff.unchanged && (
        <ul data-slot="cr-diff" className="mt-2.5 space-y-0.5 rounded-lg bg-muted/50 px-2.5 py-2 text-[12px]">
          {diff.added.length > 0 && (
            <li className="text-emerald-700 dark:text-emerald-400">
              + {diff.added.length} nouvelle{diff.added.length > 1 ? 's' : ''} depuis vos corrections
            </li>
          )}
          {diff.removed.length > 0 && (
            <li className="text-muted-foreground">
              − {diff.removed.length} que MemorIA proposait et que vous avez retirée
              {diff.removed.length > 1 ? 's' : ''}
            </li>
          )}
          {diff.changed.length > 0 && (
            <li className="text-sky-700 dark:text-sky-400">
              ~ {diff.changed.length} modifiée{diff.changed.length > 1 ? 's' : ''} (responsable ou date)
            </li>
          )}
        </ul>
      )}
      {diff?.unchanged && (
        <p className="mt-2 text-[12px] italic text-muted-foreground">
          Vos corrections n’ont rien changé à ce qui sera créé.
        </p>
      )}

      {done !== null && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[12px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {done} élément{done > 1 ? 's' : ''} créé{done > 1 ? 's' : ''} dans le chantier.
        </p>
      )}

      {items.length === 0 && (
        <p className="mt-3 text-[12px] italic text-muted-foreground">
          Rien à créer depuis ce compte-rendu.
        </p>
      )}

      <div className="mt-3.5 space-y-3.5">
        {ORDRE.map((kind) => {
          const famille = items.filter((i) => i.kind === kind)
          if (famille.length === 0) return null
          const f = FAMILLE[kind]!
          const { label, Icon } = f
          return (
            <div key={kind} data-famille={kind}>
              <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                <span className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full', f.chip)}>
                  <Icon className="h-3 w-3" aria-hidden />
                </span>
                {label}
                <span className="font-normal text-muted-foreground">({famille.length})</span>
              </p>
              <ul className="mt-1.5 space-y-1">
                {famille.map((item) => (
                  <li
                    key={item.key}
                    className={cn(
                      'rounded-lg border border-l-[3px] bg-card px-2.5 py-2 transition-opacity',
                      f.spine,
                      // Décoché = mis en retrait, jamais masqué : on doit voir
                      // ce qu'on a écarté. Un intervenant, lui, n'est jamais
                      // atténué : il n'est pas écarté, il relève d'ailleurs.
                      item.creatable && !item.alreadyCreated && !chosen.has(item.key) && 'opacity-55',
                    )}
                  >
                    <label className="flex items-start gap-2.5">
                      {/* UNE CASE DÉCOCHÉE ET GRISE SE LIT COMME UN BUG (Vincent,
                          2026-07-21). L'intervenant n'est pas « désactivé » : il
                          est d'une AUTRE NATURE — il ne se crée pas ici. Il
                          porte donc son propre signe, pas une case morte. */}
                      {item.creatable ? (
                        <input
                          type="checkbox"
                          className={cn('mt-0.5 h-4 w-4 shrink-0 disabled:opacity-40', f.accent)}
                          checked={chosen.has(item.key)}
                          disabled={item.alreadyCreated || pending}
                          onChange={() => toggle(item.key)}
                          aria-label={item.label}
                        />
                      ) : (
                        <span
                          aria-hidden
                          className={cn(
                            'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                            f.chip,
                          )}
                        >
                          <Users className="h-3 w-3" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-snug">{item.label}</span>

                        {/* UNE ÉCHÉANCE EST UNE DATE AVANT D'ÊTRE UN TITRE. Sans
                            ce repère, une échéance et une action se lisaient
                            pareil, à la couleur près. */}
                        {item.kind === 'echeance' && (item.due || item.constraint) && (
                          <span
                            className={cn(
                              'mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                              f.chip,
                            )}
                          >
                            <CalendarClock className="h-3 w-3" aria-hidden />
                            {item.due ?? item.constraint}
                          </span>
                        )}

                        {item.kind !== 'echeance' && (item.owner || item.due || item.constraint) && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {[item.owner, item.due ? `pour le ${item.due}` : item.constraint]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                        {item.kind === 'echeance' && item.owner && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.owner}</span>
                        )}

                        {item.alreadyCreated && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <Check className="h-3 w-3" aria-hidden /> Déjà créé
                          </span>
                        )}
                        {!item.creatable && (
                          // On ne fabrique pas une ligne de casting depuis un
                          // nom : le rôle et l'entreprise seraient inventés.
                          <>
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                              À traiter dans le casting
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              Son rôle et son entreprise ne s’inventent pas.
                            </span>
                          </>
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
          className="mt-3.5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-[13px] font-semibold text-background disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
          {/* Le bouton dit CE QU'IL FAIT, pas un compte entre parenthèses. */}
          {chosen.size === 0
            ? 'Sélectionnez ce qui doit être créé'
            : `Créer les ${chosen.size} élément${chosen.size > 1 ? 's' : ''} dans le chantier`}
        </button>
      )}
    </section>
  )
}
