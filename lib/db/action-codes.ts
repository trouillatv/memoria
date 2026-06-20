// Codes responsables de la colonne ACTION du PV BECIB (mig 132). Constante PURE
// (aucune dépendance serveur) → importable côté client ET serveur. La logique DB
// vit dans report-point-actions.ts (server-only) ; ici, juste le vocabulaire.
export const ACTION_CODES = ['ETV', 'MOA', 'MOE', 'FSH', 'CLUB'] as const
export type ActionCode = (typeof ACTION_CODES)[number]
