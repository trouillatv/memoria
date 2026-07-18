'use client'

// ── LA FICHE ACTION — lecture canonique d'une action (Lot 4 · Slice 3) ───────
// Comme la fiche Intervenant : un Sheet latéral, présentationnel pur, alimenté
// par un read model unique (getSiteActionFiche). On y LIT une action en entier :
// responsable identifié (preuve structurelle), échéance/retard, statut, source,
// historique minimal. Aucune écriture ici (clôture = Slice 8).

import Link from 'next/link'
import { ChevronRight, UserCheck, CheckCircle2, Circle } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { todayLocalIso } from '@/lib/time/local-date'
import { describeAssignedActionDate } from '@/lib/knowledge/assigned-actions'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'
import type { SiteActionStatus } from '@/types/db'

const H4 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'

const STATUS_CLS: Record<SiteActionStatus, string> = {
  open: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  planned: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  cancelled: 'bg-muted text-muted-foreground ring-border',
}

export function ActionFicheSheet({ action, onClose }: { action: ActionFicheData | null; onClose: () => void }) {
  if (!action) return null
  const a = action
  const date = describeAssignedActionDate(
    { dueDate: a.dueDate, dueDateStatus: a.dueDateStatus, isLate: a.isLate },
    todayLocalIso(),
  )

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader className="pb-0">
          <span className={cn('w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', STATUS_CLS[a.status])}>
            {a.statusLabel}
          </span>
          <SheetTitle className="text-base font-semibold leading-snug">{a.title}</SheetTitle>
          {a.corpsEtat && <p className="text-[13px] text-muted-foreground">{a.corpsEtat}</p>}
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {a.body && <p className="text-[13.5px]">{a.body}</p>}

          {/* ── L'HISTOIRE D'ABORD : pourquoi cette action existe ── */}
          {a.source && (
            <section>
              <h4 className={H4}>Pourquoi cette action</h4>
              {a.source.available ? (
                <div className="mt-1 space-y-0.5">
                  <p className="text-[12px] font-medium text-muted-foreground">{a.source.typeLabel}</p>
                  <p className="text-[13.5px] font-medium">{a.source.title}</p>
                  {a.source.detail && <p className="text-[12px] text-muted-foreground">{a.source.detail}</p>}
                  {a.source.href && (
                    <Link href={a.source.href} className="inline-flex items-center gap-0.5 pt-0.5 text-[13px] font-medium text-primary hover:underline">
                      {a.source.linkLabel} <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ) : (
                // Une relation existait mais l'objet a disparu — jamais masqué.
                <p className="mt-1 text-[13px] text-muted-foreground">Origine indisponible</p>
              )}
              {/* Ce qui a été observé sur le terrain — la capture précise qui a
                  déclenché l'action. Le PROBLÈME, pas seulement le titre. */}
              {a.observed && (
                <div className="mt-2.5 rounded-lg border-l-2 border-primary/40 bg-muted/40 p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Ce qui a été observé</p>
                  {a.observed.text && <p className="mt-1 text-[13px] italic">« {a.observed.text} »</p>}
                  {(a.observed.isVocal || a.observed.authorLabel) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[11.5px] text-muted-foreground">
                      {a.observed.isVocal && <span>🎤 Mémo vocal (transcription)</span>}
                      {a.observed.authorLabel && <span>Noté par {a.observed.authorLabel}</span>}
                    </div>
                  )}
                  {a.observed.photoUrl && (
                    <a href={a.observed.photoUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block w-fit">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.observed.photoUrl} alt="Photo prise sur le terrain" className="max-h-40 w-auto rounded-md border" />
                    </a>
                  )}
                  {a.observed.photoMissing && <p className="mt-1 text-[11.5px] text-muted-foreground">Photo indisponible</p>}
                </div>
              )}
              {a.context && (
                <div className="mt-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Contexte</p>
                  {a.context.href ? (
                    <Link href={a.context.href} className="text-[13px] text-primary hover:underline">{a.context.label}</Link>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">{a.context.label}</p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── ÉTAT ACTUEL : où en est l'engagement, en un coup d'œil (dérivé) ── */}
          <section>
            <h4 className={H4}>État actuel</h4>
            <ul className="mt-1.5 space-y-1">
              {a.progress.map((p) => (
                <li key={p.label} className="flex items-center gap-2 text-[13px]">
                  {p.done
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
                  <span className={p.done ? 'text-foreground' : 'text-muted-foreground'}>{p.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className={H4}>Responsable</h4>
            {a.responsible?.kind === 'contact' ? (
              <p className="mt-1 inline-flex items-center gap-1 text-[13.5px] font-medium text-emerald-700 dark:text-emerald-400">
                <UserCheck className="h-3.5 w-3.5" />
                {a.responsible.name}{a.responsible.fonction ? ` · ${a.responsible.fonction}` : ''}
              </p>
            ) : a.responsible?.kind === 'text' ? (
              // Trace texte historique — jamais présentée comme une personne.
              <p className="mt-1 text-[13px] text-muted-foreground">Responsable (ancien suivi) : {a.responsible.label}</p>
            ) : (
              <p className="mt-1 text-[13px] text-muted-foreground">À affecter — aucun responsable identifié.</p>
            )}
          </section>

          {date.label && (
            <section>
              <h4 className={H4}>Échéance</h4>
              <p className={cn('mt-1 text-[13.5px]', date.kind === 'late' && 'text-rose-600 dark:text-rose-400')}>
                {date.label}
              </p>
            </section>
          )}

          {/* ── LE DÉROULÉ : uniquement les faits journalisés (site_action_events),
               présentés comme un fil. Jamais reconstruit depuis l'état courant. ── */}
          <section>
            <h4 className={H4}>Historique</h4>
            <div className="mt-1.5 space-y-3">
              {a.historyDays.map((day) => (
                <div key={day.dayIso}>
                  <p className="text-[11.5px] font-medium text-muted-foreground">{day.dayLabel}</p>
                  <ul className="mt-1.5 space-y-2 border-l border-border pl-3.5">
                    {day.items.map((it) => {
                      const actor = it.actorLabel
                        ? `Par ${it.actorLabel}`
                        : it.actorFallback === 'auto'
                          ? 'Automatique'
                          : it.actorFallback === 'unknown'
                            ? 'Auteur indisponible'
                            : null
                      return (
                        <li key={it.id} className="relative text-[13px]">
                          <span className="absolute -left-[18px] top-1 h-2 w-2 rounded-full bg-primary/70 ring-2 ring-background" />
                          <div className="flex items-baseline gap-2">
                            <span className="font-medium">{it.line}</span>
                            <span className="text-[11px] tabular-nums text-muted-foreground/70">{it.time}</span>
                          </div>
                          {it.detail && <div className="text-[12.5px] text-muted-foreground">{it.detail}</div>}
                          {actor && <div className="text-[12px] text-muted-foreground/80">{actor}</div>}
                          {it.reason && <div className="text-[12.5px] text-muted-foreground">Motif : {it.reason}</div>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {a.historyNote && <p className="mt-2 text-[12px] italic text-muted-foreground">{a.historyNote}</p>}
          </section>

          {a.proofs && (
            <section>
              <h4 className={H4}>{a.proofs.scope === 'current' ? 'Preuves' : 'Clôture antérieure'}</h4>
              {a.proofs.scope === 'previous' && (
                // Les traces d'une clôture antérieure ne prouvent PAS l'état courant :
                // l'action a été rouverte. On ne les présente jamais comme « terminé ».
                <p className="mt-1 text-[12px] text-muted-foreground/80">
                  Éléments fournis lors d’une clôture antérieure{a.proofs.dateLabel ? ` · ${a.proofs.dateLabel}` : ''}. L’action a depuis été rouverte.
                </p>
              )}
              {a.proofs.empty ? (
                <p className="mt-1 text-[13px] text-muted-foreground">Action marquée terminée — aucune trace de clôture enregistrée.</p>
              ) : (
                <div className="mt-1.5 space-y-2.5 text-[13px]">
                  {a.proofs.photo && (
                    <div>
                      <p className="font-medium">{a.proofs.scope === 'current' ? 'Photo de clôture' : 'Photo fournie à la clôture'}</p>
                      {a.proofs.scope === 'current' && a.proofs.dateLabel && (
                        <p className="text-[12px] text-muted-foreground">Ajoutée le {a.proofs.dateLabel}</p>
                      )}
                      {a.proofs.photo.url ? (
                        <a href={a.proofs.photo.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 pt-0.5 text-[13px] font-medium text-primary hover:underline">
                          Ouvrir la photo <ChevronRight className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        // Fichier disparu du stockage — état honnête, jamais un lien mort.
                        <p className="text-[12px] text-muted-foreground">Fichier indisponible</p>
                      )}
                    </div>
                  )}
                  {a.proofs.comment && (
                    <div>
                      <p className="font-medium">{a.proofs.scope === 'current' ? 'Commentaire de réalisation' : 'Commentaire de clôture'}</p>
                      <p className="text-[13px] text-muted-foreground">« {a.proofs.comment} »</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── RELATIONS : naviguer dans la mémoire du chantier (provenance connue) ── */}
          {a.relations.length > 0 && (
            <section>
              <h4 className={H4}>Relations</h4>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {a.relations.map((r, i) => r.href ? (
                  <Link key={i} href={r.href} className="rounded-lg border px-2.5 py-1 text-[12px] hover:bg-muted">{r.label}</Link>
                ) : (
                  <span key={i} className="rounded-lg border px-2.5 py-1 text-[12px] text-muted-foreground">{r.label}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
