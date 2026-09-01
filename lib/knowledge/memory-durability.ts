// ── Point 17A — sélection d'affichage « mémoire durable » ────────────────────
// Projection PURE et DÉTERMINISTE : décide ce que l'INTERFACE appelle « mémoire
// durable » à partir de la `thematic_category` déjà stockée. Ne modifie NI la
// vérité stockée, NI le statut (`site_knowledge_entries.status`), NI l'extraction
// — c'est une responsabilité de read-model, entièrement réversible. Aucun LLM :
// la catégorie stockée décide, jamais un jugement dynamique.
//
// Les thèmes temporels/événementiels (avancement, prévisions, météo, essais)
// n'encombrent plus la lecture durable, MAIS rien n'est supprimé : ils restent
// accessibles via « Voir toute l'activité consignée ». Mesure (2026-09-02) :
// OCEF knowledge 321 → 73 durables (248 en activité) ; BELLA 38 → 17 ; PETRO 0.
//
// DÉFAUT = DURABLE : un thème absent/inconnu n'est JAMAIS masqué silencieusement
// (on ne cache que ce qu'on a explicitement reconnu comme activité).

export const ACTIVITY_THEMES = new Set<string>([
  'progress',      // avancement constaté (log PV par PV)
  'forecast',      // prévisions
  'weather',       // intempéries
  'test_control',  // essais / contrôles ponctuels
])

/** `true` si la connaissance relève de la mémoire DURABLE (à montrer en lecture
 *  principale). `false` = fait d'activité/événementiel (accessible en second
 *  niveau). Un thème nul/inconnu est durable par défaut (jamais masqué). */
export function isDurableTheme(theme: string | null | undefined): boolean {
  return !ACTIVITY_THEMES.has(theme ?? '')
}
