// Niveau de confiance d'une citation source (Vincent 2026-06-22).
// « Une page inventée est pire que pas de page. » On dérive 3 niveaux du couple
// (page, section) et l'UI s'adapte : page fiable → ouvrir la page ; section seule →
// rechercher dans le document ; rien → référence approximative, pas de bouton page.

export type CitationLevel = 'exact' | 'section' | 'approximate'

export function citationLevel(page: number | null | undefined, section: string | null | undefined): CitationLevel {
  if (page != null) return 'exact'
  if (section != null && String(section).trim().length > 0) return 'section'
  return 'approximate'
}

export const CITATION_META: Record<CitationLevel, { label: string; tone: string }> = {
  exact: { label: 'Citation exacte', tone: 'text-emerald-700' },
  section: { label: 'Section connue', tone: 'text-sky-700' },
  approximate: { label: 'Référence approximative', tone: 'text-amber-700' },
}
