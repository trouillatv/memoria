'use client'

// ── LA FICHE INTERVENANT — l'objet transverse du produit ─────────────────────
// « La fiche est LE produit ; l'onglet n'est qu'une porte parmi d'autres »
// (Vincent, 2026-07-18). Ce composant est la MÊME fiche partout : onglet
// Intervenants, Explorer, recherche, objets métier. Un seul composant, un seul
// apprentissage. Il répond à « c'était qui déjà ? » en 20 secondes — pas une
// fiche de gestion : coordonnées repliées, jamais au premier niveau.
//
// Présentationnel pur : il reçoit un IntervenantPerson déjà calculé (read model
// site-intervenants-view). Il n'invente aucune information — chaque phrase est
// composée de faits datés et sourcés.

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ChevronDown, Network, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FicheChapo, type Chapo } from '@/components/knowledge/FicheChapo'
import { garderContexte } from '../fiche-segment-href'
import { FICHE_TITLE_MOTION, FICHE_BODY_MOTION } from '@/components/knowledge/fiche-motion'
import { frDayMonthLocal, todayLocalIso } from '@/lib/time/local-date'
import type { IntervenantPerson } from '@/lib/knowledge/site-intervenants-view'
import { assignedActionCountLabel, describeAssignedActionDate } from '@/lib/knowledge/assigned-actions'
import { logIntervenantActionOpenedAction } from './intervenants-actions'

// La COQUILLE de la fiche Intervenant, conservée pour l'onglet Intervenants
// (sélection locale). Le parcours cross-surface (?person=) passe désormais par
// PersistentFicheSheet, qui monte le MÊME corps sans re-créer le Sheet.
export function IntervenantFicheSheet({ siteId, person, onClose }: {
  siteId: string
  person: IntervenantPerson | null
  onClose: () => void
}) {
  if (!person) return null
  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <IntervenantFicheBody siteId={siteId} person={person} />
      </SheetContent>
    </Sheet>
  )
}

