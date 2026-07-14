// Composant SERVER : rendu du payload d'un brief.
//
// Utilisé par :
//   - /handovers/[id]/page.tsx (vue authentifiée admin/manager)
//   - /h/[token]/page.tsx (vue publique partagée)
//
// Pas de mutations ici, lecture seule. Les boutons d'action sont sur la page
// parente (selon contexte auth vs public).
//
// Doctrine V2 : description neutre, jamais évaluative. Le payload est un
// snapshot — on l'affiche brut, on n'invente pas de nuance.

import Link from 'next/link'
import {
  MapPin,
  AlertTriangle,
  FileText,
  Users,
  Pin,
  ChevronRight,
  ClipboardCheck,
  ListTodo,
  FileCheck2,
  CalendarClock,
} from 'lucide-react'
import { TeamBadge } from '@/components/ui/team-badge'
import { formatRelativeLong } from '@/lib/format'
import type { HandoverPayload } from '@/types/db'
import { ResolveAnomalyButton } from './ResolveAnomalyButton'

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const CATEGORY_LABEL: Record<string, string> = {
  materiel_casse: 'Matériel manquant',
  produit_manquant: 'Produit manquant',
  acces_bloque: 'Accès impossible',
  eau_coupee: 'Eau coupée',
  electricite_coupee: 'Électricité coupée',
  zone_non_prete: 'Zone non prête',
  danger_securite: 'Danger / sécurité',
  livraison_probleme: 'Livraison problème',
  retard: 'Retard',
  autre: 'Autre',
  // tolère les valeurs hors enum classique sans casser
}

const DOC_TYPE_LABEL: Record<string, string> = {
  contrat: 'Contrat',
  avenant: 'Avenant',
  procedure: 'Procédure',
  protocole: 'Protocole',
  plan_acces: 'Plan d’accès',
  securite: 'Sécurité',
  ao: 'Dossier de démarrage',
  memoire_technique: 'Mémoire technique',
  reference: 'Référence',
  facture: 'Facture',
  preuve: 'Preuve',
  autre: 'Document',
}

interface Props {
  payload: HandoverPayload
  /** Mode public masque les liens internes (pas /sites/, pas /contracts/). */
  publicView?: boolean
}

