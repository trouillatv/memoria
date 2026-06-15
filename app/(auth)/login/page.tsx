import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { LoginForm } from './LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; password_changed?: string }>
}) {
  const params = await searchParams
  return (
    <div className="space-y-5">
      {/* Marque — logo plein cadre (navy), cohérent avec l'icône de l'app. */}
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-192.png"
          alt="MemorIA"
          className="mx-auto mb-3.5 h-16 w-16 rounded-2xl object-cover shadow-md shadow-slate-900/20 ring-1 ring-slate-900/10"
        />
        <h1 className="text-xl font-semibold tracking-tight text-slate-950">MemorIA</h1>
        <p className="mt-1 text-sm text-slate-500">
          La mémoire opérationnelle de vos chantiers.
        </p>
      </div>

      {/* Carte connexion */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-400/10">
        {/* Liseré de marque en haut de carte. */}
        <div className="h-1 w-full bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900" />
        <div className="p-6 sm:p-7">
          <h2 className="text-base font-semibold text-slate-950">Se connecter</h2>
          <p className="mt-1 text-sm text-slate-500">
            Accédez à vos sites, briefs et preuves.
          </p>

          {params.password_changed === '1' && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Mot de passe changé. Reconnectez-vous avec le nouveau mot de passe.
            </div>
          )}

          <div className="mt-5">
            <LoginForm next={params.next} />
          </div>

          <div className="mt-4 text-center">
            <a
              href="/forgot-password"
              className="text-xs font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              Mot de passe oublié ?
            </a>
          </div>
        </div>

        {/* Pied de carte — réassurance + accès créés sur invitation. */}
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-3 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>Les comptes sont créés sur invitation par votre administrateur.</span>
        </div>
      </div>

      <div className="text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  )
}
