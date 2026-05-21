// Taux USD → XPF (franc CFP). Configurable via env, fallback constante.
//
// Contexte : MemorIA opère en Nouvelle-Calédonie. Le XPF a une parité
// fixe avec l'EUR (1 EUR = 119.3317 XPF), mais l'USD fluctue. Au
// 2026-05-20, 1 USD ≈ 110 XPF approximativement. Définir XPF_PER_USD
// dans .env.local pour ajuster si le taux évolue significativement.
//
// Aucun appel d'API live forex — déterministe, explicable, ajustable
// manuellement (cohérent avec AI_MODEL_PRICING).

const XPF_PER_USD_FALLBACK = 110

export function getXpfRate(): number {
  const env = process.env.XPF_PER_USD
  if (env) {
    const parsed = Number(env)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return XPF_PER_USD_FALLBACK
}

/**
 * Convertit USD → XPF SANS arrondi (float).
 *
 * Vincent 2026-05-21 : avant on faisait Math.round, ce qui écrasait les
 * coûts AI infimes à 0 (un appel Gemini Flash ≈ 0.025 F → arrondi à 0 F →
 * « 0 F partout » dans la table coût par feature). Désormais on garde la
 * précision et c'est `fmtXpf` qui décide du nombre de décimales selon la
 * magnitude.
 */
export function usdToXpf(usd: number | null | undefined): number {
  if (!usd || !Number.isFinite(usd)) return 0
  return usd * getXpfRate()
}

/**
 * Format XPF selon la magnitude — Vincent 2026-05-21.
 *   0           → « 0 F »
 *   < 0.001 F   → « < 0.001 F »
 *   < 1 F       → 3 décimales (« 0.025 F »)
 *   < 10 F      → 2 décimales (« 5.23 F »)
 *   ≥ 10 F      → entier formaté (« 234 F », « 1 245 F »)
 */
export function fmtXpf(xpf: number): string {
  if (xpf === 0) return '0 F'
  if (xpf < 0.001) return '< 0.001 F'
  if (xpf < 1) return `${xpf.toFixed(3)} F`
  if (xpf < 10) return `${xpf.toFixed(2)} F`
  const rounded = Math.round(xpf)
  return `${rounded.toLocaleString('fr-FR').replace(/ /g, ' ')} F`
}

/** Format USD compact : « $1.23 » ou « < $0.01 » si infime. */
export function fmtUsd(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return '< $0.01'
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}
