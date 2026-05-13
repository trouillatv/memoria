import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Enforce le flag must_change_password sur toutes les routes authentifiées.
// Lit le flag depuis app_metadata du JWT (pas de DB call par requête).
//
// Le flag est posé par :
//   - app/admin/users/actions.ts (création temp_password, force_reset)
// Et effacé par :
//   - app/(auth)/change-password/actions.ts

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Bypass : routes publiques où la session importe peu (ou pas du tout).
  if (
    pathname.startsWith('/change-password') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/accept-invite') ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/v/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Pas authentifié : on laisse les layouts faire la redirection vers /login.
  if (!user) return response

  const mustChange = user.app_metadata?.must_change_password === true
  if (mustChange) {
    return NextResponse.redirect(new URL('/change-password', request.url))
  }

  return response
}

export const config = {
  // Match toutes les routes sauf assets statiques et routes publiques.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
