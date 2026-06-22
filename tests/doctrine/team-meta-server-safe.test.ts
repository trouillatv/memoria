// Garde-fou — frontière server/client des constantes d'équipe (bug 2026-06-23).
//
// Symptôme : créer/éditer une équipe avec une ICÔNE plantait l'app
// (« Server Components render » → écran « Quelque chose s'est passé »), alors
// que la COULEUR fonctionnait. Cause : le code SERVEUR (action de validation +
// TeamBadge rendu côté serveur) importait TEAM_ICON_KEYS / TEAM_ICONS depuis
// team-icon-picker.tsx (`'use client'`). Côté serveur, ces imports deviennent
// des références client opaques → `.includes(...)` / le rendu jettent.
//
// La couleur marchait car ses constantes vivent dans team-badge.tsx (PAS
// 'use client'). Correctif : constantes server-safe dans team-meta.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')
// 1re ligne SIGNIFICATIVE (hors commentaires) — pour viser la directive 'use client'.
const firstCode = (src: string) =>
  src
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*')) ?? ''

describe('Doctrine — constantes d’équipe server-safe', () => {
  it('team-meta.ts n’est PAS un module client', () => {
    expect(firstCode(read('components/ui/team-meta.ts'))).not.toMatch(/use client/)
  })

  it('l’action serveur importe icônes & max spécialités depuis team-meta', () => {
    const src = read('app/(dashboard)/equipes/actions.ts')
    expect(src).toMatch(/from '@\/components\/ui\/team-meta'/)
    // Et JAMAIS depuis les modules 'use client'.
    expect(src).not.toMatch(/TEAM_ICON_KEYS\s*}?\s*from '@\/components\/ui\/team-icon-picker'/)
    expect(src).not.toMatch(/from '@\/components\/ui\/team-specialties'/)
  })

  it('TeamBadge (rendu serveur) importe TEAM_ICONS depuis team-meta', () => {
    const src = read('components/ui/team-badge.tsx')
    expect(src).toMatch(/from '\.\/team-meta'/)
    expect(src).not.toMatch(/TEAM_ICONS[\s\S]*from '\.\/team-icon-picker'/)
  })
})
