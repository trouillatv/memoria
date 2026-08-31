// Origine d'un `site_report` — primitive PARTAGÉE, source unique de vérité pour la
// question métier « est-ce une VISITE TERRAIN ? ». Objectif : que tous les
// read-models « visite » répondent la même chose et qu'on ne recrée jamais la
// divergence « 2 visites » ici / « aucune visite » ailleurs (P0.5-Vérité).
//
//   origin ∈ TERRAIN_VISIT_ORIGINS → visite terrain (événement MemorIA sur site)
//   origin === 'import'            → PV/CR historique importé (source documentaire)
//   origin === null                → réunion / compte-rendu
//
// Un import n'est JAMAIS une visite terrain : il ne compte pas dans « N visites »,
// « première/dernière visite », ni les logiques « depuis/avant la dernière visite »,
// et n'est jamais « En cours » du seul fait de `ended_at IS NULL`.
//
// Module FEUILLE (aucun import) : sûr à importer partout, aucun cycle.

export const TERRAIN_VISIT_ORIGINS = ['planned', 'spontaneous', 'qr', 'gps'] as const
export type TerrainVisitOrigin = (typeof TERRAIN_VISIT_ORIGINS)[number]

/** Origine d'un PV/CR historique importé — définition UNIQUE (jamais un magic
 *  string dupliqué : un filtre `.eq('origin', IMPORTED_DOCUMENT_ORIGIN)` et le
 *  prédicat ci-dessous partagent la même vérité). */
export const IMPORTED_DOCUMENT_ORIGIN = 'import' as const

/** Vrai si l'origine désigne une VISITE TERRAIN (jamais un import, jamais une réunion). */
export function isTerrainVisitOrigin(origin: string | null | undefined): boolean {
  return origin != null && (TERRAIN_VISIT_ORIGINS as readonly string[]).includes(origin)
}

/** Vrai si l'origine désigne un PV/CR historique importé (source documentaire, pas une visite). */
export function isImportedDocumentOrigin(origin: string | null | undefined): boolean {
  return origin === IMPORTED_DOCUMENT_ORIGIN
}
