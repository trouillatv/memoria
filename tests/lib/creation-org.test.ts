import { beforeEach, describe, expect, it, vi } from 'vitest'

// `resolveCreationOrgId` répond à UNE question : quelle organisation possède la
// donnée qu'on s'apprête à créer ? Les sentinelles ci-dessous protègent les deux
// interdits qui justifient l'existence du fichier — jamais `users.organization_id`
// en repli, jamais « la première appartenance » quand il y en a plusieurs.

let orgIds: string[] = []
vi.mock('@/lib/auth/memberships', () => ({
  getOrgIdsOfUser: async () => orgIds,
}))

const { resolveCreationOrgId, AUCUNE_ORGANISATION, ORGANISATION_REQUISE } = await import(
  '@/lib/auth/creation-org'
)

const BECIB = '11111111-1111-1111-1111-111111111111'
const SERVINORD = '22222222-2222-2222-2222-222222222222'
const AGP = '33333333-3333-3333-3333-333333333333'

beforeEach(() => {
  orgIds = []
})

describe('mono-organisation : aucune question posée', () => {
  it('l’unique appartenance est retenue automatiquement', async () => {
    orgIds = [BECIB]
    expect(await resolveCreationOrgId()).toEqual({ ok: true, organizationId: BECIB })
  })
})

describe('multi-organisation : le droit de créer reste entier, seule la cible doit être connue', () => {
  it('Becib demandé → Becib (et pas la première de la liste)', async () => {
    orgIds = [AGP, BECIB, SERVINORD]
    expect(await resolveCreationOrgId(BECIB)).toEqual({ ok: true, organizationId: BECIB })
  })

  it('SERVINORD demandé → SERVINORD', async () => {
    orgIds = [AGP, BECIB, SERVINORD]
    expect(await resolveCreationOrgId(SERVINORD)).toEqual({ ok: true, organizationId: SERVINORD })
  })

  it('aucune organisation fournie → refus explicite, JAMAIS orgIds[0]', async () => {
    orgIds = [AGP, BECIB]
    const r = await resolveCreationOrgId()
    expect(r).toEqual({ ok: false, reason: 'ambiguous', error: ORGANISATION_REQUISE })
  })

  it('chaîne vide fournie (placeholder du sélecteur) = pas de réponse, pas un choix', async () => {
    orgIds = [AGP, BECIB]
    const r = await resolveCreationOrgId('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('ambiguous')
  })
})

describe('une organisation hors appartenances est refusée', () => {
  it('multi-org : org inconnue → refus serveur', async () => {
    orgIds = [AGP, BECIB]
    const r = await resolveCreationOrgId(SERVINORD)
    expect(r).toEqual({ ok: false, reason: 'forbidden', error: ORGANISATION_REQUISE })
  })

  it('mono-org : une valeur fournie qui ne correspond pas est refusée, pas ignorée', async () => {
    orgIds = [BECIB]
    const r = await resolveCreationOrgId(AGP)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('forbidden')
  })

  it('le texte rendu est le MÊME que « non choisie » — on n’énumère pas les orgs d’un tiers', async () => {
    orgIds = [AGP, BECIB]
    const absente = await resolveCreationOrgId(SERVINORD)
    const aucune = await resolveCreationOrgId()
    expect(absente.ok || aucune.ok).toBe(false)
    if (!absente.ok && !aucune.ok) expect(absente.error).toBe(aucune.error)
  })
})

describe('aucune appartenance active', () => {
  it('refus « none » — le compte ne crée nulle part', async () => {
    orgIds = []
    expect(await resolveCreationOrgId()).toEqual({
      ok: false,
      reason: 'none',
      error: AUCUNE_ORGANISATION,
    })
  })

  it('fournir une organisation ne contourne pas l’absence d’appartenance', async () => {
    orgIds = []
    const r = await resolveCreationOrgId(BECIB)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('none')
  })
})
