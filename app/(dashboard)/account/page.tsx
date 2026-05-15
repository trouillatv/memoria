import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card'
import type { UserRole } from '@/types/db'
import { AccountProfileForm } from './AccountProfileForm'
import { AccountPasswordForm } from './AccountPasswordForm'
import { AccountLogoutSection } from './AccountLogoutSection'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrateur',
  manager: 'Manager',
  chef_equipe: 'Agent terrain',
}

export default async function AccountPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mon compte</h1>
        <p className="text-sm text-muted-foreground">
          Gérez vos informations personnelles et votre sécurité.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profil</CardTitle>
          <CardDescription>Vos informations affichées dans MemorIA.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountProfileForm
            initialFullName={user.full_name ?? ''}
            initialPhone={user.phone}
            email={user.email}
            roleLabel={ROLE_LABELS[user.role] ?? user.role}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mot de passe</CardTitle>
          <CardDescription>
            Modifiez votre mot de passe. Choisissez un mot de passe d&apos;au moins 8 caractères.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AccountPasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Déconnexion</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountLogoutSection />
        </CardContent>
      </Card>
    </div>
  )
}
