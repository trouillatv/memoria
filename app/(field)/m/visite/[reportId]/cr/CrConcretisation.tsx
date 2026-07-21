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
import Link from 'next/link'
import {
  prepareCrConcretisationAction,
  createFromCrAction,
  type ReviewItem,
  type CreationSummary,
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

// LES FAMILLES QUI DEVIENNENT DES OBJETS. Les personnes n'y sont pas : elles
// ne sont pas d'une autre couleur, elles sont d'une autre NATURE. Les mélanger
// dans la même liste à cocher faisait chercher pourquoi certaines lignes ne se
// cochaient pas. Elles ont leur encart, plus bas.
const ORDRE = ['action', 'echeance', 'decision', 'memoire']

export function CrConcretisation({
  reportId,
  asStep = false,
}: {
  reportId: string
  /**
   * DANS UN FLUX, CE BLOC NE COMPTE PLUS (Vincent, 2026-07-22).
   *
   * L'atelier place ce bloc APRÈS les arbitrages : « je corrige mon CR » →
   * « je termine mes arbitrages » → « je vois ce qui sera créé ». Or il
   * annonçait « 19 éléments proposés · 15 seront créés », pendant que le
   * panneau d'arbitrage annonçait « 17 ». Deux totaux de la même visite,
   * côte à côte, qui ne tombaient pas juste — parce qu'ils ne mesurent pas la
   * même chose : l'un compte des DÉCISIONS à prendre, l'autre des OBJETS à
   * créer. Le total global était donc l'invitation à une comparaison qui n'a
   * aucun sens.
   *
   * Et personne ne travaille avec « 19 ». On travaille avec des actions, des
   * échéances, des intervenants. Le total disparaît, les familles restent.
   *
   * Par défaut `false` : le mobile et l'ancienne page de bureau, où ce bloc
   * est AUTONOME et non l'étape d'un flux, ne changent pas.
   */
  asStep?: boolean
}) {
  const [items, setItems] = useState<ReviewItem[] | null>(null)
  const [diff, setDiff] = useState<OperationalDiff | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<CreationSummary | null>(null)

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
    setDone(res.summary)
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
  // Les personnes ne sont pas des objets à créer : elles se rangent à part.
  const personnes = items.filter((i) => i.kind === 'intervenant')
  const creables = items.filter((i) => i.creatable)

  return (
    <section data-slot="cr-concretisation" className="rounded-2xl border bg-background p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        {/* DANS LE FLUX, LE TITRE NOMME L'ÉTAPE. « MemorIA a préparé votre
            chantier » raconte un travail ; « Ce qui sera créé dans le
            chantier » dit à quelle marche du parcours on se trouve — et c'est
            justement ce qui le distingue des arbitrages, l'étape d'avant. */}
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />
          {asStep ? 'Ce qui sera créé dans le chantier' : 'MemorIA a préparé votre chantier'}
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

      {asStep ? (
        // ÉTAPE D'UN FLUX : aucun total. La phrase dit où l'on en est, les
        // pastilles disent de quoi il s'agit. Le sort des personnes n'est pas
        // perdu — leur encart, plus bas, le dit déjà en toutes lettres.
        <>
          <p className="mt-2 text-[13px] font-medium text-foreground">Votre compte-rendu est prêt.</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Après vos corrections, MemorIA a préparé les éléments ci-dessous.
          </p>
        </>
      ) : (
        /* LE COMPTE SE DIT EN ENTIER, OU IL INQUIÈTE (Vincent, 2026-07-21).
           « 15 proposés » puis « créer les 13 » fait chercher les deux qui
           manquent. On énonce donc les trois nombres d'un coup : ce qui est
           proposé, ce qui sera créé, ce qui relève d'ailleurs. */
        <>
          <p className="mt-2 text-[13px] text-muted-foreground">À partir de vos corrections :</p>
          <ul className="mt-1 space-y-0.5 text-[13px]">
            <li className="text-foreground">
              <strong>{items.length} élément{items.length > 1 ? 's' : ''}</strong> proposé{items.length > 1 ? 's' : ''}
            </li>
            {creables.length > 0 && (
              <li className="text-muted-foreground">
                <strong className="text-foreground">{creables.length}</strong> ser
                {creables.length > 1 ? 'ont' : 'a'} créé{creables.length > 1 ? 's' : ''}
              </li>
            )}
            {personnes.length > 0 && (
              <li className="text-muted-foreground">
                <strong className="text-foreground">{personnes.length}</strong> nécessite
                {personnes.length > 1 ? 'nt' : ''} une association dans le casting
              </li>
            )}
          </ul>
        </>
      )}

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

      {/* CE QUI VIENT D'ÊTRE CRÉÉ — nommé famille par famille, puis la porte
          vers le chantier. Sans ce retour, le conducteur a lancé un traitement
          invisible et doit aller vérifier lui-même. */}
      {done && (
        <div
          data-slot="cr-cree"
          className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/25"
        >
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-900 dark:text-emerald-200">
            <Check className="h-4 w-4 shrink-0" aria-hidden />
            {done.total > 0
              ? `${done.total} élément${done.total > 1 ? 's' : ''} créé${done.total > 1 ? 's' : ''} dans le chantier`
              : 'Tout était déjà dans le chantier'}
          </p>
          {done.total > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[12px] text-emerald-800 dark:text-emerald-300">
              {ORDRE.map((kind) => {
                const n = done.byKind[kind] ?? 0
                if (n === 0) return null
                const f = FAMILLE[kind]!
                return (
                  <li key={kind}>
                    ✓ {n} {n > 1 ? f.pluriel : f.court}
                  </li>
                )
              })}
            </ul>
          )}
          {done.skipped > 0 && (
            <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
              {done.skipped} étai{done.skipped > 1 ? 'ent' : 't'} déjà là — rien n’a été dupliqué.
            </p>
          )}
          {done.failed.length > 0 && (
            // Un échec se dit. Relancer est sans risque : l'anti-doublon tient.
            <p className="mt-1.5 text-[11px] font-medium text-rose-700 dark:text-rose-400">
              {done.failed.length} n’a pas pu être créé ({done.failed.join(', ')}). Vous pouvez
              relancer sans rien dupliquer.
            </p>
          )}
          <Link
            href={`/m/site/${done.siteId}`}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-[13px] font-semibold text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            Ouvrir le chantier <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
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
                      {/* Toute ligne de cette liste EST créable — les personnes
                          vivent dans leur propre encart. Une case décochée ne
                          peut donc jamais vouloir dire « impossible », seulement
                          « écarté ». C'est ce qui faisait lire un bug. */}
                      <input
                        type="checkbox"
                        className={cn('mt-0.5 h-4 w-4 shrink-0 disabled:opacity-40', f.accent)}
                        checked={chosen.has(item.key)}
                        disabled={item.alreadyCreated || pending}
                        onChange={() => toggle(item.key)}
                        aria-label={item.label}
                      />
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

                        {item.alreadyCreated && !item.textChanged && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <Check className="h-3 w-3" aria-hidden /> Déjà créé
                          </span>
                        )}
                        {item.alreadyCreated && item.textChanged && (
                          // L'ÉCART SE DIT, IL NE SE RÉSOUT PAS TOUT SEUL.
                          // Réécrire l'objet du chantier parce qu'un mot a bougé
                          // dans le compte-rendu serait décider à la place de
                          // l'humain. On l'informe ; le geste lui appartient.
                          <span className="mt-1 flex flex-col gap-0.5">
                            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                              <Check className="h-3 w-3" aria-hidden /> Déjà créé — texte modifié depuis
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              L’objet du chantier garde son ancien texte. Il n’est pas mis à jour
                              automatiquement.
                            </span>
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

      {/* LES PERSONNES DÉTECTÉES — un encart, pas une ligne de liste. Elles ne
          se créent pas ici : leur rôle et leur entreprise ne s'inventent pas
          depuis un nom cité dans un compte-rendu. */}
      {personnes.length > 0 && (
        <div data-slot="cr-personnes" className="mt-3.5 rounded-xl border bg-muted/30 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200">
              <Users className="h-3 w-3" aria-hidden />
            </span>
            {personnes.length} personne{personnes.length > 1 ? 's' : ''} détectée
            {personnes.length > 1 ? 's' : ''}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Elles pourront être associées au casting du chantier.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {personnes.map((p) => (
              <span
                key={p.key}
                className="rounded-full bg-background px-2 py-0.5 text-[12px] ring-1 ring-border"
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>
      )}

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
