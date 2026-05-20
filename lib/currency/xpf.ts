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

export function usdToXpf(usd: number | null | undefined): number {
  if (!usd || !Number.isFinite(usd)) return 0
  return Math.round(usd * getXpfRate())
}

/** Format XPF entier court : « 1 245 F » ou « < 1 F » si infime. */
export function fmtXpf(xpf: number): string {
  if (xpf === 0) return '0 F'
  if (xpf < 1) return '< 1 F'
  // Espaces fines comme séparateur de milliers, locale fr-FR-style
  return `${xpf.toLocaleString('fr-FR').replace(/ /g, ' ')} F`
}

/** Format USD compact : « $1.23 » ou « < $0.01 » si infime. */
export function fmtUsd(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return '< $0.01'
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}
