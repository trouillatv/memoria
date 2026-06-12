import type { UserRole } from '@/types/db'

export function resolveHomeDestination(user: {
  role: UserRole
  home_preference: 'dashboard' | 'terrain' | null
}): '/dashboard' | '/m' {
  if (user.role === 'chef_equipe') return '/m'
  return user.home_preference === 'terrain' ? '/m' : '/dashboard'
}

export function shouldRedirectDashboardRequestToField(user: {
  role: UserRole
  home_preference: 'dashboard' | 'terrain' | null
  pathname: string
}): boolean {
  if (user.pathname.startsWith('/account')) return false
  return user.role === 'chef_equipe'
}
