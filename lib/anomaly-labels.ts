export const ANOMALY_CATEGORY_LABELS: Record<string, string> = {
  acces_bloque: 'Accès impossible',
  eau_coupee: 'Eau coupée',
  electricite_coupee: 'Électricité coupée',
  zone_non_prete: 'Zone non prête',
  materiel_casse: 'Matériel manquant',
  danger_securite: 'Danger / sécurité',
  livraison_probleme: 'Livraison problème',
  produit_manquant: 'Produit manquant',
  autre: 'Autre',
}

export function anomalyLabel(
  description: string | null,
  categoryOther: string | null,
  category: string,
): string {
  return description || categoryOther || ANOMALY_CATEGORY_LABELS[category] || category
}
