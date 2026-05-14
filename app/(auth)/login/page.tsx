import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from './LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; password_changed?: string }>
}) {
  const params = await searchParams
  return (
    <Card>
      <CardHeader>
        <CardTitle>Se connecter à NetoIAge</CardTitle>
      </CardHeader>
      <CardContent>
        {params.password_changed === '1' && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Mot de passe changé. Reconnectez-vous avec le nouveau mot de passe.
          </div>
        )}
        <LoginForm next={params.next} />
      </CardContent>
    </Card>
  )
}
