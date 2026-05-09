import type { UserRole } from '@/types/db'

interface RoleGuardProps {
  currentRole: UserRole
  allowedRoles: UserRole[]
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function RoleGuard({ currentRole, allowedRoles, children, fallback = null }: RoleGuardProps) {
  if (!allowedRoles.includes(currentRole)) return <>{fallback}</>
  return <>{children}</>
}
