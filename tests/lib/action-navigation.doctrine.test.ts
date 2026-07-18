import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── Lot 4 · Slice 4 — toute ouverture d'action converge vers ?action= ────────
// « Il n'existe plus aucun parcours normal où l'utilisateur ouvre une action
// sans passer par la fiche canonique. » Les entrées branchées pointent toutes
// vers `?action=<id>` → le MÊME read model `getSiteActionFiche` → la MÊME fiche,
// quel que soit le point d'entrée (source de vérité de lecture unique).

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
const fiche = read('app/(dashboard)/sites/[id]/views/intervenants/IntervenantFiche.tsx')
const search = read('app/(dashboard)/sites/[id]/SiteMemoryQuery.tsx')
const decision = read('app/(dashboard)/meetings/[id]/pv/validation/PvDecisionsBlock.tsx')

describe('Lot 4 Slice 4 — navigation canonique vers la fiche Action', () => {
  it('fiche personne : l’action ouvre ?action=, plus la réunion ni l’onglet Travail', () => {
    expect(fiche).toMatch(/set\('action'/)
    expect(fiche).toContain('actionHref(a.id)')
    // La destination spéciale (a.href = /meetings ou tab=travail) n'est plus le lien.
    expect(fiche).not.toContain('href={a.href}')
  })

  it('recherche : un résultat action ouvre ?action=', () => {
    expect(search).toContain("h.type === 'site_action'")
    expect(search).toContain('?action=${h.id}')
  })

  it('décision : une action référencée ouvre sa fiche (sinon rien d’inventé)', () => {
    expect(decision).toContain('?action=${d.actionId}')
    expect(decision).toContain('action_source=decision')
    // Garde-fou « sinon ne rien inventer » : le lien exige un actionId réel.
    expect(decision).toMatch(/siteId && d\.actionId \?/)
  })
})
