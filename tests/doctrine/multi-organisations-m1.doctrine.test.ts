import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M1 : UN COMPTE, PLUSIEURS ENTREPRISES ──────────────────────────────────
//
// AGP et SERVINOR sont deux entités juridiques distinctes. Guillaume travaille
// pour les deux avec un seul compte. Ce fichier protège les invariants de
// SÉCURITÉ du socle — ceux qu'une relecture distraite peut défaire sans que
// rien ne casse visiblement.
//
// Les comportements (deux appartenances, doublon refusé, rôles distincts) sont
// prouvés contre la base réelle ; ils dépendent de contraintes SQL que ces
// tests unitaires ne peuvent pas exercer. Ici on garde ce qui vit dans le CODE.

const racine = process.cwd()
const memberships = readFileSync(join(racine, 'lib/auth/memberships.ts'), 'utf8')
const users = readFileSync(join(racine, 'lib/db/users.ts'), 'utf8')
const organisations = readFileSync(join(racine, 'lib/db/organisations.ts'), 'utf8')
const migration = readFileSync(join(racine, 'supabase/migrations/233_organization_memberships.sql'), 'utf8')

describe('l’invariant fondamental : jamais choisir une organisation à la place de l’humain', () => {
  it('getOrgId LÈVE quand le compte appartient à plusieurs entreprises', () => {
    // Rendre l'organisation « par défaut » ferait écrire dans AGP une donnée
    // saisie pour SERVINOR — sans erreur, sans trace, invisible jusqu'à l'audit.
    expect(users).toMatch(/orgIds\.length > 1.*throw new OrganisationAmbigueError/s)
  })

  it('et cette erreur n’est JAMAIS avalée par un catch', () => {
    // Le piège : la version précédente enveloppait toute la fonction dans un
    // `catch { return null }`. Or de nombreuses gardes s'écrivent
    // `if (orgId && objet.organization_id !== orgId) notFound()` — un `null` y
    // DÉSACTIVE le contrôle. L'ambiguïté serait devenue une faille.
    const corps = users.slice(users.indexOf('export async function getOrgId'))
    const fin = corps.indexOf('async function activeOrgIdsOf')
    const getOrgId = corps.slice(0, fin > 0 ? fin : 2000)
    // Le seul catch autorisé entoure la lecture de session, avant tout calcul
    // d'appartenance.
    expect(getOrgId).toMatch(/catch \{[\s\S]{0,220}return null/)
    expect(getOrgId.indexOf('throw new OrganisationAmbigueError'))
      .toBeGreaterThan(getOrgId.indexOf('catch {'))
  })

  it('aucune primitive ne prend « la première organisation trouvée »', () => {
    for (const src of [memberships, users]) {
      expect(src).not.toMatch(/\.limit\(1\)[\s\S]{0,120}organization_memberships/)
      expect(src).not.toMatch(/organization_memberships[\s\S]{0,200}\.limit\(1\)/)
    }
  })
})

describe('les primitives d’accès sont fail-closed', () => {
  it('une lecture d’appartenance en échec ne donne AUCUN accès', () => {
    // « Je n'ai pas pu vérifier » doit valoir « refusé », jamais « autorisé ».
    expect(memberships).toMatch(/if \(error \|\| !data\) return \[\]/)
    expect(memberships).toMatch(/if \(error \|\| !data\) return \{ ok: false, error: ACCES_REFUSE \}/)
  })

  it('seules les appartenances ACTIVES donnent accès', () => {
    const actifs = memberships.match(/\.eq\('status', 'active'\)/g) ?? []
    expect(actifs.length).toBeGreaterThanOrEqual(2)
  })

  it('le refus est UNIFORME — il ne dit pas si l’organisation existe', () => {
    // Trois messages distincts (« inconnue », « pas membre », « suspendu »)
    // permettraient d'énumérer les organisations d'un concurrent.
    expect(memberships).toContain("export const ACCES_REFUSE = 'Accès refusé'")
    const refus = memberships.match(/error: ACCES_REFUSE/g) ?? []
    expect(refus.length).toBeGreaterThanOrEqual(3)
  })

  it('le rôle vérifié est celui de l’ORGANISATION, pas celui du profil', () => {
    // `users.role` ne veut plus rien dire dès qu'on appartient à deux
    // entreprises : « administrateur » n'existe pas hors d'une organisation.
    expect(memberships).toMatch(/requireOrganizationRole[\s\S]{0,400}allowedRoles\.includes\(res\.context\.role\)/)
  })

  it('la vérification relit la BASE, jamais une valeur reçue du client', () => {
    expect(memberships).toMatch(/requireOrganizationMembership[\s\S]{0,700}from\('organization_memberships'\)/)
  })
})

describe('l’appartenance s’ajoute, elle ne remplace pas', () => {
  it('assignUserToOrg écrit une appartenance avant de toucher l’ancien modèle', () => {
    // Avant M1 : un simple UPDATE de `users.organization_id`, donc un
    // DÉPLACEMENT. Inviter Guillaume dans SERVINOR l'aurait retiré d'AGP.
    expect(organisations).toMatch(/from\('organization_memberships'\)[\s\S]{0,300}\.upsert\(/)
    expect(organisations).toMatch(/onConflict: 'user_id,organization_id'/)
  })

  it('la colonne historique n’est plus écrite pour un compte multi-organisations', () => {
    // Sinon la « par défaut » changerait à chaque invitation, et le compte
    // basculerait d'entreprise dans le dos de son propriétaire.
    expect(organisations).toMatch(/if \(!multi\) \{[\s\S]{0,200}update\(\{ organization_id: orgId \}\)/)
  })
})

describe('la migration reprend l’existant sans rien détruire', () => {
  it('elle est idempotente', () => {
    expect(migration).toMatch(/on conflict \(user_id, organization_id\) do nothing/)
    expect(migration).toMatch(/create table if not exists/)
  })

  it('elle n’invente pas d’accès pour un compte sans organisation', () => {
    expect(migration).toMatch(/where u\.organization_id is not null/)
  })

  it('un doublon d’appartenance est interdit par la base, pas par le code', () => {
    expect(migration).toMatch(/create unique index[\s\S]{0,160}\(user_id, organization_id\)/)
  })

  it('le rôle vit sur l’appartenance', () => {
    expect(migration).toMatch(/role\s+user_role\s+not null/)
  })

  it('une appartenance se suspend, elle ne se supprime pas', () => {
    expect(migration).toMatch(/status\s+text\s+not null default 'active'/)
    expect(migration).toMatch(/check \(status in \('active', 'suspended'\)\)/)
  })
})
