export const ANOMALY_CATEGORY_LABELS: Record<string, string> = {
  acces_bloque: 'Accès impossible',
  materiel_casse: 'Matériel manquant ou cassé',
  eau_coupee: 'Eau coupée',
  produit_manquant: 'Zone sale avant intervention',
  autre: 'Autre',
}

export function anomalyLabel(
  description: string | null,
  categoryOther: string | null,
  category: string,
): string {
  return description || categoryOther || ANOMALY_CATEGORY_LABELS[category] || category
}
