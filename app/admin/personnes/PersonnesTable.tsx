'use client'

// Tableau des personnes triable par colonnes (refonte tri 2026-06-16).
// Server component (page.tsx) fait les requêtes ; ce composant client ne gère
// QUE l'ordre d'affichage. Les sous-composants interactifs (rôle, entreprise,
// téléphone, reset, suppression) restent inchangés.

import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { UserRoleSelect } from '../users/UserRoleSelect'
import { ForcePasswordResetButton } from '../users/ForcePasswordResetButton'
import { DeleteUserButton } from '../users/DeleteUserButton'
import { UserPhoneEdit } from '../users/UserPhoneEdit'
import { MoveUserOrgForm } from '../organisations/OrgForms'
import type { UserRole } from '@/types/db'

export type PersonneRow = {
  id: string
  full_name: string | null
  email: string
  role: UserRole
  organization_id: string | null
  orgName: string | null
  orgKnown: boolean
  phone: string | null
  lastActivityIso: string | null
  status: 'active' | 'dormant' | 'inactive'
  mustChange: boolean
  isSelf: boolean
}

const ROLE_BADGE: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  chef_equipe: 'bg-emerald-100 text-emerald-700',
}
const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  chef_equipe: "Chef d'équipe",
}
const ROLE_RANK: Record<UserRole, number> = { admin: 0, manager: 1, chef_equipe: 2 }
const STATUS_DOT: Record<PersonneRow['status'], string> = {
  active: 'bg-emerald-500',
  dormant: 'bg-amber-400',
  inactive: 'bg-slate-300',
}

function relativeConnexion(iso: string | null): string {
  if (!iso) return 'Jamais'
  const d = new Date(iso)
  const m = Math.round((Date.now() - d.getTime()) / 60000)
  if (m < 1) return "À l'instant"
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  const days = Math.round(h / 24)
  if (days < 7) return `il y a ${days} j`
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

type SortKey = 'name' | 'role' | 'org' | 'phone' | 'connexion' | 'mdp'
type SortDir = 'asc' | 'desc'

// Sens « naturel » au premier clic sur chaque colonne.
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  role: 'asc',
  org: 'asc',
  phone: 'asc',
  connexion: 'desc', // plus récent d'abord
  mdp: 'desc', // « À changer » d'abord
}

function compare(a: PersonneRow, b: PersonneRow, key: SortKey): number {
  switch (key) {
    case 'name':
      return (a.full_name || a.email).localeCompare(b.full_name || b.email, 'fr', { sensitivity: 'base' })
    case 'role':
      return ROLE_RANK[a.role] - ROLE_RANK[b.role]
    case 'org':
      return (a.orgName || '￿').localeCompare(b.orgName || '￿', 'fr', { sensitivity: 'base' })
    case 'phone':
      // Sans téléphone en dernier (en ordre asc).
      return (a.phone || '￿').localeCompare(b.phone || '￿', 'fr', { sensitivity: 'base' })
    case 'connexion': {
      const ta = a.lastActivityIso ? new Date(a.lastActivityIso).getTime() : -Infinity
      const tb = b.lastActivityIso ? new Date(b.lastActivityIso).getTime() : -Infinity
      return ta - tb
    }
    case 'mdp':
      return Number(a.mustChange) - Number(b.mustChange)
  }
}

function SortHeader({
  label,
  col,
  sort,
  onSort,
  align = 'left',
}: {
  label: string
  col: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sort.key === col
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground ${active ? 'text-foreground' : ''}`}
        aria-label={`Trier par ${label}`}
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )
}

export function PersonnesTable({
  rows,
  orgs,
}: {
  rows: PersonneRow[]
  orgs: { id: string; name: string }[]
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' })

  function onSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: DEFAULT_DIR[key] },
    )
  }

  const sorted = [...rows].sort((a, b) => {
    const c = compare(a, b, sort.key)
    return sort.dir === 'asc' ? c : -c
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs text-muted-foreground">
          <tr>
            <SortHeader label="Personne" col="name" sort={sort} onSort={onSort} />
            <SortHeader label="Rôle" col="role" sort={sort} onSort={onSort} />
            <SortHeader label="Entreprise" col="org" sort={sort} onSort={onSort} />
            <SortHeader label="Téléphone" col="phone" sort={sort} onSort={onSort} />
            <SortHeader label="Dernière connexion" col="connexion" sort={sort} onSort={onSort} />
            <SortHeader label="Mdp" col="mdp" sort={sort} onSort={onSort} />
            <th className="px-3 py-2 text-right uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.length === 0 ? (
            <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">Aucune personne.</td></tr>
          ) : sorted.map((u) => (
            <tr key={u.id} className="hover:bg-muted/20">
              <td className="px-3 py-2">
                <div className="font-medium">{u.full_name || '—'}</div>
                <div className="font-mono text-xs text-muted-foreground">{u.email}</div>
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge className={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                  <UserRoleSelect userId={u.id} currentRole={u.role} />
                </div>
              </td>
              <td className="px-3 py-2">
                <MoveUserOrgForm userId={u.id} currentOrgId={u.organization_id} orgs={orgs} />
                {u.organization_id && !u.orgKnown && (
                  <span className="text-xs text-muted-foreground">Inconnue</span>
                )}
              </td>
              <td className="px-3 py-2">
                <UserPhoneEdit userId={u.id} currentPhone={u.phone} />
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[u.status]}`} />
                  {relativeConnexion(u.lastActivityIso)}
                </span>
              </td>
              <td className="px-3 py-2 text-xs">
                {u.mustChange
                  ? <span className="text-amber-700">À changer</span>
                  : <span className="text-muted-foreground">OK</span>}
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <ForcePasswordResetButton userId={u.id} isAdminUser={u.role === 'admin'} />
                  <DeleteUserButton userId={u.id} isSelf={u.isSelf} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
