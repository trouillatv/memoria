import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
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
  const url = new URL(request.url)
  const pathname = url.pathname

  const isAuthPage = pathname.startsWith('/login')
                  || pathname.startsWith('/accept-invite')
                  || pathname.startsWith('/change-password')
  const isProtectedPage = !isAuthPage
                       && (pathname.startsWith('/admin')
                        || pathname.startsWith('/dashboard')
                        || pathname.startsWith('/tenders')
                        || pathname.startsWith('/missions')
                        || pathname.startsWith('/reports')
                        || pathname.startsWith('/library')
                        || pathname.startsWith('/settings'))

  if (!user && isProtectedPage) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/missions', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
