import type { UserRole } from '@/types/db'

export function isMobileUserAgent(ua: string | null): boolean {
  if (!ua) return false
  return /android|iphone|ipad|ipod|mobile|blackberry|windows phone/i.test(ua)
}

export function resolveHomeDestination(user: {
  role: UserRole
  home_preference: 'dashboard' | 'terrain'
}, isMobile: boolean, isPwa: boolean = false): '/dashboard' | '/m' {
  // PWA standalone → terrain par défaut ; le mode bureau est géré côté client
  // via localStorage (PwaDesktopModeSync) et non côté serveur.
  if (isPwa) return '/m'
  if (!isMobile) return '/dashboard'
  if (user.role === 'chef_equipe') return '/m'
  return user.home_preference === 'terrain' ? '/m' : '/dashboard'
}

export function shouldRedirectDashboardRequestToField(user: {
  role: UserRole
  home_preference: 'dashboard' | 'terrain'
  pathname: string
}, isMobile: boolean): boolean {
  if (!isMobile) return false
  if (user.pathname.startsWith('/account')) return false
  return user.role === 'chef_equipe'
}
