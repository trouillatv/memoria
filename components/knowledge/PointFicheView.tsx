// ── FICHE POINT — vue présentationnelle unique (6F, mandat Vincent) ──────────
//
// Un seul composant, monté sur desktop ET mobile (la grille 2 colonnes retombe
// naturellement en 1 colonne sous lg). Purement présentationnel : toute la
// logique (état dérivé, tri des preuves, résolution du Point merged) vient de
// `getTrackedPointDetail` — ce composant ne fait AUCUN calcul d'état.
//
// Priorité de lecture (mandat Vincent) : « ce qu'il faut retenir aujourd'hui »
// tout en haut, puis Situation actuelle (pourquoi cet état), puis ce qu'il
// reste à faire, puis l'évolution qui a mené à cet état.
//
// UX : le conducteur ne doit jamais avoir besoin de comprendre canonical_subject,
// CBO, membership ou les UUID — ces notions restent dans le bloc « Détails
// techniques » (§7), replié par défaut (<details> natif, zéro JS).

import Link from 'next/link'
import { ChevronRight, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TrackedPointDetail, PointDetailLinkedObject } from '@/lib/knowledge/tracked-point-detail'

const STATE_CLS: Record<TrackedPointDetail['derivedState'], string> = {
  unknown: 'bg-muted text-muted-foreground ring-border',
  open: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  reopened: 'bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900',
  conflict: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
}

const STATE_HERO_CLS: Record<TrackedPointDetail['derivedState'], string> = {
  unknown: 'border-border bg-muted/20',
  open: 'border-sky-300/70 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/15',
  resolved: 'border-emerald-300/70 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/15',
  reopened: 'border-orange-300/70 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/15',
  conflict: 'border-rose-300/70 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/15',
}

const H2 = 'text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground'
const TH = 'px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground'

function ResponsibleLabel({ o }: { o: PointDetailLinkedObject }) {
  if (!o.responsible) return <span className="text-muted-foreground/60">—</span>
  if (o.responsible.kind === 'text') return <span>{o.responsible.label}</span>
  return <span>{o.responsible.name}</span>
}

function LinkedObjectRow({ o }: { o: PointDetailLinkedObject }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <Link href={o.href} className="text-[13.5px] font-medium text-primary hover:underline">{o.title}</Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
          <span>{o.statusLabel}</span>
          {o.dueDateLabel && <span>· échéance {o.dueDateLabel}</span>}
          {o.responsible && (
            <span>
              · {o.responsible.kind === 'text' ? `resp. (ancien suivi) ${o.responsible.label}` : o.responsible.name}
            </span>
          )}
        </div>
      </div>
      {o.isLate && (
        <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          En retard
        </span>
      )}
    </li>
  )
}

const OBJECT_TYPE_LABEL: Record<PointDetailLinkedObject['objectType'], string> = {
  site_action: 'Action', site_reserve: 'Réserve', site_deadline: 'Échéance',
}

