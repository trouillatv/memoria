// /admin/personnes — refonte 2026-06-15.
//
// UN SEUL endroit pour les personnes : création, rôle, entreprise, téléphone,
// dernière connexion, mot de passe. Fusionne les anciens onglets Utilisateurs +
// Entreprises + Préparation (la création de comptes ne se fait plus à deux
// endroits → fin de la confusion « créés aussi dans Compagnies »).

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { listUsersForAdmin, getCurrentUserWithProfile } from '@/lib/db/users'
import { listOrganisations } from '@/lib/db/organisations'
import { getUsersActivitySummary } from '@/lib/db/admin-monitoring'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateUserForm } from '../users/CreateUserForm'
import { CreateOrgForm } from '../organisations/OrgForms'
import { PersonnesTable, type PersonneRow } from './PersonnesTable'

export const dynamic = 'force-dynamic'

export default async function AdminPersonnesPage() {
  const [me, users, orgs, activity] = await Promise.all([
    getCurrentUserWithProfile(),
    listUsersForAdmin(),
    listOrganisations(),
    getUsersActivitySummary(),
  ])

  const orgList = orgs.map((o) => ({ id: o.id, name: o.name }))
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]))
  const memberCount = new Map<string, number>()
  for (const u of users) {
    const oid = (u as { organization_id?: string | null }).organization_id
    if (oid) memberCount.set(oid, (memberCount.get(oid) ?? 0) + 1)
  }
  const unassigned = users.filter((u) => !(u as { organization_id?: string | null }).organization_id)

  // Chefs d'équipe sans téléphone (ex-onglet Préparation : prérequis WhatsApp).
  const chefsNoPhone = users.filter((u) => u.role === 'chef_equipe' && !u.phone)

  const rows: PersonneRow[] = users.map((u) => {
    const oid = (u as { organization_id?: string | null }).organization_id ?? null
    const act = activity[u.id]
    return {
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      organization_id: oid,
      orgName: oid ? orgNameById.get(oid) ?? null : null,
      orgKnown: oid ? orgNameById.has(oid) : true,
      phone: u.phone,
      lastActivityIso: act?.last_activity_at ?? null,
      status: act?.status ?? 'inactive',
      mustChange: !!u.must_change_password,
      isSelf: me?.id === u.id,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Personnes</h1>
        <p className="text-sm text-muted-foreground">
          {users.length} personne{users.length > 1 ? 's' : ''}. Création, rôle, entreprise,
          téléphone et dernière connexion — au même endroit.
        </p>
      </div>

      {chefsNoPhone.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <p className="text-amber-900">
            {chefsNoPhone.length} chef{chefsNoPhone.length > 1 ? 's' : ''} d&apos;équipe sans
            téléphone — le brief WhatsApp ne peut pas leur être envoyé. Renseignez le numéro
            dans la colonne <strong>Téléphone</strong> ci-dessous.
          </p>
        </div>
      )}

      <CreateUserForm />

      <Card>
        <CardHeader><CardTitle className="text-base">Liste des personnes</CardTitle></CardHeader>
        <CardContent className="p-0">
          <PersonnesTable rows={rows} orgs={orgList} />
        </CardContent>
      </Card>

      {/* ── Entreprises ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Entreprises</h2>
        <CreateOrgForm />
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Entreprise</th>
                  <th className="px-3 py-2 text-left">Slug</th>
                  <th className="px-3 py-2 text-right">Personnes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orgs.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-xs text-muted-foreground">Aucune entreprise.</td></tr>
                ) : orgs.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{o.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{o.slug}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{memberCount.get(o.id) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        {unassigned.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p className="text-amber-900">
              {unassigned.length} personne{unassigned.length > 1 ? 's' : ''} sans entreprise —
              affectez-les via la colonne <strong>Entreprise</strong> du tableau ci-dessus.
            </p>
          </div>
        )}
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardHeader><CardTitle className="text-xs uppercase tracking-wider text-amber-700">Procédure de réinitialisation</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-amber-900">
          <p>Le bouton <strong>Reset</strong> remet le mot de passe à <code className="rounded bg-white px-1 font-mono">memoria2026</code>. La personne est forcée d&apos;en choisir un nouveau à sa prochaine connexion.</p>
          <p><strong>Comptes admin</strong> : reset désactivé pour des raisons de sécurité ; passer par Supabase Studio. Le brief du soir se consulte sur <Link href="/preparation" className="underline">/preparation</Link>.</p>
        </CardContent>
      </Card>
    </div>
  )
}
