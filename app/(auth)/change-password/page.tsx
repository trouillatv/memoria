import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChangePasswordForm } from './ChangePasswordForm'

export default function ChangePasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Changer le mot de passe</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Votre mot de passe actuel est temporaire. Choisissez-en un nouveau.
        </p>
        <ChangePasswordForm />
      </CardContent>
    </Card>
  )
}
