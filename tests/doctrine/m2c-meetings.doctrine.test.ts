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

describe('les gestes SANS ressource sont classés M3, pas oubliés', () => {
  it('cleanupDraftMeetings garde getOrgId mais est annoté M3', () => {
    const i = meetingsActions.indexOf('export async function cleanupDraftMeetingsAction')
    const corps = meetingsActions.slice(i, i + 700)
    expect(corps).toMatch(/getOrgId\(\)/)
    expect(corps).toMatch(/M3/)
  })
  it('listMeetingSites reste M3 annoté (agrégation à venir)', () => {
    const i = mMeeting.indexOf('export async function listMeetingSitesAction')
    const entete = mMeeting.slice(Math.max(0, i - 500), i)
    expect(entete).toMatch(/M3/)
  })
})
