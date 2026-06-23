// Constantes PURES des blocages de chantier (mig 160) — aucune dépendance
// serveur → importables côté client ET serveur (cf. piège ACTION_CODES). La
// logique DB vit dans site-blocages.ts (server-only) ; ici, juste le
// vocabulaire + ses libellés. Doctrine : descriptif, jamais un score.
export const BLOCAGE_TYPES = [
  'intemperie', 'greve', 'acces', 'livraison',
  'materiel', 'sous_traitant', 'administratif', 'securite', 'autre',
] as const
export type BlocageType = (typeof BLOCAGE_TYPES)[number]

export const BLOCAGE_TYPE_LABEL: Record<BlocageType, string> = {
  intemperie: 'Intempéries',
  greve: 'Grève',
  acces: 'Accès',
  livraison: 'Livraison',
  materiel: 'Matériel',
  sous_traitant: 'Sous-traitant',
  administratif: 'Administratif',
  securite: 'Sécurité',
  autre: 'Autre',
}

/** Devine un type de blocage à partir d'un texte libre (risque/anomalie détecté).
 *  Heuristique déterministe — sert UNIQUEMENT à pré-remplir une proposition que
 *  l'humain valide ; jamais à créer un blocage tout seul. */
export function guessBlocageType(text: string | null | undefined): BlocageType {
  const t = (text ?? '').toLowerCase()
  if (/pluie|intemp|météo|meteo|orage|vent|inond|neige|gel\b/.test(t)) return 'intemperie'
  if (/grève|greve|débrayage|debrayage/.test(t)) return 'greve'
  if (/accès|acces|fermé|ferme\b|portail|clé|cle\b|badge/.test(t)) return 'acces'
  if (/livr|appro|approvision|commande|stock|rupture/.test(t)) return 'livraison'
  if (/matériel|materiel|engin|grue|nacelle|panne|casse/.test(t)) return 'materiel'
  if (/sous-?trait|sous-?trait|prestataire|entreprise absente|absent/.test(t)) return 'sous_traitant'
  if (/autoris|permis|administ|bureau de contrôle|controle|visa|dossier/.test(t)) return 'administratif'
  if (/sécurit|securit|danger|risque|epi\b|chute/.test(t)) return 'securite'
  return 'autre'
}
