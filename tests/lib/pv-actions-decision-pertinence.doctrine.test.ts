import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Plan de visite (Lot A) — retour Vincent : la pertinence terrain doit être
// OBLIGATOIRE à la création d'une décision (jamais legacy_unknown pour du
// neuf), tout en restant un vrai tri-état en édition pour l'historique
// (NULL préservé explicitement, jamais converti silencieusement). `pv-actions.ts`
// a un graphe d'imports trop lourd (@react-pdf/renderer, IA, db) pour un test
// fonctionnel proportionné (cf. tests/lib/action-navigation.doctrine.test.ts) :
// on vérifie donc le CODE réel plutôt que son exécution mockée.

const sansCommentaires = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
const pvActions = read('app/(dashboard)/meetings/[id]/pv-actions.ts')
const block = read('app/(dashboard)/meetings/[id]/pv/validation/PvDecisionsBlock.tsx')

describe('addDecisionAction — pertinence terrain obligatoire à la création', () => {
  it('rejette une création sans pertinence terrain valide, AVANT tout appel à createSiteDecision', () => {
    const fn = pvActions.slice(pvActions.indexOf('export async function addDecisionAction'), pvActions.indexOf('export async function editDecisionAction'))
    expect(fn.length).toBeGreaterThan(0)
    const code = sansCommentaires(fn)
    expect(code).toContain('DECISION_PERTINENCE_TERRAIN')
    expect(code).toMatch(/if \(!input\.pertinenceTerrain \|\| !\(DECISION_PERTINENCE_TERRAIN[\s\S]*?return \{ ok: false/)

    const guardIdx = code.indexOf('DECISION_PERTINENCE_TERRAIN as readonly string[]')
    const createIdx = code.indexOf('await createSiteDecision(')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(createIdx)
  })

  it('DECISION_PERTINENCE_TERRAIN est importé depuis le module canonique site-decisions', () => {
    expect(pvActions).toMatch(/import \{[\s\S]*?DECISION_PERTINENCE_TERRAIN[\s\S]*?\} from '@\/lib\/db\/site-decisions'/)
  })
})

describe('AddDecision (création) — jamais de choix « Non qualifié »', () => {
  it('le bouton de validation est désactivé tant que la pertinence terrain n’est pas choisie', () => {
    const addDecision = block.slice(block.indexOf('function AddDecision'), block.indexOf('export function PvDecisionsBlock'))
    expect(addDecision).toContain('disabled={pending || !titre.trim() || !pertinenceTerrain}')
  })

  it('le sélecteur de création n’offre jamais legacy_unknown / « Non qualifié »', () => {
    // Code seul : le commentaire de doctrine juste au-dessus cite exprès
    // « Non qualifié » pour expliquer pourquoi ce choix est absent ici.
    const addDecision = sansCommentaires(block.slice(block.indexOf('function AddDecision'), block.indexOf('export function PvDecisionsBlock')))
    expect(addDecision).not.toContain('legacy_unknown')
    expect(addDecision).not.toContain('Non qualifié')
  })
})

describe('Row (édition) — tri-état explicite, jamais de conversion silencieuse de NULL', () => {
  const row = block.slice(block.indexOf('function Row('), block.indexOf('function AddDecision'))

  it('l’état par défaut d’une décision historique NULL est le sentinel legacy_unknown, pas une valeur classée', () => {
    expect(row).toContain("useState<DecisionPertinenceTerrain | 'legacy_unknown'>(d.pertinenceTerrain ?? 'legacy_unknown')")
  })

  it('la sauvegarde ne réécrit NULL que si l’utilisateur a explicitement choisi legacy_unknown', () => {
    expect(row).toContain("pertinenceTerrain === 'legacy_unknown' ? null : pertinenceTerrain")
  })

  it('le sélecteur d’édition propose explicitement les 3 états, y compris « Non qualifié — uniquement pour l’historique »', () => {
    expect(row).toContain('DECISION_PERTINENCE_TERRAIN.map')
    expect(row).toContain('value="legacy_unknown"')
    expect(row).toContain("Non qualifié")
  })

  it('annuler l’édition restaure le sentinel legacy_unknown pour une décision historique NULL, pas une chaîne vide', () => {
    expect(row).toContain("setPertinenceTerrain(d.pertinenceTerrain ?? 'legacy_unknown')")
  })
})
