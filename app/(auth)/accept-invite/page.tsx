import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AcceptInviteForm } from './AcceptInviteForm'

export default function AcceptInvitePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bienvenue sur NetoIAge</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Définissez votre mot de passe pour accéder à votre compte.
        </p>
        <AcceptInviteForm />
      </CardContent>
    </Card>
  )
}
