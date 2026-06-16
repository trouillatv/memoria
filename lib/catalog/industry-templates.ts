// Templates de vocabulaire par métier (Sprint 2-B). Source UNIQUE pour :
//   - le SEED de org_catalog quand une organisation choisit son industry_template ;
//   - le FALLBACK de lecture tant que le catalogue n'est pas seedé.
//
// Le template 'cleaning' reproduit FIDÈLEMENT les enums historiques
// (AnomalyCategory + TEAM_SPECIALTIES) → parité parfaite avec le comportement
// actuel pour les organisations existantes (qui sont en 'cleaning').

export type CatalogKind = 'anomaly_category' | 'team_specialty' | 'corps_etat' | 'objet' | 'zone'

export interface CatalogEntry {
  key: string
  label: string
  icon?: string
  color?: string
  metadata?: Record<string, unknown>
}

export type IndustryTemplate = 'generic' | 'cleaning' | 'construction' | 'maintenance'

export const INDUSTRY_TEMPLATE_LABELS: Record<IndustryTemplate, string> = {
  generic: 'Générique',
  cleaning: 'Propreté / nettoyage',
  construction: 'BTP / chantier',
  maintenance: 'Maintenance / exploitation',
}

export const INDUSTRY_TEMPLATES: Record<
  IndustryTemplate,
  Partial<Record<CatalogKind, CatalogEntry[]>>
> = {
  // Base neutre : minimal, sert quand une org n'a pas (encore) choisi de métier.
  generic: {
    anomaly_category: [
      { key: 'danger_securite', label: 'Danger / sécurité', metadata: { severity: 'critique' } },
      { key: 'materiel_casse', label: 'Matériel / équipement' },
      { key: 'acces_bloque', label: 'Accès' },
      { key: 'livraison_probleme', label: 'Livraison / approvisionnement' },
      { key: 'autre', label: 'Autre' },
    ],
    team_specialty: [],
  },

  // Reproduit EXACTEMENT les enums historiques (parité existant).
  cleaning: {
    anomaly_category: [
      { key: 'acces_bloque', label: 'Accès impossible' },
      { key: 'eau_coupee', label: 'Eau coupée' },
      { key: 'electricite_coupee', label: 'Électricité coupée' },
      { key: 'zone_non_prete', label: 'Zone non prête' },
      { key: 'materiel_casse', label: 'Matériel manquant' },
      { key: 'danger_securite', label: 'Danger / sécurité', metadata: { severity: 'critique' } },
      { key: 'livraison_probleme', label: 'Livraison problème' },
      { key: 'produit_manquant', label: 'Produit manquant' },
      { key: 'autre', label: 'Autre' },
    ],
    team_specialty: [
      { key: 'bio-nettoyage', label: 'Bio-nettoyage' },
      { key: 'desinfection', label: 'Désinfection' },
      { key: 'hospitalier', label: 'Hospitalier' },
      { key: 'vitrerie', label: 'Vitrerie' },
      { key: 'vitres-hauteur', label: 'Vitres en hauteur' },
      { key: 'monobrosse', label: 'Monobrosse' },
      { key: 'espaces-verts', label: 'Espaces verts' },
      { key: 'bureaux', label: 'Bureaux' },
      { key: 'ecoles', label: 'Écoles' },
      { key: 'industriel', label: 'Industriel' },
      { key: 'residentiel', label: 'Résidentiel' },
      { key: 'conciergerie', label: 'Conciergerie' },
    ],
  },

  construction: {
    anomaly_category: [
      { key: 'non_conformite', label: 'Malfaçon / non-conformité', metadata: { severity: 'critique' } },
      { key: 'danger_securite', label: 'Sécurité', metadata: { severity: 'critique' } },
      { key: 'reserve', label: 'Réserve' },
      { key: 'acces_bloque', label: 'Accès chantier' },
      { key: 'livraison_probleme', label: 'Livraison / approvisionnement' },
      { key: 'reseau_eau', label: 'Eau / réseau' },
      { key: 'materiel_casse', label: 'Matériel' },
      { key: 'autre', label: 'Autre' },
    ],
    team_specialty: [
      { key: 'gros_oeuvre', label: 'Gros œuvre' },
      { key: 'vrd', label: 'VRD' },
      { key: 'terrassement', label: 'Terrassement' },
      { key: 'electricite', label: 'Électricité' },
      { key: 'plomberie', label: 'Plomberie' },
      { key: 'cvc', label: 'CVC' },
      { key: 'etancheite', label: 'Étanchéité' },
      { key: 'menuiserie', label: 'Menuiserie' },
      { key: 'charpente', label: 'Charpente' },
    ],
    // Base des futurs scope_types (S3) — corps d'état comme sous-périmètres.
    corps_etat: [
      { key: 'gros_oeuvre', label: 'Gros œuvre' },
      { key: 'vrd', label: 'VRD' },
      { key: 'electricite', label: 'Électricité' },
      { key: 'plomberie', label: 'Plomberie' },
      { key: 'cvc', label: 'CVC' },
      { key: 'etancheite', label: 'Étanchéité' },
    ],
  },

  maintenance: {
    anomaly_category: [
      { key: 'panne', label: 'Panne', metadata: { severity: 'critique' } },
      { key: 'danger_securite', label: 'Sécurité', metadata: { severity: 'critique' } },
      { key: 'piece_manquante', label: 'Pièce manquante' },
      { key: 'acces_bloque', label: 'Accès' },
      { key: 'autre', label: 'Autre' },
    ],
    team_specialty: [
      { key: 'cvc', label: 'CVC' },
      { key: 'ascenseurs', label: 'Ascenseurs' },
      { key: 'electricite', label: 'Électricité' },
      { key: 'ssi', label: 'SSI' },
      { key: 'plomberie', label: 'Plomberie' },
    ],
  },
}

export function isIndustryTemplate(v: string | null | undefined): v is IndustryTemplate {
  return v === 'generic' || v === 'cleaning' || v === 'construction' || v === 'maintenance'
}
