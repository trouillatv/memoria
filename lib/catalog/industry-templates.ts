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
      { key: 'danger_securite', label: 'Danger / sécurité', icon: '⚠️', metadata: { severity: 'critique' } },
      { key: 'materiel_casse', label: 'Matériel / équipement', icon: '🧰' },
      { key: 'acces_bloque', label: 'Accès', icon: '🚪' },
      { key: 'livraison_probleme', label: 'Livraison / approvisionnement', icon: '📦' },
      { key: 'autre', label: 'Autre', icon: '✏️' },
    ],
    team_specialty: [],
  },

  // Reproduit EXACTEMENT les enums historiques (parité existant).
  cleaning: {
    // Reproduit EXACTEMENT le picker historique (8 entrées, ordre + icônes) →
    // la création d'anomalie pilotée par le catalogue reste identique en cleaning.
    anomaly_category: [
      { key: 'acces_bloque', label: 'Accès impossible', icon: '🚪' },
      { key: 'eau_coupee', label: 'Eau coupée', icon: '🚱' },
      { key: 'electricite_coupee', label: 'Électricité coupée', icon: '⚡' },
      { key: 'zone_non_prete', label: 'Zone non prête', icon: '🚧' },
      { key: 'materiel_casse', label: 'Matériel manquant', icon: '🧰' },
      { key: 'danger_securite', label: 'Danger / sécurité', icon: '⚠️', metadata: { severity: 'critique' } },
      { key: 'livraison_probleme', label: 'Livraison problème', icon: '📦' },
      { key: 'autre', label: 'Autre', icon: '✏️' },
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
      { key: 'non_conformite', label: 'Malfaçon / non-conformité', icon: '❌', metadata: { severity: 'critique' } },
      { key: 'danger_securite', label: 'Sécurité', icon: '⚠️', metadata: { severity: 'critique' } },
      { key: 'reserve', label: 'Réserve', icon: '📋' },
      { key: 'acces_bloque', label: 'Accès chantier', icon: '🚧' },
      { key: 'livraison_probleme', label: 'Livraison / approvisionnement', icon: '📦' },
      { key: 'reseau_eau', label: 'Eau / réseau', icon: '💧' },
      { key: 'materiel_casse', label: 'Matériel', icon: '🧰' },
      { key: 'autre', label: 'Autre', icon: '✏️' },
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
      { key: 'panne', label: 'Panne', icon: '🛠️', metadata: { severity: 'critique' } },
      { key: 'danger_securite', label: 'Sécurité', icon: '⚠️', metadata: { severity: 'critique' } },
      { key: 'piece_manquante', label: 'Pièce manquante', icon: '🔩' },
      { key: 'acces_bloque', label: 'Accès', icon: '🚪' },
      { key: 'autre', label: 'Autre', icon: '✏️' },
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
