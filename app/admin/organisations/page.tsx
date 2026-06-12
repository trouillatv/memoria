import { listOrganisations } from '@/lib/db/organisations'
import { listUsersForAdmin } from '@/lib/db/users'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreateOrgForm, CreateUserInOrgForm, MoveUserOrgForm } from './OrgForms'
import type { UserRole } from '@/types/db'

const ROLE_BADGE: Record<UserRole, string> = {
  admin:       'bg-purple-100 text-purple-700',
  manager:     'bg-blue-100 text-blue-700',
  chef_equipe: 'bg-emerald-100 text-emerald-700',
}
const ROLE_LABEL: Record<UserRole, string> = {
  admin:       'Admin',
  manager:     'Manager',
  chef_equipe: "Chef d'équipe",
}

export default async function AdminOrganisationsPage() {
  const [orgs, users] = await Promise.all([
    listOrganisations(),
    listUsersForAdmin(),
  ])

  const usersByOrg: Record<string, typeof users> = {}
  const unassigned: typeof users = []
  for (const u of users) {
    const oid = (u as { organization_id?: string }).organization_id
    if (!oid) { unassigned.push(u); continue }
    usersByOrg[oid] ??= []
    usersByOrg[oid].push(u)
  }

  const orgList = orgs.map((o) => ({ id: o.id, name: o.name }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Entreprises</h1>
        <p className="text-sm text-muted-foreground">
          {orgs.length} entreprise{orgs.length > 1 ? 's' : ''} — chaque espace est isolé, vierge à la création.
        </p>
      </div>

      <CreateOrgForm />

      <div className="space-y-4">
        {orgs.map((org) => {
          const members = usersByOrg[org.id] ?? []
          return (
            <Card key={org.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{org.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      slug: <code className="font-mono">{org.slug}</code> · {members.length} utilisateur{members.length > 1 ? 's' : ''}
                    </p>
                  </div>
                  <CreateUserInOrgForm orgId={org.id} orgName={org.name} />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {members.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-2">Aucun utilisateur — espace vierge.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left py-1.5">Email</th>
                        <th className="text-left py-1.5">Nom</th>
                        <th className="text-left py-1.5">Rôle</th>
                        <th className="text-left py-1.5">Entreprise</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {members.map((u) => (
                        <tr key={u.id} className="hover:bg-muted/20">
                          <td className="py-1.5 font-mono text-xs">{u.email}</td>
                          <td className="py-1.5 text-xs">{u.full_name || '—'}</td>
                          <td className="py-1.5">
                            <Badge className={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                          </td>
                          <td className="py-1.5">
                            <MoveUserOrgForm
                              userId={u.id}
                              currentOrgId={(u as { organization_id?: string }).organization_id ?? null}
                              orgs={orgList}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )
        })}

        {unassigned.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-800">Sans entreprise ({unassigned.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {unassigned.map((u) => (
                    <tr key={u.id} className="hover:bg-amber-50">
                      <td className="py-1.5 font-mono text-xs">{u.email}</td>
                      <td className="py-1.5 text-xs">{u.full_name || '—'}</td>
                      <td className="py-1.5">
                        <Badge className={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      </td>
                      <td className="py-1.5">
                        <MoveUserOrgForm
                          userId={u.id}
                          currentOrgId={null}
                          orgs={orgList}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
