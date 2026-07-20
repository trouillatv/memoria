import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Le code seul : un test de source ne doit pas se heurter aux commentaires,
 *  qui citent souvent l'ancienne forme pour expliquer pourquoi elle a changé. */
const sansCommentaires = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

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
  it('fiche personne : l’action ouvre son ADRESSE CANONIQUE, plus la réunion ni l’onglet Travail', () => {
    // La FORME a changé, pas l’intention. Ce corps CONSTRUISAIT son lien en lisant
    // l'URL courante (`set('action', …)` + paramètres de provenance) : seul des sept
    // à le faire, et `useSearchParams()` y faisait planter la PAGE DIRECTE, qui n’a
    // pas de frontière <Suspense>. Il consomme désormais une adresse absolue.
    expect(fiche).toMatch(/\/sites\/\$\{siteId\}\/action\/\$\{actionId\}/)
    // ⚠️ Sur le CODE seul : les commentaires citent ces parametres pour expliquer
    // POURQUOI ils ont disparu. 4e fois que ce piege se referme dans la session.
    const code = sansCommentaires(fiche)
    expect(code).not.toContain("set('action'")
    expect(code).not.toContain('action_source')
    expect(code).not.toContain('from_person')
    expect(fiche).toContain('actionHref(a.id)')
    // La destination spéciale (a.href = /meetings ou tab=travail) n'est plus le lien.
    expect(fiche).not.toContain('href={a.href}')
  })

  it('recherche : un résultat action ouvre son ADRESSE CANONIQUE', () => {
    // La forme a changé avec la migration des adresses ; l’intention protégée
    // est la même : la recherche ouvre l’action, pas son conteneur.
    expect(search).toContain("h.type === 'site_action'")
    expect(search).toContain('/action/${h.id}')
    // On regarde le CODE, pas les commentaires : ce fichier CITE l’ancien
    // paramètre pour expliquer une limite du terrain mobile.
    const code = sansCommentaires(search)
    expect(code).not.toContain('?action=')
  })

  it('décision : une action référencée ouvre sa fiche (sinon rien d’inventé)', () => {
    expect(decision).toContain('/action/${d.actionId}')
    expect(decision).not.toContain('action_source=')
    // Garde-fou « sinon ne rien inventer » : le lien exige un actionId réel.
    expect(decision).toMatch(/siteId && d\.actionId \?/)
  })
})
