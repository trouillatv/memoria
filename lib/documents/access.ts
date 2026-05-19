import type { UserRole, DocumentVisibility } from '@/types/db'

// Accès documentaire — fonction PURE (phase 3, spec 2026-05-19 décision G/J).
//
// Doctrine : un document est un artefact mémoire. L'accès est role-gaté par
// `visibility_level`, JAMAIS indexé/filtré par personne. Le paramètre est un
// RÔLE, pas une identité — aucune surface sujet-personne.
//
// Périmètre visionneuse phase 3 = admin/manager (arbitrage Vincent). Les
// niveaux operations/field/client_portal existent pour l'évolution produit
// mais ne donnent pas accès à la visionneuse dashboard tant qu'une surface
// dédiée n'est pas décidée (chef_equipe → false ici).
export function canViewDocument(
  role: UserRole | null,
  level: DocumentVisibility,
): boolean {
  if (role === 'admin') return true
  if (role === 'manager') return level !== 'admin_only'
  return false
}
