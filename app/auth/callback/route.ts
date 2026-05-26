import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Callback OAuth / récupération de mot de passe (Supabase SSR, flux PKCE).
 *
 * Le lien envoyé par `resetPasswordForEmail` (forgot-password) pointe ici avec
 * un `?code=...`. On l'échange contre une session (cookies posés), puis on
 * redirige vers `next` (par défaut /change-password) où l'utilisateur choisit
 * son nouveau mot de passe. Sans cette route, le lien de reset n'établissait
 * jamais de session → /change-password renvoyait « non authentifié ».
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Sécurité : on n'autorise que des chemins internes relatifs comme `next`.
  const nextParam = searchParams.get('next') ?? '/change-password'
  const next = nextParam.startsWith('/') ? nextParam : '/change-password'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Code absent ou échange échoué (lien expiré / déjà utilisé).
  return NextResponse.redirect(`${origin}/login?error=lien_invalide`)
}
