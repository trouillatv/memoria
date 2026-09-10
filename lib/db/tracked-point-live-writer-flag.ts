// P6 Live Writer — kill-switch (mandat Vincent, rollout global). OFF par défaut.
//
// Aucune table de feature-flag, aucune migration : même convention que les kill-switches
// globaux existants (CONTINUITY_PAGE_ENABLED, lib/continuity/access.ts ;
// INTERVENANTS_PAGE_ENABLED, lib/intervenants/access.ts) — lue fraîche depuis process.env à
// chaque appel, jamais mise en cache au chargement du module (testable via mutation directe
// de process.env).
//
// Règles : variable absente → OFF ; chaîne vide → OFF ; valeur exactement '*' (espaces ignorés)
// → ON pour tous les sites (activation globale explicite) ; sinon, liste d'UUID séparés par
// virgule → ON seulement pour les sites listés (allowlist historique, conservée pour un retour
// ciblé à un sous-ensemble de sites sans changement de code) ; un seul token invalide dans la
// liste, ou mélange de '*' avec autre chose → configuration entière invalide → OFF pour TOUS les
// sites (fail-closed, jamais une activation partielle implicite qui laisserait croire que le
// reste de la liste reste fiable).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTrackedPointLiveWriterEnabledForSite(siteId: string): boolean {
  const raw = process.env.TRACKED_POINT_LIVE_WRITER_SITE_IDS
  if (!raw || raw.trim() === '') return false
  if (raw.trim() === '*') return true

  const tokens = raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
  if (tokens.length === 0) return false
  if (tokens.some((t) => !UUID_RE.test(t))) return false

  const allowlist = new Set(tokens.map((t) => t.toLowerCase()))
  return allowlist.has(siteId.toLowerCase())
}
