import { LoginForm } from './LoginForm'
import { ArrowRight } from 'lucide-react'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; password_changed?: string }>
}) {
  const params = await searchParams
  return (
    <div className="space-y-4">
      {/* Logo + titre */}
      <div className="text-center mb-6">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white font-bold text-xl shadow-sm">
          M
        </div>
        <h1 className="text-xl font-semibold text-gray-900">MemorIA</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Gestion terrain · Appels d'offres</p>
      </div>

      {/* Card connexion */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Se connecter</h2>

        {params.password_changed === '1' && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Mot de passe changé. Reconnectez-vous avec le nouveau mot de passe.
          </div>
        )}

        <LoginForm next={params.next} />

        <div className="mt-4 text-center">
          <a
            href="/forgot-password"
            className="text-xs text-muted-foreground hover:text-brand-600 transition-colors"
          >
            Mot de passe oublié ?
          </a>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Les comptes sont créés sur invitation.
        </p>
      </div>

      {/* Bloc démo */}
      <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
        <p className="text-xs font-semibold text-brand-700 mb-2 flex items-center gap-1.5">
          <ArrowRight className="h-3.5 w-3.5" /> Accès démo
        </p>
        <div className="space-y-1 text-xs text-brand-600 font-mono">
          <p>Email : <span className="font-semibold">demo@memoria.nc</span></p>
          <p>Mot de passe : <span className="font-semibold">memoria2026</span></p>
        </div>
      </div>
    </div>
  )
}
