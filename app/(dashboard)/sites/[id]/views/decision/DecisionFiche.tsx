'use client'

// ── LA FICHE DÉCISION — le pivot du chantier (Sheet latéral, ?decision=) ──────
// Présentationnel pur, alimenté par getSiteDecisionFiche. Ordre de lecture validé :
// le fait → pourquoi (constat + réunion source) → décideur → CONSÉQUENCE (l'action)
// → historique. On ne recrée jamais la réunion (source ≠ objet). Aucune écriture.

import Link from 'next/link'
import { UserCheck } from 'lucide-react'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FicheTrail, type TrailNode, type TrailBack } from '@/components/knowledge/FicheTrail'
import { FicheChapo, type Chapo } from '@/components/knowledge/FicheChapo'
import { cn } from '@/lib/utils'
import type { DecisionFicheData } from '@/lib/knowledge/decision-fiche'
import type { DecisionStatut } from '@/lib/db/decision-constants'

const H4 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'
const H4_STRONG = 'text-[11.5px] font-semibold uppercase tracking-wide text-foreground'

const STATUT_CLS: Record<DecisionStatut, string> = {
  proposee: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  actee: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  appliquee: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  caduque: 'bg-muted text-muted-foreground ring-border',
  contredite: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
}

// Le CORPS de la fiche Décision, sans coquille Sheet : monté à l'intérieur d'un
// Sheet partagé (la coquille persistante du parcours). Aucun changement visuel.
export function DecisionFicheBody({ decision, back }: { decision: DecisionFicheData | null; back?: TrailBack | null }) {
  if (!decision) return null
  const d = decision

  // Le fil : Réunion › Décision › Action, le point sous la Décision (courant).
  const trail: TrailNode[] = [
    ...(d.meeting ? [{ typeLabel: d.meeting.kind === 'visite' ? 'Visite' : 'Réunion', href: d.meeting.href, current: false }] : []),
    { typeLabel: 'Décision', href: null, current: true },
    ...(d.action ? [{ typeLabel: 'Action', href: d.action.href, current: false }] : []),
  ]

  // Le chapô : la relation CENTRALE d'une décision = l'action qu'elle produit (1:1).
  const chapo: Chapo | null = d.action
    ? { label: 'Produit', title: d.action.title, href: d.action.href }
    : null

  return (
    <>
        {/* 1. LE FAIT */}
        <SheetHeader className="pb-0">
          <FicheTrail nodes={trail} back={back} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">⚑ Décision</span>
            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', STATUT_CLS[d.statut])}>{d.statutLabel}</span>
            {d.impactLabel && <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Impact : {d.impactLabel}</span>}
          </div>
          <SheetTitle className="text-base font-semibold leading-snug">{d.titre}</SheetTitle>
          <FicheChapo chapo={chapo} />
          <p className={cn('text-[12px] font-medium', d.enVigueur ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {d.enVigueur && '● '}{d.vigueurLabel}
          </p>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {/* 2. POURQUOI — le constat d'abord, puis la provenance */}
          <section>
            <h4 className={H4_STRONG}>Pourquoi ?</h4>
            {d.description
              ? <p className="mt-1.5 text-[14px] leading-relaxed">{d.description}</p>
              : <p className="mt-1.5 text-[13px] text-muted-foreground">Motivation non renseignée.</p>}
            {d.sujet && <div className="mt-2"><span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">🏷 {d.sujet}</span></div>}
            {/* Le fil dit DÉJÀ « il y a une réunion en amont » ; ici on ne garde que
                le fait qu'il ne porte pas : QUELLE réunion, QUAND. Du contexte, pas
                une carte — une ligne discrète, jamais un bloc « regarde-moi ». */}
            {d.meeting ? (
              <div className="mt-2.5">
                <p className="text-[11.5px] text-muted-foreground">Prise lors de</p>
                <Link href={d.meeting.href} className="text-[13px] font-medium text-foreground hover:underline">{d.meeting.label}</Link>
              </div>
            ) : (
              // État vide EXPLICITE : jamais laisser croire qu'une provenance existe.
              <p className="mt-2.5 text-[12.5px] text-muted-foreground">Aucune réunion source liée.</p>
            )}
          </section>

          {/* 3. DÉCIDEUR — qui PORTE la décision (≠ responsable d'action) */}
          <section>
            <h4 className={H4}>Décideur</h4>
            {d.decideur ? (
              d.decideur.href ? (
                <Link href={d.decideur.href} className="mt-1 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-primary hover:underline">
                  <UserCheck className="h-3.5 w-3.5" />{d.decideur.name}{d.decideur.detail ? <span className="font-normal text-muted-foreground"> · {d.decideur.detail}</span> : null}
                </Link>
              ) : (
                <p className="mt-1 text-[13.5px] font-medium">{d.decideur.name}{d.decideur.detail ? <span className="font-normal text-muted-foreground"> · {d.decideur.detail}</span> : null}</p>
              )
            ) : (
              <p className="mt-1 text-[13px] text-muted-foreground">Décideur non renseigné.</p>
            )}
          </section>

          {/* CONSÉQUENCE — l'action est déjà nommée ET ouvrable par le chapô
               (« Produit : … ») en tête ; on ne la répète plus. Seul l'état vide
               explicite subsiste (recette métier) : une décision sans action le DIT. */}
          {!d.action && (
            <section>
              <h4 className={H4}>Sa conséquence</h4>
              <p className="mt-1 text-[13px] text-muted-foreground">Aucune action liée à cette décision.</p>
            </section>
          )}

          {/* 5. HISTORIQUE — statut COURANT, jamais une fausse transition (pas de journal) */}
          <section>
            <h4 className={H4}>Historique</h4>
            <div className="mt-1.5 flex flex-col gap-3">
              {d.dateDecision && <div className="grid grid-cols-[110px_1fr] items-baseline gap-3"><span className="text-[12.5px] font-semibold tabular-nums">{d.dateDecision}</span><span className="text-[12.5px] text-muted-foreground">Décision prise</span></div>}
              {d.echeance && <div className="grid grid-cols-[110px_1fr] items-baseline gap-3"><span className="text-[12.5px] font-semibold tabular-nums">{d.echeance}</span><span className="text-[12.5px] text-muted-foreground">Échéance</span></div>}
              <div className="grid grid-cols-[110px_1fr] items-baseline gap-3"><span className="text-[12.5px] text-muted-foreground">Statut</span><span className={cn('w-fit rounded-md px-2 py-0.5 text-[11.5px] ring-1', STATUT_CLS[d.statut])}>{d.statutLabel}</span></div>
            </div>
          </section>
        </div>
    </>
  )
}
