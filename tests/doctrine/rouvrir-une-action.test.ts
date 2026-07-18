import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UNE CLÔTURE N'EST PAS UNE PREUVE : C'EST UNE DÉCLARATION.
 *
 * L'anomalie se rouvre (`reopenAnomalyAction`). L'intervention se rouvre
 * (`reopenInterventionAction`). Le dossier de preuve se rouvre
 * (`reopenDossierAction`).
 *
 * L'action, non. Un clic sur « Terminé » était DÉFINITIF, et il n'existait aucun
 * recours : une clôture par mégarde effaçait le suivi d'un engagement, sans retour.
 *
 * Une déclaration peut être fausse — donc elle se défait. Ce qu'on ne défait PAS,
 * c'est ce qui a été DIT à la clôture (le commentaire, la photo) : la trace reste,
 * même rouverte. On ne réécrit pas ce qui a été déclaré.
 *
 * Slice 6A : le geste passe désormais par la RPC transactionnelle fn_reopen_action
 * (migration 221). L'état courant repasse open/done_at=null, mais l'événement
 * `completed` reste dans le journal append-only : la clôture passée n'est plus
 * détruite, elle est CONSERVÉE et contredite par un événement `reopened`.
 */

const ACTIONS = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'actions', 'actions.ts'),
  'utf8',
)
const MIG = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '221_site_action_events.sql'),
  'utf8',
)
const LIST = readFileSync(
  join(process.cwd(), 'components', 'actions', 'OpenActionsList.tsx'),
  'utf8',
)

function reopenBody(): string {
  const start = ACTIONS.indexOf('export async function reopenActionAction')
  expect(start, 'reopenActionAction introuvable').toBeGreaterThan(-1)
  const next = ACTIONS.indexOf('export async function', start + 10)
  return ACTIONS.slice(start, next === -1 ? undefined : next)
}

describe('Rouvrir une action', () => {
  const body = reopenBody()

  it('existe — via la RPC transactionnelle fn_reopen_action', () => {
    expect(body).toContain("rpc('fn_reopen_action'")
  })

  it('ne rouvre QUE ce qui est terminé (garde dans la fonction atomique)', () => {
    // Sans ce filtre, on « rouvrirait » une action annulée ou déjà ouverte.
    expect(MIG).toMatch(/if v\.status <> 'done' then return/)
  })

  it('efface la DATE de clôture — devenue fausse — dans la même transaction', () => {
    expect(MIG).toMatch(/status='open', done_at=null/)
  })

  it('CONSERVE désormais l’histoire : un événement reopened, le completed reste', () => {
    // La réouverture journalise `reopened` ; l'événement `completed` antérieur reste
    // dans le journal append-only → la clôture passée n'est plus détruite.
    expect(MIG).toContain("'reopened'")
    expect(MIG).toContain('append-only')
  })

  it('ne réécrit PAS ce qui a été déclaré à la clôture (commentaire, photo)', () => {
    // completed_comment et completed_photo_path sont des traces : ce qui a été dit
    // a été dit. On ne réécrit pas une déclaration, on la contredit.
    expect(body).not.toContain('completed_comment')
    expect(body).not.toContain('completed_photo_path')
  })
})

describe("L'écran des actions", () => {
  it('propose de rouvrir une action terminée, au lieu de la clôturer encore', () => {
    expect(LIST).toContain('reopenActionAction')
    expect(LIST).toMatch(/a\.status === 'done'/)
    expect(LIST).toMatch(/Rouvrir/)
  })
})
