import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { COOKIE_PWA_STANDALONE } from '@/lib/navigation/pwa-mode'

// Middleware (renommé "proxy" en Next 16). Trois rôles :
//  1. Exposer pathname aux Server Components via header `x-pathname` (utilisé
//     par (dashboard)/layout.tsx pour le cas /account, accessible à tous rôles).
//  2. Rediriger /login vers /missions si l'utilisateur est déjà authentifié,
//     et bloquer l'accès aux routes protégées si non authentifié.
//  3. Enforce le flag must_change_password depuis app_metadata du JWT (posé
//     par app/admin/users/actions.ts, effacé par change-password/actions.ts).
//     Aucune query DB par requête — tout est lu depuis le JWT.

export async function proxy(request: NextRequest) {
  const url = new URL(request.url)
  const pathname = url.pathname
  const isAuthPage = pathname.startsWith('/login')
                  || pathname.startsWith('/accept-invite')
                  || pathname.startsWith('/change-password')
                  || pathname.startsWith('/forgot-password')

  // Header x-pathname pour Server Components.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', pathname)

  // Bypass : routes publiques + assets internes Next. Pas besoin d'aller
  // chercher la session pour ces URLs.
  if (
    pathname === '/' ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/v/') ||
    pathname.startsWith('/c/') ||
    pathname.startsWith('/h/') ||
    pathname.startsWith('/qr/') ||
    pathname.startsWith('/auth/') ||
    isAuthPage ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: requestHeaders } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isProtectedPage = !isAuthPage
                       && (pathname.startsWith('/admin')
                        || pathname.startsWith('/dashboard')
                        || pathname.startsWith('/contracts')
                        || pathname.startsWith('/tenders')
                        || pathname.startsWith('/missions')
                        || pathname.startsWith('/reports')
                        || pathname.startsWith('/library')
                        || pathname.startsWith('/settings')
                        || pathname.startsWith('/account'))

  if (!user && isProtectedPage) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }
  if (user && pathname === '/login') {
    const isPwa = request.cookies.get(COOKIE_PWA_STANDALONE)?.value === '1'
    const dest = isPwa ? '/m' : '/missions'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Enforce must_change_password : si le flag est dans app_metadata, on
  // redirige vers la page de changement (sauf si on y est déjà ou sur une
  // page d'auth). Lu uniquement depuis le JWT, zéro query DB.
  if (user && !isAuthPage) {
    const mustChange = user.app_metadata?.must_change_password === true
    if (mustChange) {
      return NextResponse.redirect(new URL('/change-password', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
