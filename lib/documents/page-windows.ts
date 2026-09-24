// Découpage générique d'un texte de document long en fenêtres de pages, avec
// léger recouvrement — pour tout extracteur IA opérant sur un document balisé
// [[page N]] (services/pdf/extract.ts, natif ET OCR). Ce module ne connaît
// rien d'un domaine métier particulier (pas d'Engagement, pas de CCTP) : il
// est réutilisable par n'importe quel futur extracteur de document long.
//
// Pourquoi des fenêtres par PAGE (jamais par découpe brute de caractères) :
// [[page N]] est l'unité atomique du grounding mécanique (locateQuote,
// services/ai/source-validation.ts). Couper au milieu d'une page casserait
// la correspondance extrait→page pour tout candidat trouvé dans ce fragment.
//
// Aucun import — module pur, testable sans mock.

export interface DocumentPage {
  pageNumber: number
  /** Texte de la page, marqueur [[page N]] exclu. */
  text: string
}

export interface PageWindow {
  /** Index de fenêtre, 0-based, dans l'ordre de lecture. */
  index: number
  /** Numéros de page inclus dans cette fenêtre, dans l'ordre. */
  pages: number[]
  /** Texte reconstitué de la fenêtre, marqueurs [[page N]] réinsérés — un
   *  extrait renvoyé par l'agent sur cette fenêtre reste relocalisable
   *  exactement comme sur le document complet (locateQuote inchangé). */
  text: string
}

const PAGE_MARKER = /\[\[page (\d+)\]\]/g

/**
 * Découpe un texte balisé [[page N]] en pages individuelles. Un texte sans
 * aucun marqueur (jamais produit par services/pdf/extract.ts en pratique,
 * mais défensif) est traité comme une page unique numéro 1.
 */
export function parsePagedText(text: string): DocumentPage[] {
  const matches = [...text.matchAll(PAGE_MARKER)]
  if (matches.length === 0) {
    return text.trim().length > 0 ? [{ pageNumber: 1, text }] : []
  }
  const pages: DocumentPage[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!
    const pageNumber = Number(m[1])
    const start = m.index! + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length
    pages.push({ pageNumber, text: text.slice(start, end) })
  }
  return pages
}

function renderWindow(pages: DocumentPage[]): string {
  return pages.map((p) => `[[page ${p.pageNumber}]]${p.text}`).join('')
}

export interface BuildPageWindowsOptions {
  /** Budget de caractères par fenêtre (hors marqueurs). Par défaut 40 000
   *  chars (~10 000 tokens, cf. estimateTokens dans lib/ai/document-budget.ts) :
   *  large marge sous le contexte réel des deux providers (Gemini/Anthropic),
   *  la contrainte n'étant pas un débordement de fenêtre de contexte mais la
   *  qualité d'attention du modèle et le volume de sortie par appel. */
  maxChars?: number
  /** Nombre de pages répétées en tête de la fenêtre suivante, pour qu'une
   *  clause à cheval sur une frontière de fenêtre reste lisible en entier
   *  dans au moins une fenêtre. */
  overlapPages?: number
}

export const DEFAULT_WINDOW_MAX_CHARS = 40_000
export const DEFAULT_OVERLAP_PAGES = 1

/**
 * Regroupe les pages d'un document en fenêtres de taille maîtrisée, jamais
 * coupées au milieu d'une page, avec un léger recouvrement entre fenêtres
 * consécutives. Un document qui tient déjà sous le budget produit une
 * fenêtre unique couvrant tout le document (comportement identique à un
 * appel non découpé). Une page seule dépassant déjà le budget est incluse
 * intégralement dans sa propre fenêtre plutôt que d'être tronquée.
 */
export function buildPageWindows(
  text: string,
  opts: BuildPageWindowsOptions = {},
): PageWindow[] {
  const maxChars = opts.maxChars ?? DEFAULT_WINDOW_MAX_CHARS
  const overlapPages = Math.max(0, opts.overlapPages ?? DEFAULT_OVERLAP_PAGES)
  const pages = parsePagedText(text)
  if (pages.length === 0) return []

  const windows: PageWindow[] = []
  let i = 0
  while (i < pages.length) {
    const windowPages: DocumentPage[] = [pages[i]!]
    let used = pages[i]!.text.length
    let j = i + 1
    while (j < pages.length) {
      const next = pages[j]!
      if (used + next.text.length > maxChars) break
      windowPages.push(next)
      used += next.text.length
      j++
    }
    windows.push({
      index: windows.length,
      pages: windowPages.map((p) => p.pageNumber),
      text: renderWindow(windowPages),
    })
    if (j >= pages.length) break
    i = Math.max(i + 1, j - overlapPages)
  }
  return windows
}
