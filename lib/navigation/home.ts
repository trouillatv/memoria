import type { UserRole } from '@/types/db'

// Doctrine 2026-08-06 :
//   La surface est déterminée par le rôle (exception métier) et le point d'entrée.
//   La PWA entre naturellement par /m via manifest start_url — pas besoin de détecter.
//
//   chef_equipe → toujours /m (il exécute, il ne pilote pas)
//   admin / manager → /dashboard (pilotage)
export function resolveHomeDestination(role: UserRole): '/m' | '/dashboard' {
  if (role === 'chef_equipe') return '/m'
  return '/dashboard'
}