export function HandoverPayloadView({ payload, publicView = false }: Props) {
  return (
    <div className="space-y-6">
      {/* Contexte */}
      <section className="rounded-lg border bg-card p-4 space-y-2">
        <h2 className="text-sm font-medium">Contexte</h2>
        <p className="text-sm">{payload.context}</p>
        <p className="text-[11px] text-muted-foreground italic">
          Snapshot généré le{' '}
          {new Date(payload.generatedAt).toLocaleString('fr-FR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          . Les données affichées reflètent ce qui était vrai à ce moment précis.
        </p>
      </section>

      {/* Notes manuelles éventuelles */}
      {payload.manualNotes && (
        <section className="rounded-lg border border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-2">
          <h2 className="text-sm font-medium flex items-center gap-2 text-amber-900 dark:text-amber-200">
            <Pin className="h-4 w-4" />
            Notes du manager
          </h2>
          <p className="text-sm whitespace-pre-wrap">{payload.manualNotes}</p>
        </section>
      )}

      {/* Sites */}
      {payload.sites.length === 0 ? (
        <section className="rounded-lg border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground italic">
            Aucun chantier concerné — le sujet du brief n’a pas de chantier documenté
            sur la période couverte.
          </p>
        </section>
      ) : (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {payload.sites.length === 1
                ? 'Site concerné'
                : `${payload.sites.length} sites concernés`}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Triés par fréquence d&apos;intervention
            </p>
          </div>

          {payload.sites.map((s) => (
            <article
              key={s.site_id}
              className="rounded-lg border bg-card p-4 space-y-4"
              data-site-id={s.site_id}
            >
              {/* En-tête site */}
              <header className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
                <div className="min-w-0">
                  <h3 className="text-base font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-brand-600 shrink-0" />
                    {publicView ? (
                      <span>{s.site_name}</span>
                    ) : (
                      <Link
                        href={`/sites/${s.site_id}`}
                        className="hover:text-brand-700 inline-flex items-center gap-1"
                      >
                        {s.site_name}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {s.client_name && <>Client : {s.client_name}</>}
                    {s.client_name && s.contract_name && ' · '}
                    {s.contract_name &&
                      (publicView ? (
                        <>{s.contract_name}</>
                      ) : (
                        <Link
                          href={s.contract_id ? `/contracts/${s.contract_id}` : '#'}
                          className="hover:underline"
                        >
                          {s.contract_name}
                        </Link>
                      ))}
                  </p>
                </div>
                <div className="text-right text-[11px] text-muted-foreground tabular-nums">
                  <p>
                    {s.interventionsCount} intervention
                    {s.interventionsCount > 1 ? 's' : ''}
                  </p>
                  <p>Dern. {fmtDateShort(s.lastInterventionDate)}</p>
                </div>
              </header>

              {/* À savoir */}
              {s.aSavoir.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <Pin className="h-3 w-3 text-brand-600" />À savoir
                  </p>
                  <ul className="space-y-1">
                    {s.aSavoir.map((a) => (
                      <li
                        key={a.id}
                        className="text-sm rounded-md border border-rose-200 bg-rose-50/40 dark:bg-rose-950/20 px-3 py-1.5"
                      >
                        {a.description ?? a.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Anomalies récentes — Sprint D : âge relatif + bouton résoudre */}
              {s.recentAnomalies.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3 text-orange-600" />
                    Anomalies actives (90 derniers jours)
                  </p>
                  <ul className="space-y-1">
                    {s.recentAnomalies.map((a) => (
                      <li
                        key={a.id}
                        className="text-xs rounded-md border border-orange-200 bg-orange-50/40 dark:bg-orange-950/20 px-3 py-1.5 flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">
                            {CATEGORY_LABEL[a.category] ?? a.category}
                          </span>
                          {a.description && ` — ${a.description}`}
                          <span className="ml-1 text-muted-foreground italic">
                            · {formatRelativeLong(a.occurredAt)}
                          </span>
                        </div>
                        {!publicView && (
                          <ResolveAnomalyButton anomalyId={a.id} />
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-muted-foreground italic">
                    Les anomalies résolues n&apos;apparaissent plus dans les briefs.
                    Tu peux marquer résolu directement ici.
                  </p>
                </div>
              )}

              {/* Réserves ouvertes (état du site à reprendre) */}
              {s.openReserves.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <ClipboardCheck className="h-3 w-3 text-amber-600" />
                    Réserves ouvertes
                  </p>
                  <ul className="space-y-1">
                    {s.openReserves.map((r) => (
                      <li key={r.id} className="text-xs rounded-md border border-amber-200 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-1.5">
                        <span className="font-medium">{r.label}</span>
                        {r.location && <span className="text-muted-foreground"> · {r.location}</span>}
                        {r.issuedOn && <span className="text-muted-foreground italic"> · émise le {r.issuedOn}</span>}
                      </li>
                    ))}
                  </ul>
                  {s.openReservesMore > 0 && (
                    <p className="text-[10px] text-muted-foreground">+{s.openReservesMore} autre{s.openReservesMore > 1 ? 's' : ''} réserve{s.openReservesMore > 1 ? 's' : ''} ouverte{s.openReservesMore > 1 ? 's' : ''}</p>
                  )}
                </div>
              )}

              {/* Actions à suivre — en retard d'abord */}
              {s.openActions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <ListTodo className="h-3 w-3 text-sky-600" />
                    Actions à suivre
                  </p>
                  <ul className="space-y-1">
                    {s.openActions.map((a) => (
                      <li key={a.id} className="text-xs rounded-md border bg-muted/20 px-3 py-1.5">
                        <span className="font-medium">{a.title}</span>
                        {a.assignedTo && <span className="text-muted-foreground"> — {a.assignedTo}</span>}
                        {a.dueDate && (
                          <span className={a.late ? 'text-rose-700 font-medium' : 'text-muted-foreground'}>
                            {' '}· échéance {a.dueDate}{a.late ? ' (en retard)' : ''}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {s.openActionsMore > 0 && (
                    <p className="text-[10px] text-muted-foreground">+{s.openActionsMore} autre{s.openActionsMore > 1 ? 's' : ''} action{s.openActionsMore > 1 ? 's' : ''} à suivre</p>
                  )}
                </div>
              )}

              {/* Prochaines échéances — ce qui attend celui qui reprend. */}
              {(s.nextEvents?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <CalendarClock className="h-3 w-3 text-sky-600" />
                    Prochaines échéances
                  </p>
                  <ul className="space-y-1">
                    {s.nextEvents?.map((e) => (
                      <li key={e.id} className="text-xs rounded-md border bg-muted/20 px-3 py-1.5">
                        <span className="font-medium">{e.label}</span>
                        <span className="text-muted-foreground">
                          {' '}· {e.on}
                          {e.teamName ? ` · ${e.teamName}` : ' · équipe non affectée'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Décisions récentes validées */}
              {s.recentDecisions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <FileCheck2 className="h-3 w-3 text-indigo-600" />
                    Décisions récentes
                  </p>
                  <ul className="space-y-1">
                    {s.recentDecisions.map((d) => (
                      <li key={d.id} className="text-xs rounded-md border bg-muted/20 px-3 py-1.5">
                        <span className="font-medium">{d.label}</span>
                        {d.corpsEtat && <span className="text-muted-foreground"> · {d.corpsEtat}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Documents */}
              {s.documents.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-violet-600" />
                    Documents rattachés
                  </p>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {s.documents.map((d) => (
                      <li key={d.id}>
                        {publicView ? (
                          <span className="text-xs rounded-md border bg-muted/30 px-2 py-1 inline-flex items-center gap-1.5 truncate">
                            <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{d.title}</span>
                            {d.documentType && (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                · {DOC_TYPE_LABEL[d.documentType] ?? d.documentType}
                              </span>
                            )}
                          </span>
                        ) : (
                          <Link
                            href={`/documents/${d.id}`}
                            className="text-xs rounded-md border bg-muted/30 hover:bg-muted/60 px-2 py-1 inline-flex items-center gap-1.5 truncate transition-colors w-full"
                          >
                            <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{d.title}</span>
                            {d.documentType && (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                · {DOC_TYPE_LABEL[d.documentType] ?? d.documentType}
                              </span>
                            )}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Équipes voisines (back-up) */}
              {s.neighborTeams.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-sky-600" />
                    Équipes voisines (back-up potentiel)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.neighborTeams.map((t) => (
                      <TeamBadge
                        key={t.team_id}
                        name={t.team_name}
                        color={t.team_color}
                        size="sm"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* État neutre */}
              {s.aSavoir.length === 0 &&
                s.recentAnomalies.length === 0 &&
                s.openReserves.length === 0 &&
                s.openActions.length === 0 &&
                s.recentDecisions.length === 0 &&
                (s.nextEvents?.length ?? 0) === 0 &&
                s.documents.length === 0 &&
                s.neighborTeams.length === 0 && (
                  <p className="text-xs italic text-muted-foreground">
                    Aucune mémoire spécifique sur ce chantier. La fiche reste à
                    nourrir au fil des prochaines interventions.
                  </p>
                )}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
