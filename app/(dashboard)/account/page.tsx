import { redirect } from 'next/navigation'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card'
import type { UserRole } from '@/types/db'
import { getProfileConsultationSummary } from '@/lib/db/activity-logs'
import { AccountProfileForm } from './AccountProfileForm'
import { AccountPasswordForm } from './AccountPasswordForm'
import { AccountLogoutSection } from './AccountLogoutSection'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrateur',
  manager: 'Manager',
  chef_equipe: 'Agent terrain',
}

const VIEWER_ROLE_PLURAL: Record<string, string> = {
  admin: 'administrateur',
  manager: 'manager',
}

export default async function AccountPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')

  // Transparence (board 2026-05-26) : la personne peut savoir que sa fiche a
  // été consultée — agrégé PAR RÔLE, jamais nominatif (jamais QUI).
  const consultations = await getProfileConsultationSummary(user.id)
  const lastConsultedLabel = consultations.lastAt
    ? new Date(consultations.lastAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <div className="w-full space-y-6">
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
          <CardTitle className="text-base">Consultations de votre fiche</CardTitle>
          <CardDescription>
            Qui peut consulter votre fiche ? Uniquement un manager ou un administrateur, et
            chaque consultation est tracée. Vue agrégée par rôle — jamais nominative.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consultations.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              Votre fiche n&apos;a été consultée par personne pour le moment.
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                Votre fiche a été consultée{' '}
                <span className="font-semibold tabular-nums">{consultations.total}</span>{' '}
                fois{lastConsultedLabel ? ` · dernière le ${lastConsultedLabel}` : ''}.
              </p>
              <ul className="space-y-1 text-muted-foreground">
                {Object.entries(consultations.byRole).map(([role, count]) => {
                  const label = VIEWER_ROLE_PLURAL[role] ?? role
                  return (
                    <li key={role} className="flex items-center gap-2">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                      <span className="tabular-nums font-medium text-foreground">{count}</span>
                      {' '}par {count > 1 ? `des ${label}s` : `un ${label}`}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
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
