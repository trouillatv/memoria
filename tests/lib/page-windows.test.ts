import { describe, it, expect } from 'vitest'
import { parsePagedText, buildPageWindows } from '@/lib/documents/page-windows'

// P0-2B FIX_REQUIRED point 1/2 — module pur, aucun mock nécessaire.

describe('parsePagedText', () => {
  it('texte sans aucun marqueur [[page N]] → traité défensivement comme une page unique', () => {
    const pages = parsePagedText('Un texte sans marqueur du tout.')
    expect(pages).toEqual([{ pageNumber: 1, text: 'Un texte sans marqueur du tout.' }])
  })

  it('texte vide → aucune page', () => {
    expect(parsePagedText('')).toEqual([])
    expect(parsePagedText('   \n  ')).toEqual([])
  })

  it('plusieurs marqueurs → une page par marqueur, texte découpé correctement', () => {
    const pages = parsePagedText('[[page 1]]Alpha[[page 2]]Beta[[page 3]]Gamma')
    expect(pages).toEqual([
      { pageNumber: 1, text: 'Alpha' },
      { pageNumber: 2, text: 'Beta' },
      { pageNumber: 3, text: 'Gamma' },
    ])
  })
})

function page(n: number, text: string) {
  return `[[page ${n}]]${text}`
}

describe('buildPageWindows', () => {
  it('document sous le budget → une fenêtre unique couvrant tout le document (comportement inchangé pour les documents courts)', () => {
    const text = [page(1, 'Préambule.'), page(2, 'Clause A.'), page(3, 'Clause B.')].join('')
    const windows = buildPageWindows(text)
    expect(windows).toHaveLength(1)
    expect(windows[0]!.pages).toEqual([1, 2, 3])
    expect(windows[0]!.text).toBe(text)
  })

  it('texte vide → aucune fenêtre', () => {
    expect(buildPageWindows('')).toEqual([])
  })

  it('ne coupe jamais une page au milieu : chaque page apparaît intégralement dans au moins une fenêtre', () => {
    const bigA = 'A'.repeat(15_000)
    const bigB = 'B'.repeat(15_000)
    const bigC = 'C'.repeat(15_000)
    const bigD = 'D'.repeat(15_000)
    const text = [page(1, bigA), page(2, bigB), page(3, bigC), page(4, bigD)].join('')
    const windows = buildPageWindows(text, { maxChars: 40_000, overlapPages: 1 })
    expect(windows.length).toBeGreaterThan(1)
    for (const w of windows) {
      for (const p of w.pages) {
        const marker = `[[page ${p}]]`
        expect(w.text.includes(marker)).toBe(true)
      }
    }
  })

  it('la première page apparaît dans la première fenêtre, la dernière page dans la dernière fenêtre', () => {
    const big = 'X'.repeat(15_000)
    const text = [page(1, big), page(2, big), page(3, big), page(4, big)].join('')
    const windows = buildPageWindows(text, { maxChars: 40_000, overlapPages: 1 })
    expect(windows[0]!.pages).toContain(1)
    expect(windows[windows.length - 1]!.pages).toContain(4)
  })

  it('fenêtres consécutives partagent la page de recouvrement (overlapPages=1)', () => {
    const big = 'Y'.repeat(15_000)
    const text = [page(1, big), page(2, big), page(3, big), page(4, big)].join('')
    const windows = buildPageWindows(text, { maxChars: 40_000, overlapPages: 1 })
    expect(windows.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < windows.length; i++) {
      const prevPages = windows[i - 1]!.pages
      const currPages = windows[i]!.pages
      const shared = currPages.filter((p) => prevPages.includes(p))
      expect(shared.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('overlapPages=0 → fenêtres consécutives sans aucune page commune', () => {
    const big = 'Z'.repeat(15_000)
    const text = [page(1, big), page(2, big), page(3, big), page(4, big)].join('')
    const windows = buildPageWindows(text, { maxChars: 40_000, overlapPages: 0 })
    expect(windows.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < windows.length; i++) {
      const prevPages = windows[i - 1]!.pages
      const currPages = windows[i]!.pages
      const shared = currPages.filter((p) => prevPages.includes(p))
      expect(shared).toHaveLength(0)
    }
  })

  it('clause à cheval sur une frontière de fenêtre reste lisible intégralement dans au moins une fenêtre (via le recouvrement)', () => {
    // Page 2 se termine par le début d'une clause, page 3 la termine — le
    // recouvrement garantit que la fenêtre contenant la page 3 contient AUSSI
    // la page 2, donc la clause complète apparaît d'un seul tenant quelque part.
    const big = 'W'.repeat(15_000)
    const straddlingClause = 'Le prestataire garantit un délai de reprise de 4 heures ouvrées.'
    const text = [
      page(1, big),
      page(2, big + straddlingClause.slice(0, 30)),
      page(3, straddlingClause.slice(30)),
      page(4, big),
    ].join('')
    const windows = buildPageWindows(text, { maxChars: 40_000, overlapPages: 1 })
    const fullClauseWindow = windows.find((w) => w.text.replace(/\[\[page \d+\]\]/g, '').includes(straddlingClause))
    expect(fullClauseWindow).toBeDefined()
  })

  it('une page seule dépassant déjà le budget est incluse intégralement dans sa propre fenêtre, sans boucle infinie', () => {
    const oversized = 'V'.repeat(100_000)
    const text = [page(1, 'petit'), page(2, oversized), page(3, 'petit aussi')].join('')
    const windows = buildPageWindows(text, { maxChars: 40_000, overlapPages: 1 })
    const oversizedWindow = windows.find((w) => w.pages.includes(2))
    expect(oversizedWindow).toBeDefined()
    expect(oversizedWindow!.text.includes(oversized)).toBe(true)
    // Toutes les pages du document sont couvertes exactement une fois au minimum.
    const allPages = new Set(windows.flatMap((w) => w.pages))
    expect(allPages).toEqual(new Set([1, 2, 3]))
  })
})
