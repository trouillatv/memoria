// Tests purs sur lib/ui/render-fragment.tsx — rendu des fragments IA
// avec hyperliens vers /documents/<id> et stripping des trace IDs.

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { renderFragmentWithLinks } from '@/lib/ui/render-fragment'

// next/link → simple <a> dans le test (pas de prefetch DOM)
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const UUID_A = 'c476587c-2aa5-4b4f-b349-6dba53d7797a'
const UUID_B = 'a85e9bea-eb70-4efe-bb3c-a06d4590107b'
const UUID_C = '2e503272-df6c-401f-af62-df7fb556619d'

function renderToHtml(input: string): string {
  const parts = renderFragmentWithLinks(input)
  const { container } = render(<p>{parts}</p>)
  return container.innerHTML
}

describe('renderFragmentWithLinks — [doc:UUID] → lien', () => {
  it('un [doc:UUID] devient une <a href="/documents/UUID">', () => {
    const html = renderToHtml(`La procédure rattachée [doc:${UUID_A}] mentionne X.`)
    expect(html).toContain(`href="/documents/${UUID_A}"`)
    // Le token brut n'apparaît plus
    expect(html).not.toContain(`[doc:${UUID_A}]`)
  })

  it('deux [doc:UUID] dans le même fragment → deux liens distincts', () => {
    const html = renderToHtml(`Voir [doc:${UUID_A}] et aussi [doc:${UUID_B}].`)
    expect(html).toContain(`/documents/${UUID_A}`)
    expect(html).toContain(`/documents/${UUID_B}`)
  })

  it('texte sans [doc:] inchangé', () => {
    const html = renderToHtml('Simple texte sans ref.')
    expect(html).toContain('Simple texte sans ref.')
    expect(html).not.toContain('<a')
  })

  it('aria-label et title présents (a11y + tooltip) — sans filename', () => {
    const html = renderToHtml(`X [doc:${UUID_A}] Y.`)
    expect(html).toContain(`aria-label="Ouvrir le document ${UUID_A.slice(0, 8)}"`)
  })

  it('sans docNames → fallback « ↗ »', () => {
    const html = renderToHtml(`X [doc:${UUID_A}] Y.`)
    expect(html).toContain('↗')
  })
})

describe('renderFragmentWithLinks — docNames option', () => {
  function renderWithNames(input: string, names: Record<string, string>): string {
    const parts = renderFragmentWithLinks(input, { docNames: names })
    const { container } = render(<p>{parts}</p>)
    return container.innerHTML
  }

  it('docNames[UUID] présent → filename affiché à la place de ↗', () => {
    const html = renderWithNames(
      `Procédure [doc:${UUID_A}] mentionne X.`,
      { [UUID_A]: '4-cctp-nettoyage-medipole.pdf' },
    )
    expect(html).toContain('4-cctp-nettoyage-medipole.pdf')
    expect(html).not.toContain('↗')
    expect(html).toContain(`href="/documents/${UUID_A}"`)
  })

  it('aria-label adapté au filename quand fourni', () => {
    const html = renderWithNames(
      `X [doc:${UUID_A}] Y.`,
      { [UUID_A]: 'protocole-secu.pdf' },
    )
    expect(html).toContain(`aria-label="Ouvrir « protocole-secu.pdf »"`)
  })

  it('mix : un doc nommé + un doc sans nom dans le même fragment', () => {
    const html = renderWithNames(
      `Voir [doc:${UUID_A}] et [doc:${UUID_B}].`,
      { [UUID_A]: 'connu.pdf' },
    )
    expect(html).toContain('connu.pdf')
    expect(html).toContain('↗') // fallback pour UUID_B
  })

  it('filename avec caractères spéciaux : échappé dans le body, pas d\'XSS', () => {
    const parts = renderFragmentWithLinks(`X [doc:${UUID_A}] Y.`, {
      docNames: { [UUID_A]: '<script>alert(1)</script>.pdf' },
    })
    const { container } = render(<p>{parts}</p>)
    // 1. Aucun élément <script> n'a été créé dans le DOM (vrai test XSS).
    expect(container.querySelectorAll('script').length).toBe(0)
    // 2. Le texte du lien encode bien < et > pour l'affichage utilisateur.
    const link = container.querySelector('a')
    expect(link?.textContent).toContain('<script>')  // textContent décode pour la comparaison
    // 3. innerHTML du <a> a bien < encodé en &lt; (pas d'élément réel)
    expect(link?.innerHTML).toContain('&lt;script&gt;')
  })

  it('docNames vide → identique à pas de docNames', () => {
    const html = renderWithNames(`X [doc:${UUID_A}] Y.`, {})
    expect(html).toContain('↗')
  })
})

describe('renderFragmentWithLinks — [trace:UUID] → strippé', () => {
  it('[trace:UUID] est retiré du texte visible', () => {
    const html = renderToHtml(`Doc [doc:${UUID_A}] résonne avec [trace:${UUID_C}].`)
    expect(html).not.toContain('[trace:')
    expect(html).not.toContain(UUID_C)
  })

  it('le [trace:UUID] est strippé même quand aucun [doc:] présent', () => {
    const html = renderToHtml(`Trace seule [trace:${UUID_C}] sans contexte.`)
    expect(html).not.toContain(UUID_C)
    expect(html).not.toContain('[trace:')
  })

  it('strip trace + lien doc cohabitent', () => {
    const html = renderToHtml(`Procédure [doc:${UUID_A}] avec trace [trace:${UUID_C}] proche.`)
    expect(html).toContain(`/documents/${UUID_A}`)
    expect(html).not.toContain(UUID_C)
  })
})

describe('renderFragmentWithLinks — robustesse', () => {
  it('UUID malformé (trop court) → laissé en texte brut, pas linké', () => {
    const html = renderToHtml('Faux ref [doc:short] dans le texte.')
    // [doc:short] = 5 chars, < 8 → ne matche pas la regex {8,}
    expect(html).not.toContain('<a')
    expect(html).toContain('[doc:short]')
  })

  it('caractères hors UUID dans le token → pas matché', () => {
    const html = renderToHtml('Invalid [doc:not-a-real!!uuid] here.')
    expect(html).not.toContain('<a')
  })

  it('aucun XSS possible — le texte brut est échappé par React', () => {
    const html = renderToHtml(`<script>alert(1)</script> [doc:${UUID_A}]`)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('fragment B1 réel reproduit le rendu attendu', () => {
    const fragment = `La procédure rattachée [doc:${UUID_A}] mentionne « nettoyage locaux » — une note terrain du 20 mai cite ce terme.`
    const html = renderToHtml(fragment)
    expect(html).toContain('La procédure rattachée')
    expect(html).toContain(`/documents/${UUID_A}`)
    expect(html).toContain('« nettoyage locaux »')
    expect(html).toContain('cite ce terme')
  })

  it('fragment B2 réel : [doc] linké, [trace] strippé, ponctuation propre', () => {
    const fragment = `La procédure rattachée à ce site [doc:${UUID_A}] semble en écho avec la note terrain du 20 mai [trace:${UUID_C}].`
    const html = renderToHtml(fragment)
    expect(html).toContain(`/documents/${UUID_A}`)
    expect(html).not.toContain(UUID_C)
    // Pas de double-espace orphelin avant le point (cleanup '\s+\.')
    expect(html).not.toContain('  .')
  })
})
