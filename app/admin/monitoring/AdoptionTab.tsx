'use client'

import { useState } from 'react'
import type { AdoptionStats, ActivityEntry, PilotHealth, UserAdoptionRow } from '@/lib/db/admin-monitoring'

const STATUS_LABEL: Record<UserAdoptionRow['status'], string> = {
  active: 'Actif',
  dormant: 'Dormant',
  inactive: 'Inactif',
}

const STATUS_CLASS: Record<UserAdoptionRow['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  dormant: 'bg-amber-100 text-amber-700',
  inactive: 'bg-slate-100 text-slate-500',
}

const PILOT_HEALTH_CLASS: Record<PilotHealth['tone'], string> = {
  red: 'border-red-200 bg-red-50 text-red-800 dark:bg-red-950/20 dark:text-red-200',
  amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200',
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  chef_equipe: 'Chef équipe',
}

const ACTION_LABEL: Record<string, string> = {
  created: 'Création',
  updated: 'Modification',
  role_changed: 'Changement rôle',
  soft_deleted: 'Suppression',
  password_reset_forced: 'Reset MdP',
  validated: 'Validation',
  closed: 'Clôture',
  status_changed: 'Changement statut',
  analysis_relaunched: 'Analyse relancée',
  evidence_inserted: 'Preuve insérée',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'à l\'instant'
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h}h`
  const days = Math.round(h / 24)
  if (days < 7) return `il y a ${days}j`
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

// « Qui a fait quoi · qui a vu quoi » : transforme un log brut en phrase lisible.
// Une visite de page (entity_type='page', action='view') = une CONSULTATION.
function describeEntry(e: ActivityEntry): { verb: string; target: string; consult: boolean } {
  if (e.entity_type === 'page' && e.action === 'view') {
    const route = typeof e.metadata?.route === 'string' ? e.metadata.route : '—'
    return { verb: 'a consulté', target: route, consult: true }
  }
  return { verb: ACTION_LABEL[e.action] ?? e.action, target: e.entity_type, consult: false }
}

export function AdoptionTab({ stats, feed }: { stats: AdoptionStats; feed: ActivityEntry[] }) {
  const [roleFilter, setRoleFilter] = useState<string>('')
  // Filtres dédiés au tableau utilisateurs (indépendants du filtre feed).
  const [userRoleFilter, setUserRoleFilter] = useState<string>('')
  const [userStatusFilter, setUserStatusFilter] = useState<string>('')
  const [userQuery, setUserQuery] = useState<string>('')

  const filteredFeed = roleFilter
    ? feed.filter(e => e.user_role === roleFilter)
    : feed

  const normalizedQuery = userQuery.trim().toLowerCase()
  const filteredUsers = stats.users.filter((u) => {
    if (userRoleFilter && u.role !== userRoleFilter) return false
    if (userStatusFilter && u.status !== userStatusFilter) return false
    if (normalizedQuery) {
      const haystack = `${u.full_name ?? ''} ${u.email}`.toLowerCase()
      if (!haystack.includes(normalizedQuery)) return false
    }
    return true
  })

  return (
    <div className="space-y-8">
      <section className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-2.5">
            Dernière activité de Guillaume
          </h2>
          <div className="text-3xl font-semibold tracking-tight">
            {formatDate(stats.guillaumeLastActivityAt)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Signal principal du pilote : est-ce que MemorIA est rouvert sans relance.
          </p>
        </div>
        <div className={`rounded-lg border p-4 ${PILOT_HEALTH_CLASS[stats.pilotHealth.tone]}`}>
          <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] opacity-75 mb-2.5">
            Santé du pilote
          </h2>
          <div className="text-2xl font-semibold">{stats.pilotHealth.label}</div>
          <p className="mt-1 text-xs opacity-80">
            {stats.pilotHealth.activeDays} jour{stats.pilotHealth.activeDays > 1 ? 's' : ''} actif{stats.pilotHealth.activeDays > 1 ? 's' : ''} sur 30 jours.
          </p>
        </div>
      </section>

      {/* Feed activité — LE cœur : qui a fait quoi · qui a vu quoi */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Qui a fait quoi · qui a vu quoi</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Actions et consultations récentes, par personne.</p>
          </div>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-background"
          >
            {/* Admin volontairement absent : feed adoption filtré côté serveur. */}
            <option value="">Tous les rôles</option>
            <option value="manager">Manager</option>
            <option value="chef_equipe">Chef équipe</option>
          </select>
        </div>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Quand</th>
                <th className="text-left px-3 py-2">Personne</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Sur</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredFeed.map(e => {
                const d = describeEntry(e)
                return (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(e.created_at)}</td>
                    <td className="px-3 py-2 text-xs font-medium">{e.user_name ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={d.consult ? 'text-sky-700' : ''}>{d.verb}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-mono bg-muted/30">{d.target}</span>
                    </td>
                  </tr>
                )
              })}
              {filteredFeed.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">Aucune activité sur la période</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tableau utilisateurs */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Utilisateurs ({filteredUsers.length}
            {filteredUsers.length !== stats.users.length && ` / ${stats.users.length}`})
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="search"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Rechercher nom, email..."
              className="rounded border px-2 py-1 text-xs bg-background w-44"
              aria-label="Rechercher un utilisateur"
            />
            <select
              value={userRoleFilter}
              onChange={(e) => setUserRoleFilter(e.target.value)}
              className="rounded border px-2 py-1 text-xs bg-background"
              aria-label="Filtrer par rôle"
            >
              {/* Admin volontairement absent : exclu du dataset adoption côté serveur. */}
              <option value="">Tous les rôles</option>
              <option value="manager">Manager</option>
              <option value="chef_equipe">Chef équipe</option>
            </select>
            <select
              value={userStatusFilter}
              onChange={(e) => setUserStatusFilter(e.target.value)}
              className="rounded border px-2 py-1 text-xs bg-background"
              aria-label="Filtrer par statut"
            >
              <option value="">Tous les statuts</option>
              <option value="active">Actif</option>
              <option value="dormant">Dormant</option>
              <option value="inactive">Inactif</option>
            </select>
            {(userQuery || userRoleFilter || userStatusFilter) && (
              <button
                type="button"
                onClick={() => {
                  setUserQuery('')
                  setUserRoleFilter('')
                  setUserStatusFilter('')
                }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Réinitialiser
              </button>
            )}
          </div>
        </div>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Nom</th>
                <th className="text-left px-3 py-2">Rôle</th>
                <th className="text-left px-3 py-2">Dernière activité</th>
                <th className="text-right px-3 py-2">Jours actifs 30j</th>
                <th className="text-right px-3 py-2">Notes</th>
                <th className="text-right px-3 py-2">Briefs créés</th>
                <th className="text-right px-3 py-2">Briefs lus</th>
                <th className="text-right px-3 py-2">Docs consultés</th>
                <th className="text-left px-3 py-2">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.map(u => (
                <tr key={u.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.full_name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(u.last_activity_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{u.active_days_30d}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{u.notes_created}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{u.briefs_created}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{u.briefs_read}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{u.documents_consulted}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[u.status]}`}>
                      {STATUS_LABEL[u.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {stats.users.length === 0
                      ? 'Aucun utilisateur'
                      : 'Aucun utilisateur ne correspond aux filtres.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Détails avancés — instrumentation produit, repliée par défaut. */}
      <details className="group rounded-lg border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-muted-foreground marker:content-none">
          <span className="inline-flex items-center gap-2">
            <span className="transition-transform group-open:rotate-90">▸</span>
            Détails avancés — production mémoire
          </span>
        </summary>
        <div className="space-y-6 border-t p-4">
          <section>
            <h3 className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wider">
              Moments mémoriels créés ce mois
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Total', value: stats.memoryMoments.total },
                { label: 'Notes', value: stats.memoryMoments.notes },
                { label: 'Passations', value: stats.memoryMoments.briefs },
                { label: 'Documents', value: stats.memoryMoments.documents },
                { label: 'Anomalies', value: stats.memoryMoments.anomalies },
              ].map(item => (
                <div key={item.label} className="rounded-lg border bg-background p-4 text-center">
                  <div className="text-2xl font-bold tabular-nums">{item.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{item.label}</div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3 className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Actions sur la période</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {[
                { label: 'Interventions créées', value: stats.breakdown.interventions_created },
                { label: 'Photos uploadées', value: stats.breakdown.photos_uploaded },
                { label: 'Anomalies signalées', value: stats.breakdown.anomalies_reported },
                { label: 'Validations', value: stats.breakdown.validations_done },
                { label: 'Resets MdP', value: stats.breakdown.password_resets },
              ].map(item => (
                <div key={item.label} className="rounded-lg border bg-background p-4 text-center">
                  <div className="text-2xl font-bold tabular-nums">{item.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{item.label}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </details>
    </div>
  )
}
