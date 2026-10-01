// /EQUIPES V2 (Batch D) — corps du drawer WOW PERSONNE, affiché dans le
// drawer intégré à /equipes (`?person=<id>&personKind=user|contact`).
//
// Doctrine V4 (lib/db/person-memory.ts) — reprise ici sans l'affaiblir :
//   - users        → mémoire = participations CONFIRMÉES (intervention_participants)
//   - company_contacts → mémoire = faits réellement liés (actions assignées,
//     appartenance équipe terrain), jamais une participation inventée
//   - Équipe(s) actuelle(s) affichée(s) séparément et jamais fusionnée avec
//     l'historique : appartenir aujourd'hui ne prouve rien sur hier.
//   - Le sélecteur de période (7j/30j/3mois/Tout) ne filtre QUE la mémoire
//     "user" — lib/db/person-memory.ts n'a pas de filtre temporel pour les
//     contacts (limite assumée, affichée honnêtement, jamais masquée).
//
// Pas de wording évaluatif, pas de classement, pas de comparaison entre
// personnes.
//
// /EQUIPES V2 (Lot visuel 2026-10-01) — 4 onglets (Aperçu/Activité/Mémoire/
// Équipes), même pattern que TeamDrawerBody.tsx : les sections ne changent
// pas de source de données, seulement de regroupement visuel. Les murs de
// zéros (ex. "0 action, 0 équipe" répétés) sont remplacés par un état vide
// explicite par section plutôt que par une grille de compteurs à 0.

import Link from 'next/link'
import { Calendar, Building2, Users, ChevronRight, ClipboardList, Star, Image as ImageIcon } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { PersonPeriod } from './loadPersonDrawerData'
import type { PersonDrawerData } from './loadPersonDrawerData'

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const PERIOD_LABEL: Record<PersonPeriod, string> = {
  '7': '7 derniers jours',
  '30': '30 derniers jours',
  '90': '3 derniers mois',
  all: 'Tout',
}

const ACTION_STATUS_LABEL: Record<string, string> = {
  open: 'Ouverte',
  in_progress: 'En cours',
  done: 'Faite',
  cancelled: 'Annulée',
}

function periodHref(pathname: string, personId: string, personKind: 'user' | 'contact', period: PersonPeriod): string {
  const params = new URLSearchParams({ person: personId, personKind })
  if (period !== '30') params.set('personPeriod', period)
  return `${pathname}?${params.toString()}`
}

