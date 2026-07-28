import type { UserRole } from '@/types/db'

export function isMobileUserAgent(ua: string | null): boolean {
  if (!ua) return false
  // "android" retiré : Chrome en mode "site bureau" conserve "android" dans l'UA
  // mais retire "Mobile" — le mot-clé "mobile" suffit pour les téléphones Android.
  return /iphone|ipod|mobile|blackberry|windows phone/i.test(ua)
}

export function resolveHomeDestination(user: {
  role: UserRole
  home_preference: 'dashboard' | 'terrain'
}, isMobile: boolean, isPwa: boolean = false): '/dashboard' | '/m' {
  // PWA standalone → terrain par défaut ; le mode bureau est géré côté client
  // via localStorage (PwaDesktopModeSync) et non côté serveur.
  if (isPwa) return '/m'
  // Le chef d'équipe n'a PAS de dashboard conducteur : toujours le terrain,
  // desktop comme mobile. En mode bureau (mobile → UA desktop) il était envoyé
  // sur /dashboard, une page conçue pour le conducteur qui plante pour son rôle.
  if (user.role === 'chef_equipe') return '/m'
  if (!isMobile) return '/dashboard'
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
