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

import Link from 'next/link'
import { Calendar, Building2, Users, ChevronRight, ClipboardList, Star } from 'lucide-react'
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
  const { ref, displayName, subtitle, period, userOverview, contactOverview, interventions, contactActions, currentTeams } = data

  return (
    <div className="space-y-4">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">{displayName}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>

        {currentTeams.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-brand-600" aria-hidden />
            <span>
              Équipe{currentTeams.length > 1 ? 's' : ''} actuelle{currentTeams.length > 1 ? 's' : ''} :{' '}
              {currentTeams.map((t, i) => (
                <span key={t.teamId}>
                  {i > 0 && ', '}
                  <Link href={`/equipes?team=${t.teamId}`} className="text-brand-700 hover:underline">
                    {t.teamName}
                  </Link>
                </span>
              ))}
            </span>
          </div>
        )}

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

        {userOverview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t">
            <Counter icon={Calendar} label="Participations confirmées" value={userOverview.confirmedInterventionsCount} />
            <Counter icon={Star} label="Comme référent" value={userOverview.referentCount} />
            <Counter icon={Building2} label="Chantiers distincts" value={userOverview.distinctSiteCount} />
            <Counter icon={Users} label="Équipes distinctes" value={userOverview.distinctTeamCount} />
          </div>
        )}
        {contactOverview && (
          <div className="grid grid-cols-3 gap-3 pt-2 border-t">
            <Counter icon={ClipboardList} label="Actions en cours" value={contactOverview.openActionCount} />
            <Counter icon={ClipboardList} label="Actions faites" value={contactOverview.doneActionCount} />
            <Counter icon={Users} label="Équipes terrain" value={contactOverview.teamCount} />
          </div>
        )}
      </header>

      {/* ── Mémoire "user" — participations confirmées ─────────────────── */}
      {ref.kind === 'user' && (
        <section className="rounded-lg border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4 text-brand-600" />
            Participations confirmées — {PERIOD_LABEL[period]}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Uniquement des interventions où la présence de cette personne a été
            réellement enregistrée. L&apos;appartenance actuelle à une équipe ou
            une intervention planifiée n&apos;apparaissent jamais ici sans preuve.
          </p>
          {!interventions || interventions.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              Aucune participation confirmée sur cette période.
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

      {/* ── Mémoire "contact" — faits réellement liés ──────────────────── */}
      {ref.kind === 'contact' && (
        <section className="rounded-lg border bg-card p-4 space-y-3">
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

      <p className="text-[11px] text-muted-foreground italic text-center py-2">
        On ne transforme jamais une absence de preuve en présence supposée.
        L&apos;équipe actuelle n&apos;est pas un historique ; l&apos;historique n&apos;est
        que ce qui a été confirmé.
      </p>
    </div>
  )
}

function Counter({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}
