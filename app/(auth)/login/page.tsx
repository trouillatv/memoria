import { LoginForm } from './LoginForm'

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="MemorIA"
          className="mx-auto mb-3 h-14 w-14 rounded-2xl object-cover ring-1 ring-black/5 shadow-sm"
        />
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
    </div>
  )
}
