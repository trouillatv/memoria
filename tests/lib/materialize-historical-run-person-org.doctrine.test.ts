import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = join(process.cwd(), 'lib/documents/materialize-historical-run.ts')
const MIGRATION_219 = join(process.cwd(), 'supabase/migrations/219_field_persons_in_teams.sql')

// ── P0 PV4 48/51 — CAS B : company_contacts.organization_id omis ────────────
//
// La migration 219 a rendu company_contacts.organization_id NOT NULL et posé
// un trigger BEFORE INSERT/UPDATE qui lève une exception explicite si la
// colonne est nulle — appliqué même sous service-role. Le code de
// materializeHistoricalRun ne vérifiait jamais l'erreur retournée par
// l'insert (seul `data` était déstructuré) : chaque insertion échouait donc
// en silence et retombait sur `if (!newContact) continue`. Résultat prouvé
// par audit : 0/1000 propositions `person`, toutes organisations confondues,
// n'ont JAMAIS atteint review_status='materialized' — y compris les 204 avec
// un linkedCompanyName valide et résolvable.
//
// Ce test ne remplace pas une preuve d'exécution réelle (le pipeline complet
// de materializeHistoricalRun n'est pas mocké ici — RPC + résolution acteurs +
// récit narratif dépassent le périmètre de cette correction) : il garantit
// seulement que la régression exacte identifiée par l'audit ne peut pas
// revenir silencieusement sur ce insert précis.
describe('materializeHistoricalRun — company_contacts porte organization_id', () => {
  it('la migration 219 confirme la contrainte NOT NULL + trigger sur organization_id', () => {
    const sql = readFileSync(MIGRATION_219, 'utf8')
    expect(sql).toMatch(/alter table public\.company_contacts\s+alter column organization_id set not null/)
    expect(sql).toMatch(/raise exception 'company_contacts: organization_id requis'/)
    expect(sql).toMatch(/create trigger trg_company_contacts_org\s+before insert or update on public\.company_contacts/)
  })

  it('l’insert de nouveau contact (personne avec entreprise liée) inclut organization_id: orgId', () => {
    const source = readFileSync(SOURCE, 'utf8')
    const personLoopStart = source.indexOf('for (const rawProp of personPropsRaw ?? [])')
    expect(personLoopStart).toBeGreaterThan(-1)
    const personLoopEnd = source.indexOf('// ── F3-2', personLoopStart)
    expect(personLoopEnd).toBeGreaterThan(personLoopStart)
    const personLoop = source.slice(personLoopStart, personLoopEnd)

    const insertStart = personLoop.indexOf(".insert({ organization_id: orgId, company_id: companyId, full_name: personName")
    expect(insertStart, 'insert company_contacts introuvable dans la boucle personne').toBeGreaterThan(-1)
    const insertEnd = personLoop.indexOf('})', insertStart)
    const insertCall = personLoop.slice(insertStart, insertEnd)

    expect(insertCall).toMatch(/organization_id:\s*orgId/)
  })
})