function LinkedObjectsTable({ items, emptyLabel }: { items: PointDetailLinkedObject[]; emptyLabel: string }) {
  if (items.length === 0) return <p className="px-1 py-2 text-[13px] text-muted-foreground">{emptyLabel}</p>
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className={TH}>Type</th>
            <th className={TH}>Responsable</th>
            <th className={TH}>Échéance</th>
            <th className={cn(TH, 'text-right')}>Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((o) => (
            <tr key={`${o.objectType}:${o.id}`} className={cn(o.isLate && 'bg-rose-50/50 dark:bg-rose-950/10')}>
              <td className="px-3 py-2">
                <Link href={o.href} className="text-[13px] font-medium text-primary hover:underline">{o.title}</Link>
                <div className="text-[11px] text-muted-foreground">{OBJECT_TYPE_LABEL[o.objectType]}</div>
              </td>
              <td className="px-3 py-2 text-[12.5px]"><ResponsibleLabel o={o} /></td>
              <td className="px-3 py-2 text-[12.5px] text-muted-foreground">{o.dueDateLabel ?? '—'}</td>
              <td className="px-3 py-2 text-right">
                <span className={cn(
                  'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium',
                  o.isLate ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                    : o.isDone ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground',
                )}>
                  {o.isLate ? 'En retard' : o.statusLabel}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PointFicheView({ point, backHref, backLabel }: { point: TrackedPointDetail; backHref: string; backLabel: string }) {
  const p = point

  return (
    <div className="space-y-5">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        ← {backLabel}
      </Link>

      {p.mergeNotice && (
        <p className="rounded-lg border-l-2 border-amber-400/60 bg-amber-50/40 p-3 text-[12.5px] text-muted-foreground dark:bg-amber-950/10">
          Vous consultiez « {p.mergeNotice.requestedLabel} », fusionné dans ce Point — la vérité affichée ci-dessous est celle du Point regroupé.
        </p>
      )}

      {/* Ce qu'il faut retenir aujourd'hui — priorité absolue, surtout mobile. */}
      <section className={cn('rounded-2xl border-2 px-5 py-3.5', STATE_HERO_CLS[p.derivedState])}>
        <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Ce qu’il faut retenir aujourd’hui</p>
        <p className="mt-1 text-[15px] font-semibold leading-snug sm:text-base">{p.headline}</p>
      </section>

      {/* En-tête */}
      <section className="rounded-[22px] border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {p.ownerCanonicalSubjectLabel && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{p.ownerCanonicalSubjectLabel}</p>
            )}
            <h1 className="mt-0.5 text-xl font-semibold leading-snug">{p.label}</h1>
          </div>
          <span className={cn('shrink-0 w-fit rounded-full px-3 py-1 text-sm font-medium ring-1', STATE_CLS[p.derivedState])}>
            {p.derivedStateLabel}
          </span>
        </div>

        {p.markerLabels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.markerLabels.map((m) => (
              <span key={m} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{m}</span>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* §1 — Situation actuelle : bloc central, volontairement le plus visible. */}
          <section className={cn('rounded-[18px] border-2 px-5 py-4 space-y-2.5', STATE_HERO_CLS[p.derivedState])}>
            <h2 className={H2}>1. Situation actuelle</h2>
            <p className="text-[14px] leading-relaxed">
              Ce Point est aujourd’hui <strong>{p.derivedStateLabel.toLowerCase()}</strong>
              {p.ownerCanonicalSubjectLabel ? <> — dans le cadre du sujet « {p.ownerCanonicalSubjectLabel} »</> : null}.
            </p>
            {p.hasDocumentaryDivergence && p.documentaryDivergences.map((d, i) => (
              <p key={i} className="rounded-md bg-amber-50/60 px-2.5 py-1.5 text-[12.5px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                Divergence documentaire : {d}
              </p>
            ))}
            {p.hasConflict && p.conflicts.map((c, i) => (
              <p key={i} className="rounded-md bg-rose-50/60 px-2.5 py-1.5 text-[12.5px] text-rose-800 dark:bg-rose-950/20 dark:text-rose-300">
                Conflit : {c}
              </p>
            ))}
            <p className="text-[12px] text-muted-foreground">
              {p.latestMeaningfulEventLabel && <>Dernière évolution significative le {p.latestMeaningfulEventLabel}</>}
              {p.latestMeaningfulEventLabel && p.latestEvidenceAt && ' · '}
              {p.latestEvidenceAt && <>Dernière preuve vue le {p.evidence[0]?.dateLabel}</>}
              {!p.latestMeaningfulEventLabel && !p.latestEvidenceAt && 'Aucune évolution enregistrée pour l’instant.'}
            </p>
          </section>

          {/* §2 — Ce qu'il reste à faire */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2.5">
            <h2 className={H2}>2. Ce qu’il reste à faire</h2>
            <LinkedObjectsTable items={p.openLinkedObjects} emptyLabel="Rien à faire actuellement sur ce Point." />
          </section>

          {/* §3 — Évolution */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2">
            <h2 className={H2}>3. Évolution</h2>
            {p.trajectory.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucun événement significatif enregistré.</p>
            ) : (
              <ul className="space-y-2.5 border-l border-border pl-3.5">
                {p.trajectory.map((t, i) => (
                  <li key={i} className="relative text-[13px]">
                    <span className={cn(
                      'absolute -left-[18px] top-1 h-2 w-2 rounded-full ring-2 ring-background',
                      t.isResolving ? 'bg-emerald-500' : 'bg-primary/70',
                    )} />
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium">{t.kindLabel}</span>
                      {t.dateLabel && <span className="text-[11px] text-muted-foreground/70">{t.dateLabel}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* §4 — Preuves et sources */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2.5">
            <h2 className={H2}>4. Preuves et sources</h2>
            {p.evidence.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucune preuve documentaire rattachée.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className={TH}>Date</th>
                      <th className={TH}>Type</th>
                      <th className={TH}>Source</th>
                      <th className={TH} />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {p.evidence.map((e) => (
                      <tr key={e.proposalId}>
                        <td className="whitespace-nowrap px-3 py-2 text-[12.5px] text-muted-foreground">{e.dateLabel ?? '—'}</td>
                        <td className="px-3 py-2 text-[12.5px]">
                          <span className={cn('font-medium', e.isResolving ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground')}>
                            {e.kindLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[12.5px]">
                          {e.documentFilename ?? '—'}
                          {e.sourcePage && <span className="text-muted-foreground"> · p.{e.sourcePage}</span>}
                          {e.sourceExcerpt && <p className="mt-0.5 italic leading-snug text-muted-foreground">« {e.sourceExcerpt} »</p>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {e.href && (
                            <Link href={e.href} className="inline-flex items-center gap-0.5 text-[12px] font-medium text-primary hover:underline">
                              Ouvrir <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* §5 — Actions et délais liés (historique complet, fait + à faire) */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2">
            <h2 className={H2}>5. Actions et délais liés</h2>
            {p.linkedObjects.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucune action, réserve ou échéance rattachée à ce Point.</p>
            ) : (
              <>
                {p.openLinkedObjects.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">À faire</p>
                    <ul className="divide-y divide-border/60">{p.openLinkedObjects.map((o) => <LinkedObjectRow key={`${o.objectType}:${o.id}`} o={o} />)}</ul>
                  </div>
                )}
                {p.closedLinkedObjects.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Fait</p>
                    <ul className="divide-y divide-border/60">{p.closedLinkedObjects.map((o) => <LinkedObjectRow key={`${o.objectType}:${o.id}`} o={o} />)}</ul>
                  </div>
                )}
              </>
            )}
          </section>

          {/* §6 — Acteurs */}
          <section className="rounded-[18px] border bg-card px-5 py-4 space-y-2">
            <h2 className={H2}>6. Acteurs</h2>
            {p.actors.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Aucun acteur explicitement identifié pour ce Point.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {p.actors.map((a) => (
                  <li key={a.id} className="rounded-lg border px-2.5 py-1 text-[12.5px]">
                    {a.name}{a.fonction ? ` · ${a.fonction}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Colonne latérale — métadonnées et récapitulatifs compacts. */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <section className="rounded-[16px] border bg-card px-4 py-3.5 space-y-2">
            <h2 className={H2}>Informations</h2>
            <dl className="space-y-1.5 text-[12.5px]">
              {p.ownerCanonicalSubjectLabel && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Sujet lié</dt>
                  <dd className="text-right font-medium">{p.ownerCanonicalSubjectLabel}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">Statut</dt>
                <dd className="text-right font-medium">{p.derivedStateLabel}</dd>
              </div>
              {p.createdAtLabel && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Créé le</dt>
                  <dd className="text-right">{p.createdAtLabel}</dd>
                </div>
              )}
              {p.latestMeaningfulEventLabel && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Dernière évolution</dt>
                  <dd className="text-right">{p.latestMeaningfulEventLabel}</dd>
                </div>
              )}
              {p.evidence[0]?.dateLabel && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">Dernière preuve</dt>
                  <dd className="text-right">{p.evidence[0].dateLabel}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <dt className="text-muted-foreground">Identité</dt>
                <dd>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{p.identityStatus}</span>
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[16px] border bg-card px-4 py-3.5 space-y-2">
            <h2 className={H2}>Documents liés</h2>
            {p.evidence.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Aucun document rattaché.</p>
            ) : (
              <ul className="space-y-1.5">
                {[...new Map(p.evidence.filter((e) => e.href).map((e) => [e.documentId, e])).values()].slice(0, 6).map((e) => (
                  <li key={e.documentId}>
                    <Link href={e.href!} className="flex items-center gap-1.5 text-[12.5px] text-primary hover:underline">
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{e.documentFilename ?? 'Document'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[16px] border bg-card px-4 py-3.5 space-y-2">
            <h2 className={H2}>Actions et délais liés</h2>
            {p.openLinkedObjects.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">Rien d’ouvert actuellement.</p>
            ) : (
              <ul className="space-y-1.5">
                {p.openLinkedObjects.slice(0, 5).map((o) => (
                  <li key={`${o.objectType}:${o.id}`} className="flex items-start justify-between gap-2">
                    <Link href={o.href} className="min-w-0 truncate text-[12.5px] text-primary hover:underline">{o.title}</Link>
                    {o.isLate && <span className="shrink-0 text-[10.5px] font-semibold text-rose-700 dark:text-rose-300">retard</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* §7 — Identité / mémoire, secondaire, replié par défaut, zéro JS. */}
      <details className="rounded-[18px] border bg-card px-5 py-4">
        <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Détails techniques
        </summary>
        <dl className="mt-3 space-y-1.5 text-[12.5px]">
          <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Point ID</dt><dd className="font-mono text-[11.5px]">{p.id}</dd></div>
          {p.ownerCanonicalSubjectId && (
            <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Sujet canonique</dt><dd className="font-mono text-[11.5px]">{p.ownerCanonicalSubjectId}</dd></div>
          )}
          <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Identité</dt><dd>{p.identityStatus}</dd></div>
          <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Origine</dt><dd>{p.foundingKind}{p.foundingSource ? ` · ${p.foundingSource}` : ''}</dd></div>
          {p.hasUpstreamDefect && (
            <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Défaut amont</dt><dd>oui</dd></div>
          )}
          {p.cboIds.length > 0 && (
            <div className="flex gap-2"><dt className="w-40 shrink-0 text-muted-foreground">Objets métier (CBO)</dt><dd className="font-mono text-[11.5px]">{p.cboIds.join(', ')}</dd></div>
          )}
          {p.mergedFrom.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-40 shrink-0 text-muted-foreground">Fusionné depuis</dt>
              <dd>{p.mergedFrom.map((m) => m.label).join(', ')}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  )
}
