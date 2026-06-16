// 🗺️ Catalogue des SOURCES DE MÉMOIRE — registre déclaratif ET exécutable (P7).
//
// Cartographie unique de TOUT ce qui peut nourrir « Interroger l'entreprise ».
// Objectif : passer P7 de « traces + documents » à aussi couvrir la donnée
// d'EXÉCUTION réelle (actions, réserves, missions). Chaque ligne décrit une
// source : sa couche mémorielle, sa table, son mode de retrieval, et SON ÉTAT
// COURANT (branchée ou non dans le moteur org-level, présente ou non dans la
// synthèse 2C). Ce n'est pas une doc : `orgEnabledSources()` est requêtable.
//
// Golden rule : sujet = lieu / chantier / trace, JAMAIS une personne. Les lignes
// « organisation » (équipes / fournisseurs) et « business » (contrats) restent
// DÉSACTIVÉES — présentes pour que la cartographie soit complète, pas branchées.

export type MemoryLevel = 'terrain' | 'execution' | 'connaissance' | 'organisation' | 'business'
export type RetrieverMode = 'fts' | 'embedding' | 'structure'

export interface MemorySource {
  /** Identifiant stable de la source ('anomaly', 'action', 'reserve', …). */
  id: string
  level: MemoryLevel
  /** Table DB principale, ou null pour une source composite. */
  table: string | null
  mode: RetrieverMode
  /** Est-elle actuellement interrogée par « Interroger l'entreprise » ? */
  enabledInOrgMemory: boolean
  uiLabel: string
  /** Valeur OrgMemoryHit.type produite par cette source. */
  resultType: string
  hasSiteId: boolean
  /** Incluse dans le corpus de la synthèse 2C ? */
  inSynthesis: boolean
}

export const MEMORY_SOURCES: MemorySource[] = [
  // ── Terrain — traces brutes (fts via search_memory + sémantique via embeddings)
  {
    id: 'anomaly', level: 'terrain', table: 'anomalies', mode: 'fts',
    enabledInOrgMemory: true, uiLabel: 'Anomalie', resultType: 'anomaly',
    hasSiteId: true, inSynthesis: true,
  },
  {
    id: 'site_note', level: 'terrain', table: 'site_notes', mode: 'fts',
    enabledInOrgMemory: true, uiLabel: 'Note', resultType: 'site_note',
    hasSiteId: true, inSynthesis: true,
  },
  {
    // Les interventions remontent via leurs NOTES (intervention_note) dans
    // search_memory + embeddings — pas de table interrogée en propre.
    id: 'intervention_note', level: 'terrain', table: 'intervention_notes', mode: 'fts',
    enabledInOrgMemory: true, uiLabel: 'Intervention', resultType: 'intervention',
    hasSiteId: true, inSynthesis: true,
  },
  {
    id: 'photo', level: 'terrain', table: 'photos', mode: 'embedding',
    enabledInOrgMemory: true, uiLabel: 'Photo', resultType: 'photo',
    hasSiteId: true, inSynthesis: true,
  },

  // ── Exécution — donnée d'EXÉCUTION réelle (keyword-only, ILIKE org-scopé).
  // NOUVEAU dans ce lot. Pas d'embedding : précision keyword, coût nul.
  {
    id: 'action', level: 'execution', table: 'site_actions', mode: 'fts',
    enabledInOrgMemory: true, uiLabel: 'Action', resultType: 'action',
    hasSiteId: true, inSynthesis: true,
  },
  {
    id: 'reserve', level: 'execution', table: 'site_reserve', mode: 'fts',
    enabledInOrgMemory: true, uiLabel: 'Réserve', resultType: 'reserve',
    hasSiteId: true, inSynthesis: true,
  },
  {
    id: 'mission', level: 'execution', table: 'missions', mode: 'fts',
    enabledInOrgMemory: true, uiLabel: 'Mission', resultType: 'mission',
    hasSiteId: true, inSynthesis: true,
  },

  // ── Connaissance — bibliothèque / AO passés / documents (sémantique only,
  // attribué à sa SOURCE documentaire, pas à un site).
  {
    id: 'knowledge', level: 'connaissance', table: null, mode: 'embedding',
    enabledInOrgMemory: true, uiLabel: 'Document', resultType: 'document',
    hasSiteId: false, inSynthesis: true,
  },

  // ── Organisation — équipes / fournisseurs. DÉSACTIVÉ : structure, pas de
  // free-text à retrouver, et axe RH/personne hors-jeu pour le moteur mémoire.
  {
    id: 'teams', level: 'organisation', table: 'teams', mode: 'structure',
    enabledInOrgMemory: false, uiLabel: 'Équipe', resultType: 'team',
    hasSiteId: false, inSynthesis: false,
  },
  {
    id: 'fournisseurs', level: 'organisation', table: 'suppliers', mode: 'structure',
    enabledInOrgMemory: false, uiLabel: 'Fournisseur', resultType: 'supplier',
    hasSiteId: false, inSynthesis: false,
  },

  // ── Business — contrats. DÉSACTIVÉ : structure (montants/échéances), pas une
  // source de mémoire free-text ; branché plus tard si besoin.
  {
    id: 'contract', level: 'business', table: 'contracts', mode: 'structure',
    enabledInOrgMemory: false, uiLabel: 'Contrat', resultType: 'contract',
    hasSiteId: false, inSynthesis: false,
  },
]

/** Les sources réellement interrogées par « Interroger l'entreprise ». */
export function orgEnabledSources(): MemorySource[] {
  return MEMORY_SOURCES.filter((s) => s.enabledInOrgMemory)
}
