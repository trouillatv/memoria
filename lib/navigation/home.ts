import type { UserRole } from '@/types/db'

export function isMobileUserAgent(ua: string | null): boolean {
  if (!ua) return false
  // "android" retiré : Chrome en mode "site bureau" conserve "android" dans l'UA
  // mais retire "Mobile" — le mot-clé "mobile" suffit pour les téléphones Android.
  return /iphone|ipod|mobile|blackberry|windows phone/i.test(ua)
}

// Doctrine (2026-08-04) :
//   chef_equipe    → toujours /m, sans exception
//   PWA standalone → toujours /m (le mode bureau temporaire est géré côté client)
//   manager/admin  → home_preference fait foi, quel que soit l'UA
//
// L'UA ne surcharge plus la préférence. La protection "petit viewport sur faux
// UA desktop" est assurée côté client par <ViewportGuard> dans le layout dashboard.
export function resolveHomeDestination(user: {
  role: UserRole
  home_preference: 'dashboard' | 'terrain'
}, isPwa: boolean = false): '/dashboard' | '/m' {
  if (isPwa) return '/m'
  if (user.role === 'chef_equipe') return '/m'
  return user.home_preference === 'terrain' ? '/m' : '/dashboard'
}

export function shouldRedirectDashboardRequestToField(user: {
  role: UserRole
  home_preference: 'dashboard' | 'terrain'
  pathname: string
}, _isMobile: boolean): boolean {
  // Ses réglages de compte restent accessibles (pas de redirection sur /account).
  if (user.pathname.startsWith('/account')) return false
  // Chef d'équipe : jamais le dashboard conducteur, quel que soit le viewport.
  // (Le mode bureau contournait l'ancienne garde `isMobile` et menait au crash.)
  return user.role === 'chef_equipe'
}
