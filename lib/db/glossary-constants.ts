// Constantes glossaire SANS dépendance serveur — importable côté client.
// (lib/db/glossary.ts tire createAdminClient/getOrgId → next/headers, donc un
//  composant client ne doit PAS en importer une valeur.)

/** Catégories suggérées (libre — l'utilisateur peut en saisir d'autres). */
export const GLOSSARY_CATEGORIES = ['engin', 'matériau', 'document', 'processus', 'contrôle', 'acteur'] as const
