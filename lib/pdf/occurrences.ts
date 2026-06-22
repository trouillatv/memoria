// Occurrences documentaires d'un terme (Vincent 2026-06-22). DÉTERMINISTE, zéro IA :
// sur le texte balisé [[page N]], on liste les pages où un terme canonique (ou ses
// alias) apparaît. « DOE n'est plus un mot, c'est un objet : p.4 · p.9 · p.17 ».
// S'appuie sur le glossaire (entité canonique) — d'où l'intérêt de le nourrir.

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ')
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function wb(hayNorm: string, formNorm: string): boolean {
  if (formNorm.length < 3) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(formNorm)}([^a-z0-9]|$)`).test(hayNorm)
}

/** Pages (numéros) où l'une des formes apparaît, sur un texte balisé « [[page N]] ». */
export function pagesContaining(markedText: string | null | undefined, forms: string[]): number[] {
  if (!markedText || forms.length === 0) return []
  const nforms = forms.map(norm).filter((f) => f.length >= 3)
  if (nforms.length === 0) return []
  // split capturant le numéro : [avant, "1", texte1, "2", texte2, …]
  const segs = markedText.split(/\[\[page (\d+)\]\]/)
  const pages = new Set<number>()
  for (let i = 1; i < segs.length; i += 2) {
    const pg = parseInt(segs[i], 10)
    const txt = norm(segs[i + 1] ?? '')
    if (!Number.isNaN(pg) && nforms.some((f) => wb(txt, f))) pages.add(pg)
  }
  return [...pages].sort((a, b) => a - b)
}

/** Formes (terme + alias) du glossaire dont le terme/alias apparaît dans le libellé. */
export function glossaryFormsForLabel(label: string, glossary: Array<{ term: string; aliases: string[] }>): string[] | null {
  const n = norm(label)
  for (const g of glossary) {
    const forms = [g.term, ...(g.aliases ?? [])]
    if (forms.some((f) => wb(n, norm(f)))) return forms
  }
  return null
}
