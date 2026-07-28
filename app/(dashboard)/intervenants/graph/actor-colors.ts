// Couleurs PARTAGÉES du langage visuel des acteurs (graphe structurel + graphe de
// collaboration) : fond = organisation, halo = attention. Extraites pour éviter la
// divergence entre les deux rendus.

import type { AttentionLevel } from '@/lib/knowledge/actor-attention'

/** Anneau d'alerte (halo) : rouge/orange ; rien si à jour. */
export const RING_COLOR: Record<AttentionLevel, string | null> = { urgent: '#dc2626', attention: '#f59e0b', ok: null }
export const HISTORICAL_COLOR = '#94a3b8'
/** Nœud sans entreprise (le tissu) — les entreprises ressortent. */
export const NEUTRAL_FILL = '#cbd5e1'

// Palette d'ENTREPRISES — bleus/verts/violets/cyans, SANS rouge ni orange (réservés
// au halo d'alerte : une couleur d'alerte n'est jamais une couleur d'entreprise).
export const COMPANY_PALETTE = [
  '#3b82f6', '#22c55e', '#a855f7', '#14b8a6', '#ec4899', '#6366f1',
  '#06b6d4', '#8b5cf6', '#0ea5e9', '#10b981', '#d946ef', '#84cc16',
]

/** Couleur stable d'une entreprise (fond) — hash de l'id sur la palette. */
export function companyFill(companyId: string | null): string {
  if (!companyId) return NEUTRAL_FILL
  let h = 0
  for (let i = 0; i < companyId.length; i++) h = (h * 31 + companyId.charCodeAt(i)) >>> 0
  return COMPANY_PALETTE[h % COMPANY_PALETTE.length]!
}
