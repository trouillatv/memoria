'use client'

// ── LA FICHE ACTION — lecture canonique d'une action (Lot 4 · Slice 3) ───────
// Comme la fiche Intervenant : un Sheet latéral, présentationnel pur, alimenté
// par un read model unique (getSiteActionFiche). On y LIT une action en entier :
// responsable identifié (preuve structurelle), échéance/retard, statut, source,
// historique minimal. Aucune écriture ici (clôture = Slice 8).

import Link from 'next/link'
import { ChevronRight, UserCheck, CheckCircle2, Circle } from 'lucide-react'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FicheTrail, type TrailNode, type TrailBack } from '@/components/knowledge/FicheTrail'
import { FicheChapo, type Chapo } from '@/components/knowledge/FicheChapo'
import { FICHE_TITLE_MOTION, FICHE_BODY_MOTION } from '@/components/knowledge/fiche-motion'
import { cn } from '@/lib/utils'
import { todayLocalIso } from '@/lib/time/local-date'
import { describeAssignedActionDate } from '@/lib/knowledge/assigned-actions'
import type { ActionFicheData } from '@/lib/knowledge/action-fiche'
import type { SiteActionStatus } from '@/types/db'

// Trois niveaux de poids visuel — le dossier hiérarchise, il ne s'aplatit pas.
const H4 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground' // moyen
const H4_STRONG = 'text-[11.5px] font-semibold uppercase tracking-wide text-foreground' // fort
const H4_MUTED = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/50' // discret

const STATUS_CLS: Record<SiteActionStatus, string> = {
  open: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  planned: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  cancelled: 'bg-muted text-muted-foreground ring-border',
}

