'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // URL ABSOLUE obligatoire (Supabase rejette un redirect relatif) et qui
    // passe par /auth/callback pour échanger le code contre une session avant
    // d'atterrir sur /change-password. window.location.origin = l'origine
    // réelle (localhost/127.0.0.1/prod) — pas de dépendance à une env var.
    const redirectTo = `${window.location.origin}/auth/callback?next=/change-password`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setLoading(false)
    if (resetError) {
      setError("Impossible d'envoyer le lien. Réessayez dans un instant.")
      return
    }
    setSent(true)
  }

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm ${sent ? 'bg-emerald-500' : 'bg-brand-600'} text-white`}>
          {sent ? <CheckCircle2 className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Mot de passe oublié</h1>
        <p className="text-sm text-muted-foreground mt-0.5">MemorIA</p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        {sent ? (
          <div className="text-center space-y-3">
            <p className="text-sm text-gray-600">
              Si un compte correspond à cette adresse, vous recevrez un lien de réinitialisation dans quelques minutes.
            </p>
            <p className="text-xs text-muted-foreground">Vérifiez vos spams si vous ne le voyez pas.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-500">
              Entrez votre adresse email. Si un compte existe, vous recevrez un lien de réinitialisation.
            </p>
            <div>
              <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.nc"
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-all focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            {error && (
              <p className="text-xs text-red-600" role="alert">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Envoi…' : 'Envoyer le lien'}
            </button>
          </form>
        )}
      </div>

      <div className="text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-brand-600 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Retour à la connexion
        </Link>
      </div>
    </div>
  )
}
