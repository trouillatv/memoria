// A1 (plan « document = source mémoire ») — garde-fou prompt.
//
// Les agents Atelier DOIVENT être instruits d'exploiter/citer les extraits
// [doc:id] injectés (phase 4b), SANS inventer ni affirmer au-delà, et SANS
// introduire d'architecture (citation inline dans `content`, pas de nouveau
// type de source — hors périmètre A1). Tripwire structurel pur.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

describe('A1 — prompts agents exploitent/citent [doc:id]', () => {
  const frag = read('services/ai/prompts/chat/_sources-instructions.v1.ts')

  it('le fragment partagé instruit d\'exploiter les extraits [doc:id]', () => {
    expect(frag).toMatch(/\[doc:<?id>?\]/)
    expect(frag).toMatch(/Documents \(extraits ciblés/)
    expect(/EXPLOITE|exploite/.test(frag)).toBe(true)
    expect(frag).toContain('/documents/<id>')
  })

  it('interdit d\'inventer un [doc:id] ou d\'affirmer au-delà des extraits', () => {
    expect(/N'?invente JAMAIS un identifiant \[doc/i.test(frag)).toBe(true)
    expect(/n'?affirme JAMAIS.*ne soutiennent pas/i.test(frag)).toBe(true)
  })

  it('rappelle la borne (recall ciblé, pas le document entier)', () => {
    expect(/déjà bornés|ne réclame pas le document entier/i.test(frag)).toBe(true)
  })

  it('A1 n\'introduit AUCUN type de source structuré (zéro archi)', () => {
    const chat = read('services/ai/chat.ts')
    // sourceSchema reste pdf|library|analysis — pas de 'document'.
    expect(chat).toMatch(/type:\s*z\.enum\(\[\s*'pdf',\s*'library',\s*'analysis'\s*\]\)/)
    expect(/'document'/.test(chat.split('sourceSchema')[1]?.slice(0, 200) ?? '')).toBe(false)
  })
})