// Le CORPS de la fiche Action, sans coquille Sheet : monté à l'intérieur d'un
// Sheet partagé (la coquille persistante du parcours). Aucun changement visuel.
export function ActionFicheBody({ action, back }: { action: ActionFicheData | null; back?: TrailBack | null }) {
  if (!action) return null
  const a = action
  const date = describeAssignedActionDate(
    { dueDate: a.dueDate, dueDateStatus: a.dueDateStatus, isLate: a.isLate },
    todayLocalIso(),
  )

  // Le fil : [Réunion/Visite] › [Décision] › Action, le point sous l'Action.
  // Le maillon amont préfère la réunion/visite (chaîne causale) ; à défaut, le
  // contexte, puis la réserve/le sujet d'origine. Depuis des champs déjà chargés.
  let amont: TrailNode | null = null
  if (a.source?.available && (a.source.type === 'reunion' || a.source.type === 'visite')) {
    amont = { typeLabel: a.source.type === 'visite' ? 'Visite' : 'Réunion', href: a.source.href, current: false }
  } else if (a.context) {
    amont = { typeLabel: 'Réunion', href: a.context.href, current: false }
  } else if (a.source?.available) {
    amont = { typeLabel: a.source.type === 'reserve' ? 'Réserve' : 'Sujet', href: a.source.href, current: false }
  }
  const trail: TrailNode[] = [
    ...(amont ? [amont] : []),
    ...(a.fromDecision ? [{ typeLabel: 'Décision', href: a.fromDecision.href, current: false }] : []),
    { typeLabel: 'Action', href: null, current: true },
  ]

  // Le chapô : la relation CENTRALE d'une action = ce dont elle découle (la
  // décision d'abord, sinon son origine). Une seule relation, cliquable.
  const chapo: Chapo | null = a.fromDecision
    ? { label: 'Découle de', title: a.fromDecision.title, href: a.fromDecision.href }
    : a.source?.available
      ? { label: 'Découle de', title: a.source.title, href: a.source.href }
      : null

  return (
    <>
        <SheetHeader className="pb-0">
          <FicheTrail nodes={trail} back={back} />
          <span className={cn('w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', STATUS_CLS[a.status])}>
            {a.statusLabel}
          </span>
          <SheetTitle className={cn('text-base font-semibold leading-snug', FICHE_TITLE_MOTION)}>{a.title}</SheetTitle>
          <FicheChapo chapo={chapo} className={FICHE_TITLE_MOTION} />
          {a.corpsEtat && <p className="text-[13px] text-muted-foreground">{a.corpsEtat}</p>}
        </SheetHeader>

        <div className={cn('space-y-5 px-4 pb-6', FICHE_BODY_MOTION)}>
          {a.body && <p className="text-[13.5px]">{a.body}</p>}

          {/* ── 1. CE QUI A ÉTÉ OBSERVÉ — en tête : ça dit tout de suite POURQUOI ── */}
          {a.observed && (
            <section className="rounded-lg border-l-2 border-primary/50 bg-muted/40 p-3">
              <h4 className={H4_STRONG}>Ce qui a été observé</h4>
              {a.observed.text && <p className="mt-1.5 text-[13.5px] italic leading-relaxed">« {a.observed.text} »</p>}
              {(a.observed.isVocal || a.observed.authorLabel) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[11.5px] text-muted-foreground">
                  {a.observed.isVocal && <span>🎤 Mémo vocal (transcription)</span>}
                  {a.observed.authorLabel && <span>Noté par {a.observed.authorLabel}</span>}
                </div>
              )}
              {a.observed.photoUrl && (
                <a href={a.observed.photoUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block w-fit">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.observed.photoUrl} alt="Photo prise sur le terrain" className="max-h-44 w-auto rounded-md border" />
                </a>
              )}
              {a.observed.photoMissing && <p className="mt-1 text-[11.5px] text-muted-foreground">Photo indisponible</p>}
            </section>
          )}

          {/* ── 2. CHANTIER — le contexte principal : « sur quel chantier ? » ── */}
          <section>
            <h4 className={H4}>📍 Chantier</h4>
            <p className="mt-1 text-[13.5px] font-medium">{a.siteName}</p>
            <Link href={`/sites/${a.siteId}`} className="inline-flex items-center gap-0.5 pt-0.5 text-[13px] font-medium text-primary hover:underline">
              Voir le chantier <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </section>

          {/* ── PROVENANCE — désormais portée par le fil (les maillons amont) et le
               chapô (« Découle de : … ») ; on ne la répète plus en section. L'auteur
               vit dans l'historique. Seul l'état honnête « origine perdue » reste
               visible : une relation existait, l'objet a disparu — jamais masqué. ── */}
          {a.source && !a.source.available && (
            <p className="text-[13px] text-muted-foreground">Origine indisponible — la relation existait, l’objet a disparu.</p>
          )}

          {/* ── ÉTAT — où en est l'engagement (dérivé, le chemin restant). « État »,
               pas « Progression » : c'est l'avancement de l'objet, pas une courbe. ── */}
          <section>
            <h4 className={H4_STRONG}>État de l’action</h4>
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

          {/* ── 5. RESPONSABLE ── */}
          <section>
            <h4 className={H4}>👤 Responsable</h4>
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

          {a.proofs && (
            <section>
              <h4 className={H4}>{a.proofs.scope === 'current' ? 'Preuves' : 'Clôture antérieure'}</h4>
              {a.proofs.scope === 'current' && (a.proofs.dateLabel || a.closedByLabel) && (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Clôturée{a.proofs.dateLabel ? ` le ${a.proofs.dateLabel}` : ''}{a.closedByLabel ? ` · par ${a.closedByLabel}` : ''}
                </p>
              )}
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

          {/* ── ZONE DISCRÈTE : relations + historique. Utiles, mais en retrait —
               le dossier ne doit pas s'aplatir en longue fiche. ── */}
          {a.relations.length > 0 && (
            <section className="border-t border-border/60 pt-4">
              <h4 className={H4_MUTED}>🔗 Relations</h4>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {a.relations.map((r, i) => r.href ? (
                  <Link key={i} href={r.href} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] hover:bg-muted"><span aria-hidden>{r.icon}</span>{r.label}</Link>
                ) : (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] text-muted-foreground"><span aria-hidden>{r.icon}</span>{r.label}</span>
                ))}
              </div>
            </section>
          )}

          {/* ── LE DÉROULÉ, EN BAS : on ouvre la fiche pour comprendre POURQUOI, pas
               pour savoir à quelle heure elle a été créée. Uniquement les faits
               journalisés (site_action_events), en fil. Jamais reconstruit. ── */}
          <section>
            <h4 className={H4_MUTED}>📜 Historique</h4>
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
        </div>
    </>
  )
}
