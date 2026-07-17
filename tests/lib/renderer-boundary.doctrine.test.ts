import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── LA FRONTIÈRE ENTRE PROJECTION ET PRÉSENTATION ────────────────────────────
// « Aucun renderer ne doit connaître l'origine d'une donnée. » (Vincent, 2026-07-17)
//
// Un composant ne doit jamais pouvoir répondre à « est-ce que cette ligne vient
// d'une proposition, d'une action ou d'un ledger ? ». Il reçoit un SummaryItem.
//
// Ce test verrouille l'état atteint AVANT le moteur de rapprochement. Sans lui,
// le moteur devrait déboguer en même temps l'extraction, le scoring, la
// persistance, l'affichage, et deux sources concurrentes dans l'UI.
//
// Ce qu'on a payé pour l'apprendre : le PDF affichait « Décisions » depuis le
// JSON figé pendant que l'écran d'à côté affichait les vraies site_decisions —
// même titre, deux objets, et écarter une proposition ne changeait pas le
// document qui partait chez le client.

const RENDERERS = [
  'app/(field)/m/visite/[reportId]/cr/MemoriaRetained.tsx',
  'lib/pdf/visit-cr.tsx',
]

/** Le CODE seul : un commentaire qui explique la faute d'origine ne doit pas
 *  faire échouer le test qui l'interdit. */
function codeOf(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe("Les renderers ignorent d'où vient la donnée", () => {
  it.each(RENDERERS)('%s ne connaît pas le grand livre', (rel) => {
    const src = codeOf(rel)
    expect(src, 'action_ledger est un artefact de transition : il ne franchit pas la frontière')
      .not.toContain('action_ledger')
    expect(src, 'les états de promotion sont portés par le contrat, pas relus à côté')
      .not.toMatch(/deadlineStates|propStates|getActionProposalStatesAction|getDeadlineProposalStatesAction/)
  })

  it.each(RENDERERS)('%s ne lit jamais le stockage brut', (rel) => {
    const src = codeOf(rel)
    expect(src, 'un renderer ne parle pas à la base').not.toMatch(/createAdminClient|\.from\(['"]/)
    expect(src, 'les propositions brutes appartiennent au read model')
      .not.toContain('site_knowledge_proposals')
  })

  it.each(RENDERERS)('%s ne recalcule aucun état métier', (rel) => {
    const src = codeOf(rel)
    // « Nouveau » est une DÉCISION métier : aujourd'hui lexicale (version), demain
    // issue du rapprochement. Si un composant la recalcule, le jour où la
    // définition change, il mentira tout seul.
    expect(src, 'isNewInVersion se reçoit, il ne se calcule pas ici')
      .not.toMatch(/analysis_version|analysisVersion\s*===|version_added/)
    // Le geste métier vient de getPromotionCapability. Un libellé codé en dur
    // dans le JSX finit par diverger de ce que la promotion fait vraiment — le
    // bouton disait « Confirmer l'action » alors que la capability dit « Créer
    // l'action ». On cherche le LIBELLÉ où qu'il soit : en JSX le caractère qui
    // précède est souvent `}`, pas un guillemet.
    for (const verbe of ["Créer l’action", "Créer l'action", "Confirmer l’action", "Confirmer l'action", "Ajouter au planning"]) {
      expect(src, `« ${verbe} » est un verbe métier : il vient de capability.label, jamais du JSX`)
        .not.toContain(verbe)
    }
  })

  it("le CR mobile ne reformate pas une échéance lui-même", () => {
    // « sous dix jours » n'est pas le 27 juillet. La mise en forme vit UNE fois,
    // dans le contrat — sinon deux surfaces traduisent la même contrainte
    // différemment.
    const src = codeOf(RENDERERS[0])
    expect(src).not.toMatch(/echeanceLine|echeanceDateLabel|toDebriefEcheance/)
  })
})

// ── LE CONCEPT SUPPRIMÉ ──────────────────────────────────────────────────────
// « Action faite sans avoir jamais existé » : un travail réel, absent de Travail,
// du chantier, de l'historique et du PDF. Supprimé — zéro donnée en base, aucun
// appelant. Le cycle est unique : proposition → confirmée → action → terminée.
describe("Une action faite ne peut plus exister sans avoir été créée", () => {
  it("l'état 'done' n'existe plus dans le grand livre", () => {
    const src = codeOf('lib/visits/debrief-analysis.ts')
    expect(src).toContain("export type ActionState = 'open' | 'dismissed'")
    expect(src, 'setActionState portait la seule écriture de cet état').not.toContain('export async function setActionState')
  })

  it('aucune surface ne peut plus marquer une action faite hors du cycle', () => {
    const src = codeOf('app/(field)/m/visite/[reportId]/debrief-actions.ts')
    expect(src).not.toContain('setVisitActionStateAction')
  })
})
