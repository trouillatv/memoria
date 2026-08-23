import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2C surface 5c (meetings) : supprimer / partager passent la frontière ────
//
// deleteMeeting (pattern A) et les distributions d'actions (pattern B) reposaient
// sur l'org du caller. Migrés vers la frontière de la ressource. Deux gestes SANS
// ressource (cleanup en masse, sélecteur de sites) restent classés M3 — annotés,
// pas silencieux.

const racine = process.cwd()
const meetingsActions = readFileSync(join(racine, 'app/(dashboard)/meetings/actions.ts'), 'utf8')
const share = readFileSync(join(racine, 'app/(dashboard)/meetings/[id]/share-actions.ts'), 'utf8')
const mMeeting = readFileSync(join(racine, 'app/(field)/m/meeting-actions.ts'), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('deleteMeeting : frontière du compte-rendu, superviseur', () => {
  it('passe requireSiteReportWriteAccess(reportId, managerOrAdmin)', () => {
    const i = meetingsActions.indexOf('export async function deleteMeetingAction')
    const corps = meetingsActions.slice(i, i + 800)
    expect(corps).toMatch(/requireSiteReportWriteAccess\(reportId, 'managerOrAdmin'\)/)
  })

  it('ne compare plus l’org du caller (pattern A retiré)', () => {
    const i = meetingsActions.indexOf('export async function deleteMeetingAction')
    const corps = strip(meetingsActions.slice(i, i + 900))
    expect(corps).not.toMatch(/getOrgId/)
    expect(corps).not.toMatch(/organization_id !== orgId/)
  })
})

describe('distributions d’actions : frontière du site (pattern B retiré)', () => {
  it('aucun user.organization_id dans le code', () => {
    expect(strip(share)).not.toMatch(/user\.organization_id/)
  })
  it('createDist scope le site confié, revoke résout le site du lot', () => {
    expect(share).toMatch(/requireSiteWriteAccess\(input\.siteId\)/)
    expect(share).toMatch(/requireSiteWriteAccess\(row\.site_id\)/)
  })
})

// Les deux gestes SANS ressource étaient annotés « M3, agrégation à venir ». La
// dette est payée : ils agrègent désormais sur les appartenances actives. Le
// test ne garde plus l'annotation — il garde le comportement.
describe('les gestes SANS ressource agrègent les organisations du compte', () => {
  it('cleanupDraftMeetings : getOrgIdsOfUser + .in, fail-closed (aucune org → rien)', () => {
    const i = meetingsActions.indexOf('export async function cleanupDraftMeetingsAction')
    const corps = meetingsActions.slice(i, i + 900)
    expect(corps).toMatch(/getOrgIdsOfUser\(\)/)
    expect(corps).toMatch(/\.in\('organization_id', orgIds\)/)
    expect(corps).toMatch(/orgIds\.length === 0/)
  })
  it('listMeetingSites : union des appartenances, plus l’organisation par défaut', () => {
    const i = mMeeting.indexOf('export async function listMeetingSitesAction')
    const corps = strip(mMeeting.slice(i, i + 1400))
    expect(corps).toMatch(/getOrgIdsOfUser\(\)/)
    expect(corps).toMatch(/\.in\('organization_id', orgIds\)/)
    expect(corps).not.toMatch(/user\.organization_id/)
  })
})