export function PersonDrawerBody({ data, pathname }: { data: PersonDrawerData; pathname: string }) {
  const { ref, displayName, subtitle, period, userOverview, contactOverview, interventions, contactActions, photos, currentTeams } = data

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{displayName}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>

        {ref.kind === 'user' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(PERIOD_LABEL) as PersonPeriod[]).map((p) => (
              <Link
                key={p}
                href={periodHref(pathname, ref.id, 'user', p)}
                className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                  p === period
                    ? 'bg-brand-50 border-brand-200 text-brand-800 font-medium'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {PERIOD_LABEL[p]}
              </Link>
            ))}
          </div>
        )}
        {ref.kind === 'contact' && (
          <p className="text-[11px] text-muted-foreground italic">
            Mémoire sans filtre de période — les actions et équipes terrain d&apos;un contact
            ne sont pas encore datées assez finement pour cela.
          </p>
        )}
      </header>

      <Tabs defaultValue="apercu">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="apercu">Aperçu</TabsTrigger>
          <TabsTrigger value="activite">Activité</TabsTrigger>
          <TabsTrigger value="memoire">Mémoire</TabsTrigger>
          <TabsTrigger value="equipes">Équipes</TabsTrigger>
        </TabsList>

        {/* ── Aperçu — compteurs cumulés + repères temporels ──────────────── */}
        <TabsContent value="apercu" className="space-y-4 pt-3">
          {userOverview && (
            <div className="space-y-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MiniKpi icon={Calendar} label="Participations attestées" value={userOverview.attestedInterventionsCount} />
                <MiniKpi icon={Star} label="Comme référent" value={userOverview.referentCount} />
                <MiniKpi icon={Building2} label="Chantiers distincts" value={userOverview.distinctSiteCount} />
                <MiniKpi icon={Users} label="Équipes distinctes" value={userOverview.distinctTeamCount} />
              </div>
              {userOverview.inProgressInterventionsCount > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  + {userOverview.inProgressInterventionsCount} intervention
                  {userOverview.inProgressInterventionsCount > 1 ? 's' : ''} en cours (non attestée
                  {userOverview.inProgressInterventionsCount > 1 ? 's' : ''})
                </p>
              )}
              {(userOverview.firstConfirmedAt || userOverview.lastConfirmedAt) ? (
                <p className="text-[11px] text-muted-foreground pt-1">
                  Première participation attestée le {fmtDateShort(userOverview.firstConfirmedAt)}
                  {' · '}dernière le {fmtDateShort(userOverview.lastConfirmedAt)}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic pt-1">
                  Aucune participation attestée pour l&apos;instant.
                </p>
              )}
            </div>
          )}
          {contactOverview && (
            <div className="grid grid-cols-3 gap-2">
              <MiniKpi icon={ClipboardList} label="Actions en cours" value={contactOverview.openActionCount} />
              <MiniKpi icon={ClipboardList} label="Actions faites" value={contactOverview.doneActionCount} />
              <MiniKpi icon={Users} label="Équipes terrain" value={contactOverview.teamCount} />
            </div>
          )}
        </TabsContent>

        {/* ── Activité — participations/actions, la mémoire "vivante" ────── */}
        <TabsContent value="activite" className="space-y-4 pt-3">
          {ref.kind === 'user' && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-brand-600" />
                Participations attestées — {PERIOD_LABEL[period]}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Uniquement des interventions où la présence de cette personne a été
                réellement enregistrée, et déjà terminées (attestées) ou en cours.
                L&apos;appartenance actuelle à une équipe ou une intervention
                planifiée n&apos;apparaissent jamais ici sans preuve.
              </p>
              {!interventions || interventions.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  Aucune participation attestée sur cette période.
                </p>
              ) : (
                <ul className="divide-y -my-2">
                  {interventions.map((it) => (
                    <li key={it.interventionId} className="py-2">
                      <Link href={`/sites/${it.siteId}`} className="flex items-center justify-between gap-2 hover:text-brand-700 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">
                            <span className="font-medium">{it.siteName}</span>
                            {it.contractName && <span className="text-muted-foreground"> · {it.contractName}</span>}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {fmtDateShort(it.effectiveDate)}
                            {it.teamName && ` · ${it.teamName}`}
                            {it.role === 'referent' && ' · Référent'}
                            {it.confirmationBasis === 'in_progress' && ' · En cours'}
                          </p>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {ref.kind === 'contact' && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-brand-600" />
                Actions assignées
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Ce contact n&apos;a pas de compte MemorIA : sa mémoire se limite aux
                faits structurellement rattachés (actions, équipe terrain), jamais
                à une participation d&apos;intervention inventée.
              </p>
              {!contactActions || contactActions.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Aucune action assignée.</p>
              ) : (
                <ul className="divide-y -my-2">
                  {contactActions.map((a) => (
                    <li key={a.id} className="py-2">
                      <Link href={`/sites/${a.siteId}`} className="flex items-center justify-between gap-2 hover:text-brand-700 transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{a.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {a.siteName}
                            {a.dueDate && ` · Échéance ${fmtDateShort(a.dueDate)}`}
                          </p>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-muted text-muted-foreground border-border shrink-0">
                          {ACTION_STATUS_LABEL[a.status] ?? a.status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </TabsContent>

        {/* ── Mémoire — empreinte accumulée (photos terrain) ─────────────── */}
        <TabsContent value="memoire" className="space-y-4 pt-3">
          {ref.kind === 'user' && photos && photos.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-brand-600" />
                Photos terrain — {PERIOD_LABEL[period]}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Uniquement les photos réellement prises par cette personne
                (auteur enregistré). Aucune photo n&apos;est jamais attribuée via
                une appartenance équipe.
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {photos.map((p) => (
                  <Link
                    key={p.id}
                    href={`/sites/${p.siteId}`}
                    className="aspect-square rounded-md overflow-hidden border bg-muted relative group"
                    title={p.caption ?? p.siteName}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.signedUrl}
                      alt={p.caption ?? p.siteName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                      {p.siteName}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : ref.kind === 'user' ? (
            <p className="text-sm text-muted-foreground italic">
              Aucune photo terrain prise par cette personne sur cette période.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Un contact terrain n&apos;a pas de compte MemorIA : aucune photo ne
              peut lui être attribuée comme auteur.
            </p>
          )}
        </TabsContent>

        {/* ── Équipes — appartenance actuelle, jamais un historique ───────── */}
        <TabsContent value="equipes" className="space-y-3 pt-3">
          <p className="text-[11px] text-muted-foreground">
            Appartenance actuelle uniquement — n&apos;indique rien sur le passé.
          </p>
          {currentTeams.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Ne fait actuellement partie d&apos;aucune équipe.
            </p>
          ) : (
            <ul className="divide-y -my-2">
              {currentTeams.map((t) => (
                <li key={t.teamId} className="py-2">
                  <Link href={`/equipes?team=${t.teamId}`} className="flex items-center justify-between gap-2 hover:text-brand-700 transition-colors">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-brand-600" />
                      {t.teamName}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <p className="text-[11px] text-muted-foreground italic text-center py-2">
        On ne transforme jamais une absence de preuve en présence supposée.
        L&apos;équipe actuelle n&apos;est pas un historique ; l&apos;historique n&apos;est
        que ce qui a été confirmé.
      </p>
    </div>
  )
}

function MiniKpi({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {value > 0 ? value : <span className="text-muted-foreground/60">—</span>}
        </span>
        <span className="ml-1 text-[11px] text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
