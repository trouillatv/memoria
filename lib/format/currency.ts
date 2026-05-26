// Affichage des coûts IA en franc Pacifique (XPF) — pilote NC (2026-05-27).
//
// Le XPF est ARRIMÉ à l'euro à taux fixe (1000 XPF = 8,38 EUR). Le ratio
// USD→XPF ci-dessous est un ratio d'AFFICHAGE STABLE (peg XPF/EUR + parité
// EUR/USD arrondie ≈ 0,92), PAS un taux de change live. Cohérent avec la
// doctrine « pas de live pricing » de services/ai/tracking : déterministe
// et explicable. À ajuster manuellement si la parité dérive durablement.
//
//   1 EUR ≈ 119,33 XPF (peg fixe) · 1 USD ≈ 0,92 EUR  ⇒  1 USD ≈ 110 XPF
export const USD_TO_XPF = 110

/** Formate un montant USD en XPF pour l'affichage. Le XPF n'a pas de
 *  sous-unité, mais les coûts IA unitaires sont souvent < 1 F : on garde
 *  alors 2 décimales pour rester informatif, sinon arrondi au franc. */
export function formatXpf(usd: number): string {
  const xpf = usd * USD_TO_XPF
  if (xpf === 0) return '0 F'
  if (xpf < 1) return `${xpf.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} F`
  return `${Math.round(xpf).toLocaleString('fr-FR')} F`
}
