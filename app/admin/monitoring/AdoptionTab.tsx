'use client'

import { useState } from 'react'
import type { AdoptionStats, ActivityEntry, UserAdoptionRow } from '@/lib/db/admin-monitoring'

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

export function AdoptionTab({ stats, feed }: { stats: AdoptionStats; feed: ActivityEntry[] }) {
  const [roleFilter, setRoleFilter] = useState<string>('')

  const filteredFeed = roleFilter
    ? feed.filter(e => e.user_role === roleFilter)
    : feed

  return (
    <div className="space-y-8">
      {/* Répartition des actions */}
      <section>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Actions sur la période</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {[
            { label: 'Interventions créées', value: stats.breakdown.interventions_created },
            { label: 'Photos uploadées', value: stats.breakdown.photos_uploaded },
            { label: 'Anomalies signalées', value: stats.breakdown.anomalies_reported },
            { label: 'Validations', value: stats.breakdown.validations_done },
            { label: 'Resets MdP', value: stats.breakdown.password_resets },
          ].map(item => (
            <div key={item.label} className="rounded-lg border bg-card p-4 text-center">
              <div className="text-2xl font-bold tabular-nums">{item.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Tableau utilisateurs */}
      <section>
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Utilisateurs ({stats.users.length})</h2>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Nom</th>
                <th className="text-left px-3 py-2">Rôle</th>
                <th className="text-left px-3 py-2">Dernière connexion</th>
                <th className="text-right px-3 py-2">Actions</th>
                <th className="text-left px-3 py-2">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stats.users.map(u => (
                <tr key={u.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.full_name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(u.last_sign_in_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs">{u.actions_in_period}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLASS[u.status]}`}>
                      {STATUS_LABEL[u.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {stats.users.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">Aucun utilisateur</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Feed activité */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Activité récente</h2>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-background"
          >
            <option value="">Tous les rôles</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="chef_equipe">Chef équipe</option>
          </select>
        </div>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Quand</th>
                <th className="text-left px-3 py-2">Utilisateur</th>
                <th className="text-left px-3 py-2">Entité</th>
                <th className="text-left px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredFeed.map(e => (
                <tr key={e.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDate(e.created_at)}</td>
                  <td className="px-3 py-2 text-xs">{e.user_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-mono bg-muted/30">{e.entity_type}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{ACTION_LABEL[e.action] ?? e.action}</td>
                </tr>
              ))}
              {filteredFeed.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">Aucune activité sur la période</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
