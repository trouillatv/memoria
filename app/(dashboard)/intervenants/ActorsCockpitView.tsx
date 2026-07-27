'use client'

// Lot 2B.2 — Vue du cockpit des acteurs (person | company | team).
// LECTURE SEULE. Onglets + recherche + filtres essentiels, en client, sur un
// read model déjà agrégé côté serveur (getActorsCockpit). Aucune donnée
// nouvelle ici : on trie, on filtre, on oriente vers les surfaces propriétaires.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Users, User, Building2, ArrowRight, AlertTriangle, Clock,
} from 'lucide-react'
import type { ActorKind, ActorStatus, ActorAlert, CockpitActor, ActorsCockpit } from '@/lib/db/actors-cockpit'

type Tab = 'all' | 'person' | 'company' | 'team'

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'person', label: 'Personnes' },
  { key: 'company', label: 'Entreprises' },
  { key: 'team', label: 'Équipes' },
]

const KIND_LABEL: Record<ActorKind, string> = {
  person: 'Personne',
  company: 'Entreprise',
  team: 'Équipe',
}

const ALERT_LABEL: Record<ActorAlert, string> = {
  agent_no_team: 'Agent sans équipe',
  company_overdue: 'Actions en retard',
  company_no_referent: 'Sans contact référent',
  responsible_not_active: 'Responsable plus mobilisé',
  company_left_casting: 'Hors casting actif',
  team_no_member: 'Équipe sans membre',
}

