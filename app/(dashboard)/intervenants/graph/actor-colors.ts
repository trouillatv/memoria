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

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r0, g0, b0] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r0)}${toHex(g0)}${toHex(b0)}`
}

/** Déclinaison PASTEL de `companyFill` — même teinte (même identité par entreprise),
 *  fond clair et texte foncé au lieu d'un aplat vif + blanc. Recette Vincent
 *  2026-09-15 : les avatars vifs (violet/rose ARES) tiraient l'œil autant que les
 *  vrais signaux métier ; on garde la couleur stable, on baisse juste l'intensité. */
export function companyPastel(companyId: string | null): { bg: string; fg: string } {
  const [h] = hexToHsl(companyFill(companyId))
  return { bg: hslToHex(h, 0.45, 0.9), fg: hslToHex(h, 0.5, 0.32) }
}