// Le CORPS présentationnel — sans coquille Sheet, pour être monté soit par le
// wrapper ci-dessus, soit par la coquille persistante du parcours.
// `variant` — le MÊME corps est monté à deux endroits. Un seul détail ne peut
// pas être partagé : le TITRE. Dans le panneau il doit être le titre accessible
// de la boîte de dialogue (`SheetTitle`) ; en page complète ce contexte n'existe
// pas et le composant plante (« Cannot destructure property 'store' »). Même
// exception nommée que sur les six autres fiches — jamais deux implémentations.
export function IntervenantFicheBody({ siteId, person, animateContent = false, variant = 'panel', search = '' }: {
  siteId: string
  person: IntervenantPerson
  animateContent?: boolean
  /** La query de l'onglet courant, emportée par les liens sortants. Sans elle,
   *  suivre une relation JETTE le décor : `?tab=` disparaît, et fermer la fiche
   *  suivante ramène sur l'Aperçu au lieu de l'onglet d'où l'on vient. Les six
   *  autres fiches obtiennent le même effet via `garderContexte` dans leur
   *  panneau ; celle-ci construit ses adresses, elle porte donc la règle. */
  search?: string
  variant?: 'panel' | 'page'
}) {
  const [showDecisions, setShowDecisions] = useState(false)
  const p = person
  // Jour civil Nouméa, calculé UNE fois (jamais dans la boucle de rendu).
  const today = todayLocalIso()

  // ── LES ADRESSES SE CONSOMMENT, ELLES NE SE FABRIQUENT PLUS ICI ───────────
  // Ce corps CONSTRUISAIT ses liens avec `usePathname()` + `useSearchParams()`,
  // seul des sept à le faire — héritage du modèle `?person=`. Deux conséquences,
  // corrigées ensemble :
  //
  //  1. `useSearchParams()` exige une frontière <Suspense> en rendu serveur. Le
  //     panneau vit dans une zone parallèle qui en a une ; la PAGE DIRECTE, non
  //     — elle plantait en production sous cinq preuves vertes ;
  //  2. ces deux fonctions étaient les DERNIERS émetteurs de paramètres de
  //     provenance (`action_source`, `from_person`…), que le Lot 3 avait
  //     supprimés partout ailleurs.
  //
  // Les six autres fiches reçoivent des adresses déjà construites ; celle-ci les
  // construit désormais en ABSOLU, sans lire l'URL courante. Le retour ne passe
  // plus par `from_person` : c'est l'historique qui le porte (invariant du Lot 3).
  // ⚠️ `garderContexte` et non une concaténation : « suivre une relation ne change
  // pas le décor ». Régression trouvée par le contrôle indépendant — la recette
  // navigateur ne pouvait pas la voir, car sur l'onglet par défaut (`apercu`) une
  // URL nue et une URL avec `?tab=apercu` rendent le même écran.
  const actionHref = (actionId: string): string =>
    garderContexte(`/sites/${siteId}/action/${actionId}`, search) ?? `/sites/${siteId}/action/${actionId}`
  const decisionHref = (decisionId: string): string =>
    garderContexte(`/sites/${siteId}/decision/${decisionId}`, search) ?? `/sites/${siteId}/decision/${decisionId}`

  // Le chapô = la relation d'IDENTITÉ (règle 6). L'intervenant est un objet
  // TRANSVERSE : sa relation n'est pas causale mais identitaire — ce dont il RÉPOND.
  // UN engagement actif → on le nomme ; PLUSIEURS → « Porte des engagements actifs »
  // (jamais en élire un — l'urgence n'est pas une identité — jamais compter) ;
  // AUCUN → pas de chapô (le sous-titre rôle + entreprise suffit ; pas de redite).
  const activeCount = p.assignedActions.length + p.openObligationsCount
  const chapo: Chapo | null =
    activeCount === 0
      ? null
      : p.assignedActions.length === 1 && p.openObligationsCount === 0
        ? { label: 'Responsable de', title: p.assignedActions[0].title, href: actionHref(p.assignedActions[0].id) }
        : { label: 'Porte des engagements actifs', title: null, href: null }

  // La provenance, en UNE ligne — fusion des ex-sections « En une phrase » et
  // « Pourquoi est-il ici ? » qui répondaient deux fois au même « pourquoi ».
  const accord = p.isPerson ? '' : 'e'
  const prov = p.citedVisits.length > 0
    ? `Au casting du chantier · cité${accord} dans ${p.citedVisits.length} visite${p.citedVisits.length > 1 ? 's' : ''}, confirmé${accord} par un humain.`
    : `Au casting du chantier, confirmé${accord} par un humain.`

  // Le corps montre CE QUI COMPTE MAINTENANT : engagements triés retard d'abord,
  // puis échéance la plus proche. L'urgence vit ICI, jamais dans l'identité.
  const sortedActions = [...p.assignedActions].sort((a, b) => {
    if (a.isLate !== b.isLate) return a.isLate ? -1 : 1
    const ad = a.dueDate ?? '9999-99-99', bd = b.dueDate ?? '9999-99-99'
    return ad < bd ? -1 : ad > bd ? 1 : 0
  })

  const timeline: Array<{ date: string | null; label: string }> = [
    ...p.citedVisits.slice(0, 2).map((v) => ({ date: v.date, label: 'Cité pendant cette visite' })),
    { date: p.firstSeen, label: 'Première apparition dans la mémoire' },
  ]

  const infos: Array<[string, string]> = []
  if (p.phone) infos.push(['Téléphone', p.phone])
  if (p.mobile) infos.push(['Mobile', p.mobile])
  if (p.email) infos.push(['Mail', p.email])

  return (
    <>
        <SheetHeader className="pb-0">
          {variant === 'page'
            ? <h1 className="text-base font-semibold">{p.name}</h1>
            : <SheetTitle className={cn('text-base font-semibold', animateContent && FICHE_TITLE_MOTION)}>{p.name}</SheetTitle>}
          <p className="text-[13px] text-muted-foreground">
            {[p.companyName, p.fonction ?? `Rôle ${p.role}`].filter(Boolean).join(' · ')}
          </p>
          {/* La relation d'identité, puis la provenance en une ligne discrète. */}
          <FicheChapo chapo={chapo} className={animateContent ? FICHE_TITLE_MOTION : undefined} />
          <p className="mt-1 text-[11.5px] text-muted-foreground/80">{prov}</p>
        </SheetHeader>

        <div className={cn('space-y-5 px-4 pb-6', animateContent && FICHE_BODY_MOTION)}>
          {/* « Actions à suivre » — les actions liées structurellement à cette
              personne sur CE chantier (assigned_contact_id). Cadrage NEUTRE
              (Vincent) : surtout pas « Aujourd'hui », qui suggérerait une
              obligation quotidienne — le terrain travaille sur plusieurs jours,
              l'absence de réalisation/déclaration du jour n'est jamais une
              anomalie. « Aujourd'hui » ne se justifiera que pendant une session
              de contrôle (parcours futur). L'état vide reste affiché (le système
              a vérifié) ; jamais un « 0 » décoratif ni l'ancien assigned_to. */}
          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Actions à suivre</h4>
            {p.assignedActions.length === 0 ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                Aucune action à suivre avec cette personne sur ce chantier.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[13px] font-medium">{assignedActionCountLabel(p.assignedActions.length)}</p>
                <ul className="mt-1.5 space-y-1.5">
                  {sortedActions.map((a) => {
                    const d = describeAssignedActionDate(a, today)
                    return (
                      <li key={a.id}>
                        {/* La ligne ENTIÈRE est le seul lien (un seul geste, jamais
                            deux déclenchements). Le log est best-effort et ne
                            bloque jamais la navigation (void, sans preventDefault). */}
                        <Link
                          href={actionHref(a.id)}
                          scroll={false}
                          onClick={() => { void logIntervenantActionOpenedAction({ site_id: siteId, destination: a.hrefSource }) }}
                          className="block rounded-lg border px-2.5 py-1.5 hover:bg-muted/40"
                        >
                          <span className="block text-[13px] font-medium leading-snug line-clamp-3">{a.title}</span>
                          {d.label && (
                            <span className={cn('mt-0.5 block text-[12px]', d.kind === 'late' ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>
                              {d.label}
                            </span>
                          )}
                          <span className="mt-0.5 inline-flex items-center gap-0.5 text-[12px] font-medium text-primary">
                            Ouvrir <ChevronRight className="h-3 w-3" />
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </section>

          {/* Décisions PORTÉES — sobre : un compteur cliquable qui déplie la liste.
              Chaque décision ouvre sa fiche (?decision=). On ne raconte pas ici. */}
          {p.decisions.length > 0 && (
            <section>
              <button onClick={() => setShowDecisions((v) => !v)} className="flex w-full items-center gap-1.5 text-left">
                <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Décisions portées</h4>
                <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">{p.decisionsCount}</span>
                {showDecisions ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {showDecisions && (
                <ul className="mt-1.5 space-y-1.5">
                  {p.decisions.map((dec) => (
                    <li key={dec.id}>
                      <Link href={decisionHref(dec.id)} scroll={false} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 hover:bg-muted/40">
                        <span aria-hidden className="text-indigo-600 dark:text-indigo-300">⚑</span>
                        <span className="text-[13px] font-medium leading-snug line-clamp-2">{dec.titre}</span>
                        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* « Pourquoi est-il ici ? » a fusionné dans le chapô (l'identité) + la
              ligne de provenance de l'en-tête — on ne l'explique plus deux fois. */}

          <section>
            <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Dernières activités</h4>
            <ul className="mt-2 space-y-2 border-l-2 pl-3">
              {timeline.map((t, i) => (
                <li key={i} className="text-[13px]">
                  <span className="block text-[12px] text-muted-foreground">
                    {t.date ? frDayMonthLocal(t.date) : '—'}
                  </span>
                  {t.label}
                </li>
              ))}
            </ul>
          </section>

          {p.elsewhere.length > 0 && (
            <section>
              <h4 className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Ailleurs</h4>
              <ul className="mt-1 space-y-1">
                {p.elsewhere.slice(0, 4).map((e) => (
                  <li key={e.siteId} className="text-[13px]">
                    <Link href={`/sites/${e.siteId}?tab=intervenants`} className="hover:underline">
                      {e.siteName}
                    </Link>
                    <span className="text-muted-foreground"> — rôle {e.role}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Coordonnées REPLIÉES : la fiche est narrative, pas un CRM. */}
          {infos.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                Informations
              </summary>
              <ul className="mt-1 space-y-1">
                {infos.map(([k, v]) => (
                  <li key={k} className="text-[13px]">
                    <span className="text-muted-foreground">{k}</span> · {v}
                    {(k === 'Téléphone' || k === 'Mobile') && (
                      <a href={`tel:${v.replace(/\s/g, '')}`} className="ml-2 text-primary">
                        <Phone className="inline h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <Link
            href={`/sites/${siteId}?tab=explorer`}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium hover:bg-muted"
          >
            <Network className="h-4 w-4" /> Voir dans Explorer
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
    </>
  )
}
