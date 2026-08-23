import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// M3 mobile — un compte peut appartenir à plusieurs entreprises. Deux moitiés
// d'un même invariant, et elles ne se remplacent pas :
//
//   LECTURE  : /m montre les chantiers de TOUTES les organisations du compte
//              (union des appartenances), pas ceux de l'organisation par défaut.
//   ÉCRITURE : un chantier créé à la volée appartient à l'organisation DÉSIGNÉE.
//              Le droit de créer n'est pas restreint par le multi-org ; c'est
//              seulement la cible qui doit être connue avant d'écrire.
//
// `users.organization_id` n'est plus une autorité métier : s'en servir en repli
// rattache un chantier Becib à AGP sans erreur, sans trace, et invisible jusqu'à
// l'audit. Ces tests sont là pour que ce repli ne revienne pas par accident.

const racine = process.cwd()
const read = (p: string) => readFileSync(join(racine, p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('LECTURE — les surfaces /m agrègent les organisations du compte', () => {
  const cases: Array<[string, string]> = [
    // La source UNIQUE des listes de chantiers de Visite, Réunion, Intervention
    // ET du partage WhatsApp. Un seul défaut y produisait quatre symptômes.
    ['app/(field)/m/meeting-actions.ts', 'listMeetingSitesAction'],
    ['app/(field)/m/chantiers/page.tsx', 'page /m/chantiers'],
  ]
  for (const [p, quoi] of cases) {
    it(`${quoi} : getOrgIdsOfUser + .in('organization_id', …), plus d’org par défaut`, () => {
      const code = strip(read(p))
      expect(code).toMatch(/getOrgIdsOfUser\(\)/)
      expect(code).toMatch(/\.in\('organization_id', orgIds\)/)
      expect(code).not.toMatch(/\.eq\('organization_id', user\.organization_id\)/)
    })
  }

  it('/m : les lectures atteignables (appels d’offres, chantiers de réunion) filtrent sur l’union', () => {
    const code = strip(read('app/(field)/m/page.tsx'))
    expect(code).toMatch(/getOrgIdsOfUser\(\)/)
    expect(code).toMatch(/readOrgIds/)
  })
})

describe('ÉCRITURE — une seule décision, partagée par les trois parcours', () => {
  const parcours: Array<[string, string]> = [
    ['app/(field)/m/quick-site-actions.ts', 'Visite et Réunion'],
    ['app/(field)/m/partage/share-actions.ts', 'partage WhatsApp'],
  ]
  for (const [p, quoi] of parcours) {
    it(`${quoi} : passe par resolveCreationOrgId, et ne lit plus users.organization_id`, () => {
      const code = strip(read(p))
      expect(code).toMatch(/resolveCreationOrgId\(/)
      expect(code).not.toMatch(/user\.organization_id/)
      expect(code).not.toMatch(/profile\.organization_id/)
    })
  }

  it('aucun parcours de création ne choisit « la première appartenance »', () => {
    for (const [p] of parcours) {
      const code = strip(read(p))
      expect(code, p).not.toMatch(/orgIds\[0\]/)
      expect(code, p).not.toMatch(/getOrgIdsOfUser\(\)/)
    }
  })

  it('createSite() garde son propre garde d’appartenance — le helper ne le remplace pas', () => {
    const code = read('lib/db/sites.ts')
    const i = code.indexOf('export async function createSite')
    expect(code.slice(i, i + 1600)).toMatch(/requireOrganizationMembership\(orgId\)/)
  })

  it('le lot du sas n’est pas retouché par la création (rien n’est reperdu)', () => {
    const code = read('app/(field)/m/partage/share-actions.ts')
    const i = code.indexOf('export async function createSiteFromShareAction')
    const corps = code.slice(i, i + 1800)
    expect(corps).not.toMatch(/discardShare|\.delete\(\)|shared_batches?.*update/i)
  })
})

describe('UI — la question « Société » n’est posée que si elle se pose', () => {
  it('le champ n’existe pas en mono-organisation, et ne pré-sélectionne jamais', () => {
    const code = read('app/(field)/m/OrgChoiceField.tsx')
    expect(code).toMatch(/if \(!choice\.needsChoice\) return null/)
    // Le placeholder est désactivé : c'est l'absence de réponse, pas une option.
    expect(code).toMatch(/<option value="" disabled>/)
    expect(strip(code)).not.toMatch(/setOrgId\(list\[0\]\.id\)[\s\S]{0,40}length > 1/)
  })

  it('les trois formulaires de création envoient l’organisation et bloquent tant qu’elle manque', () => {
    for (const p of [
      'app/(field)/m/VisitLauncherHome.tsx',
      'app/(field)/m/MeetingLauncher.tsx',
      'app/(field)/m/partage/SharePicker.tsx',
    ]) {
      const code = strip(read(p))
      expect(code, p).toMatch(/useOrgChoice\(/)
      expect(code, p).toMatch(/organizationId: orgChoice\.orgId \?\? undefined/)
      expect(code, p).toMatch(/!orgChoice\.ready/)
    }
  })

  it('le sélecteur est un confort : il ne sert jamais d’autorisation', () => {
    const code = read('app/(field)/m/org-options-actions.ts')
    expect(code).toMatch(/requireFieldAgent\(\)/)
    expect(code).toMatch(/getOrgIdsOfUser\(\)/)
    // Aucune écriture ne part d'ici — c'est une liste, pas une décision.
    expect(strip(code)).not.toMatch(/createSite|insert\(/)
  })
})
