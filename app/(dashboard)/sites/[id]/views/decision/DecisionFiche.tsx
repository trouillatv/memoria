'use client'

// ── LA FICHE DÉCISION — le pivot du chantier (Sheet latéral, ?decision=) ──────
// Présentationnel pur, alimenté par getSiteDecisionFiche. Ordre de lecture validé :
// le fait → pourquoi (constat + réunion source) → décideur → CONSÉQUENCE (l'action)
// → historique. On ne recrée jamais la réunion (source ≠ objet). Aucune écriture.

import Link from 'next/link'
import { ChevronRight, UserCheck, ChevronDown } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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

export function DecisionFicheSheet({ decision, onClose }: { decision: DecisionFicheData | null; onClose: () => void }) {
  if (!decision) return null
  const d = decision

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {/* 1. LE FAIT */}
        <SheetHeader className="pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">⚑ Décision</span>
            <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', STATUT_CLS[d.statut])}>{d.statutLabel}</span>
            {d.impactLabel && <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Impact : {d.impactLabel}</span>}
          </div>
          <SheetTitle className="text-base font-semibold leading-snug">{d.titre}</SheetTitle>
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
            {d.meeting ? (
              <Link href={d.meeting.href} className="mt-2.5 flex items-center gap-2.5 rounded-lg bg-muted/50 p-2.5 hover:bg-muted">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-indigo-50 text-[12px] text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">☷</span>
                <span className="text-[12.5px] text-muted-foreground">Décision prise lors de la <span className="block font-semibold text-foreground">{d.meeting.label}</span></span>
                <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
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

          {/* 4. CONSÉQUENCE — mise en avant : l'action qui en découle (1:1) */}
          <section>
            <h4 className={H4_STRONG}>Sa conséquence</h4>
            {d.action ? (
              <div className="mt-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">L’action qui en découle</p>
                <p className="mt-1.5 flex items-center gap-2 text-[14px] font-semibold">
                  <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded bg-emerald-600 text-[11px] text-white">✓</span>
                  {d.action.title}
                </p>
                <Link href={d.action.href} scroll={false} className="mt-2 inline-flex items-center gap-0.5 text-[13px] font-medium text-primary hover:underline">
                  Ouvrir l’action <ChevronRight className="h-3.5 w-3.5" />
                </Link>
                <p className="mt-2 border-t border-dashed border-emerald-200 pt-2 text-[11px] text-muted-foreground dark:border-emerald-900/40">Cette décision entraîne aujourd’hui cette action.</p>
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-muted-foreground">Aucune action liée à cette décision.</p>
            )}
          </section>

          {/* 5. HISTORIQUE — statut COURANT, jamais une fausse transition (pas de journal) */}
          <section>
            <h4 className={H4}>Historique</h4>
            <div className="mt-1.5 flex flex-col gap-3">
              {d.dateDecision && <div className="grid grid-cols-[110px_1fr] items-baseline gap-3"><span className="text-[12.5px] font-semibold tabular-nums">{d.dateDecision}</span><span className="text-[12.5px] text-muted-foreground">Décision prise</span></div>}
              {d.echeance && <div className="grid grid-cols-[110px_1fr] items-baseline gap-3"><span className="text-[12.5px] font-semibold tabular-nums">{d.echeance}</span><span className="text-[12.5px] text-muted-foreground">Échéance</span></div>}
              <div className="grid grid-cols-[110px_1fr] items-baseline gap-3"><span className="text-[12.5px] text-muted-foreground">Statut</span><span className={cn('w-fit rounded-md px-2 py-0.5 text-[11.5px] ring-1', STATUT_CLS[d.statut])}>{d.statutLabel}</span></div>
            </div>
          </section>

          {/* La chaîne de causalité — petite frise */}
          <div className="flex flex-col items-center gap-0 pt-1 text-[12.5px]">
            {d.meeting
              ? <Link href={d.meeting.href} className="rounded-lg border bg-card px-3 py-1.5 font-medium hover:bg-muted">☷ Réunion</Link>
              : <span className="rounded-lg border bg-card px-3 py-1.5 font-medium text-muted-foreground">☷ Réunion</span>}
            <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
            <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">⚑ Décision</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
            {d.action
              ? <Link href={d.action.href} scroll={false} className="rounded-lg border bg-card px-3 py-1.5 font-medium hover:bg-muted">◉ Action</Link>
              : <span className="rounded-lg border bg-card px-3 py-1.5 font-medium text-muted-foreground">◉ Action</span>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
