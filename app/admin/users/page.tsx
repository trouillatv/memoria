import { listUsersForAdmin, getCurrentUserWithProfile } from '@/lib/db/users'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreateUserForm } from './CreateUserForm'
import { UserRoleSelect } from './UserRoleSelect'
import { ForcePasswordResetButton } from './ForcePasswordResetButton'
import { DeleteUserButton } from './DeleteUserButton'
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default async function AdminUsersPage() {
  const [me, users] = await Promise.all([
    getCurrentUserWithProfile(),
    listUsersForAdmin(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Utilisateurs</h1>
        <p className="text-sm text-muted-foreground">
          {users.length} utilisateur{users.length > 1 ? 's' : ''}. Gestion centralisée — création, rôles, mot de passe.
        </p>
      </div>

      <CreateUserForm />

      <Card>
        <CardHeader><CardTitle className="text-base">Liste</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Nom</th>
                  <th className="text-left px-3 py-2">Rôle</th>
                  <th className="text-left px-3 py-2">Mdp</th>
                  <th className="text-left px-3 py-2">Créé le</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">Aucun utilisateur.</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                    <td className="px-3 py-2 text-xs">{u.full_name || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge className={ROLE_BADGE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                        <UserRoleSelect userId={u.id} currentRole={u.role} />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {u.must_change_password ? <span className="text-amber-700">À changer</span> : <span className="text-muted-foreground">OK</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(u.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <ForcePasswordResetButton userId={u.id} isAdminUser={u.role === 'admin'} />
                        <DeleteUserButton userId={u.id} isSelf={me?.id === u.id} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50">
        <CardHeader><CardTitle className="text-xs uppercase tracking-wider text-amber-700">Procédure de réinitialisation</CardTitle></CardHeader>
        <CardContent className="text-sm text-amber-900 space-y-2">
          <p>Le bouton <strong>Reset</strong> remet le mot de passe à la valeur de <code className="bg-white px-1 rounded font-mono">INITIAL_ADMIN_PASSWORD</code> (variable d&apos;environnement) et force l&apos;utilisateur à en choisir un nouveau à sa prochaine connexion.</p>
          <p><strong>Comptes admin</strong> : reset désactivé pour des raisons de sécurité ; passer par Supabase Studio.</p>
        </CardContent>
      </Card>
    </div>
  )
}
