import type { UserRole } from '@/types/db'

// Doctrine 2026-08-04 :
//   Le support détermine la surface par défaut, sauf quand le rôle appartient
//   exclusivement à une surface.
//
//   chef_equipe → toujours /m (il exécute, il ne pilote pas)
//   PWA standalone + tout rôle → toujours /m (le contenant décide)
//   admin / manager en navigateur → /dashboard
export function resolveHomeDestination(role: UserRole, isPwa: boolean): '/m' | '/dashboard' {
  if (role === 'chef_equipe') return '/m'
  return isPwa ? '/m' : '/dashboard'
}