const STATUS_LABEL: Record<ActorStatus, string> = {
  active: 'Actif',
  incomplete: 'Incomplet',
  historical: 'Historique',
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function KindIcon({ kind }: { kind: ActorKind }) {
  if (kind === 'company') return <Building2 className="h-4 w-4" aria-hidden />
  if (kind === 'team') return <Users className="h-4 w-4" aria-hidden />
  return <User className="h-4 w-4" aria-hidden />
}

/** Ordre déterministe : d'abord les alertes, puis actif → incomplet → historique,
 *  puis alphabétique. Aucun ranking « pertinence » caché. */
const STATUS_ORDER: Record<ActorStatus, number> = { active: 0, incomplete: 1, historical: 2 }
function compareActors(a: CockpitActor, b: CockpitActor): number {
  const aAlert = a.alerts.length > 0 ? 0 : 1
  const bAlert = b.alerts.length > 0 ? 0 : 1
  if (aAlert !== bAlert) return aAlert - bAlert
  if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  return a.name.localeCompare(b.name, 'fr')
}

export function ActorsCockpitView({ directory }: { directory: ActorsCockpit }) {
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [alertsOnly, setAlertsOnly] = useState(false)

  const { counters } = directory
  const filtered = useMemo(() => {
    const q = norm(query.trim())
    return directory.actors
      .filter((a) => (tab === 'all' ? true : a.kind === tab))
      .filter((a) => (alertsOnly ? a.alerts.length > 0 : true))
      .filter((a) => (q ? norm(a.name).includes(q) || norm(a.subtitle).includes(q) : true))
      .sort(compareActors)
  }, [directory.actors, tab, query, alertsOnly])

  const focusTab = (t: Tab, onlyAlerts = false) => {
    setTab(t)
    setAlertsOnly(onlyAlerts)
  }

  const hasAttention =
    counters.actionsWithoutOwner > 0 || counters.companiesOverdue > 0 || counters.agentsWithoutTeam > 0 ||
    counters.companiesActionsNoReferent > 0 || counters.detectedUnconfirmed > 0

  return (
    <div className="space-y-5 w-full">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold inline-flex items-center gap-2">
          <Users className="h-6 w-6 text-brand-600" />
          Intervenants
        </h1>
        <p className="text-sm text-muted-foreground">
          Qui agit sur les chantiers, avec qui, où, et qu&apos;attend-on de lui — personnes, entreprises et équipes.
        </p>
      </header>

      {/* ATTENTION d'abord — ce qui appelle une décision, pas du volume. Chaque
          entrée mène à la liste filtrée correspondante ; les stats sans acteur
          cible (actions orphelines, détectés) restent informatives. */}
      {hasAttention ? (
        <div className="flex flex-wrap items-stretch gap-2">
          {counters.actionsWithoutOwner > 0 && (
            <AttentionCard tone="red" value={counters.actionsWithoutOwner} label={`action${counters.actionsWithoutOwner > 1 ? 's' : ''} sans responsable`} />
          )}
          {counters.companiesOverdue > 0 && (
            <AttentionCard tone="red" value={counters.companiesOverdue} label={`entreprise${counters.companiesOverdue > 1 ? 's' : ''} en retard`} onClick={() => focusTab('company', true)} />
          )}
          {counters.agentsWithoutTeam > 0 && (
            <AttentionCard tone="amber" value={counters.agentsWithoutTeam} label={`agent${counters.agentsWithoutTeam > 1 ? 's' : ''} sans équipe`} onClick={() => focusTab('person', true)} />
          )}
          {counters.companiesActionsNoReferent > 0 && (
            <AttentionCard tone="amber" value={counters.companiesActionsNoReferent} label={`entreprise${counters.companiesActionsNoReferent > 1 ? 's' : ''} sans référent`} onClick={() => focusTab('company', true)} />
          )}
          {counters.detectedUnconfirmed > 0 && (
            <AttentionCard tone="amber" value={counters.detectedUnconfirmed} label={`intervenant${counters.detectedUnconfirmed > 1 ? 's' : ''} à confirmer`} />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200/70 bg-emerald-50/40 px-4 py-2.5 text-sm text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300">
          <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500" />
          Rien n&apos;appelle d&apos;attention pour le moment.
        </div>
      )}

      {/* Volume — contexte discret, jamais le centre de la page. */}
      <p className="text-xs text-muted-foreground">
        <VolumeLink value={counters.personsActive} label="personnes actives" onClick={() => focusTab('person')} />
        {' · '}
        <VolumeLink value={counters.companiesActive} label="entreprises actives" onClick={() => focusTab('company')} />
        {' · '}
        <VolumeLink value={counters.teamsActive} label="équipes actives" onClick={() => focusTab('team')} />
      </p>

      {/* Onglets + recherche + filtre essentiel. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} className="accent-amber-600" />
            Alertes seulement
          </label>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
            className="h-9 w-48 rounded-lg border border-border/60 bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Liste. */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground italic">
          {alertsOnly ? 'Aucune alerte sur ce périmètre.' : query ? 'Aucun acteur ne correspond à cette recherche.' : 'Aucun acteur pour le moment.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <ActorRow key={`${a.kind}:${a.id}`} actor={a} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Carte d'attention. `red` = urgence (retards, orphelines), `amber` = à traiter.
 *  Cliquable seulement quand elle mène à une liste d'acteurs filtrable. */
function AttentionCard({ tone, value, label, onClick }: { tone: 'red' | 'amber'; value: number; label: string; onClick?: () => void }) {
  const palette = tone === 'red'
    ? 'border-red-300/70 bg-red-50/60 text-red-900 dark:border-red-800/50 dark:bg-red-950/25 dark:text-red-200'
    : 'border-amber-300/70 bg-amber-50/60 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/25 dark:text-amber-200'
  const dot = tone === 'red' ? 'bg-red-500' : 'bg-amber-500'
  const inner = (
    <>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-lg font-semibold tabular-nums leading-none">{value}</span>
      <span className="text-xs leading-tight opacity-90">{label}</span>
    </>
  )
  const cls = `flex items-center gap-2 rounded-lg border px-3 py-2 ${palette}`
  if (onClick) {
    return <button type="button" onClick={onClick} className={`${cls} transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>{inner}</button>
  }
  return <div className={cls} title="Aucun acteur à ouvrir directement — traiter sur le chantier concerné">{inner}</div>
}

function VolumeLink({ value, label, onClick }: { value: number; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="tabular-nums underline-offset-2 hover:text-foreground hover:underline">
      <span className="font-medium text-foreground/80">{value}</span> {label}
    </button>
  )
}

function ActorRow({ actor }: { actor: CockpitActor }) {
  const inner = (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-600/10 dark:text-brand-300">
        <KindIcon kind={actor.kind} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate">{actor.name}</span>
          <span className="text-[11px] rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{KIND_LABEL[actor.kind]}</span>
          {actor.status !== 'active' && (
            <span className={`text-[11px] rounded-md px-1.5 py-0.5 ${
              actor.status === 'historical'
                ? 'bg-muted text-muted-foreground'
                : 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
            }`}>
              {STATUS_LABEL[actor.status]}
            </span>
          )}
          {actor.linkedAccountHint && (
            <span className="text-[11px] rounded-md border border-dashed border-border/70 px-1.5 py-0.5 text-muted-foreground">
              Compte lié possible
            </span>
          )}
        </div>
        {actor.subtitle && <div className="mt-0.5 text-xs text-muted-foreground truncate">{actor.subtitle}</div>}
        {(actor.openActions > 0 || actor.alerts.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {actor.openActions > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                {actor.openActions} action{actor.openActions > 1 ? 's' : ''} ouverte{actor.openActions > 1 ? 's' : ''}
                {actor.overdueActions > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
                    <Clock className="h-3 w-3" aria-hidden /> {actor.overdueActions} en retard
                  </span>
                )}
              </span>
            )}
            {actor.alerts.map((al) => (
              <span key={al} className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" aria-hidden /> {ALERT_LABEL[al]}
              </span>
            ))}
          </div>
        )}
      </div>
      {actor.href && <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors" aria-hidden />}
    </div>
  )

  const base = 'block rounded-xl border border-border/60 bg-card p-3.5'
  if (actor.href) {
    return (
      <li>
        <Link href={actor.href} className={`group ${base} transition-colors hover:border-brand-200/70 hover:bg-brand-50/30 dark:hover:bg-brand-600/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
          {inner}
        </Link>
      </li>
    )
  }
  return <li className={base}>{inner}</li>
}
