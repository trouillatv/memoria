import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getCurrentUserWithProfile } from '@/lib/db/users'
import { AccountPasswordForm } from '../AccountPasswordForm'

export default async function AccountPasswordPage() {
  const user = await getCurrentUserWithProfile()
  if (!user) redirect('/login')

  return (
    <div className="w-full space-y-6">
      <Link
        href="/account"
        className={cn(buttonVariants({ variant: 'ghost' }), 'gap-1.5 text-muted-foreground')}
      >
        <ArrowLeft className="h-4 w-4" />
        Mon compte
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Changer mon mot de passe</h1>
        <p className="text-sm text-muted-foreground">
          Choisissez un mot de passe d&apos;au moins 8 caractères.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mot de passe</CardTitle>
          <CardDescription>
            Saisissez votre mot de passe actuel puis le nouveau mot de passe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AccountPasswordForm />
        </CardContent>
      </Card>
    </div>
  )
}
