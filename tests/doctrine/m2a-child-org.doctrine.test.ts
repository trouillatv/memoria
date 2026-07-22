import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ── M2A : PROPRIÉTÉ STRUCTURELLE DU CHANTIER ───────────────────────────────
//
// Les 4 objets enfants portent `organization_id`, dérivé du chantier — un CACHE,
// jamais une valeur métier libre. Ce fichier protège les invariants de la
// migration 234 ; le comportement runtime (héritage, recalcul, FK) est prouvé
// dynamiquement contre la base, ces preuves-là dépendent de contraintes SQL que
// des tests unitaires ne peuvent pas exercer.

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/234_m2a_child_org.sql'), 'utf8')
const ENFANTS = ['site_actions', 'site_decisions', 'site_intervenants', 'site_action_events'] as const

describe('la migration 234 verrouille la propriété structurelle', () => {
  it('assertion préalable : aucun chantier sans organisation', () => {
    expect(sql).toMatch(/from public\.sites where organization_id is null[\s\S]*raise exception/i)
  })

  it('sites.organization_id devient NON NULLABLE', () => {
    expect(sql).toMatch(/alter table public\.sites\s+alter column organization_id set not null/i)
  })

  it('sites porte l’unique (id, organization_id) requis par les FK composites', () => {
    expect(sql).toMatch(/add constraint sites_id_org_unique unique \(id, organization_id\)/i)
  })

  for (const t of ENFANTS) {
    it(`${t} : colonne, NOT NULL, FK composite, index`, () => {
      expect(sql, `${t} colonne`).toMatch(new RegExp(`alter table public\\.${t}\\s+add column if not exists organization_id`, 'i'))
      expect(sql, `${t} not null`).toMatch(new RegExp(`alter table public\\.${t}\\s+alter column organization_id set not null`, 'i'))
      expect(sql, `${t} FK composite`).toMatch(new RegExp(`${t}_site_org_fk[\\s\\S]*foreign key \\(site_id, organization_id\\) references public\\.sites\\(id, organization_id\\)`, 'i'))
      expect(sql, `${t} index`).toMatch(new RegExp(`create index if not exists idx_${t}_org`, 'i'))
    })
  }

  it('le trigger force TOUJOURS l’org depuis le site, jamais une valeur fournie', () => {
    // Recalcule depuis new.site_id ; ne lit pas new.organization_id.
    expect(sql).toMatch(/select organization_id into v_org from public\.sites where id = new\.site_id/i)
    expect(sql).toMatch(/new\.organization_id := v_org/i)
    // Défense en profondeur : site absent ou sans org lève.
    expect(sql).toMatch(/if v_org is null then\s*raise exception/i)
  })

  it('append-only : site_action_events hérite à l’INSERT seulement', () => {
    // Les trois autres : INSERT OR UPDATE.
    for (const t of ['site_actions', 'site_decisions', 'site_intervenants']) {
      expect(sql, `${t} insert or update`).toMatch(new RegExp(`create trigger trg_force_org before insert or update on public\\.${t}`, 'i'))
    }
    // site_action_events : INSERT uniquement (coexiste avec le trigger immutable).
    expect(sql).toMatch(/create trigger trg_force_org before insert on public\.site_action_events\b/i)
    expect(sql).not.toMatch(/before insert or update on public\.site_action_events/i)
    // Le backfill suspend puis rétablit le trigger append-only, dans la transaction.
    expect(sql).toMatch(/disable trigger trg_action_event_immutable[\s\S]*update public\.site_action_events[\s\S]*enable trigger trg_action_event_immutable/i)
  })

  it('contrôle zéro NULL / zéro divergence AVANT le passage NOT NULL', () => {
    const iControle = sql.search(/ligne\(s\) enfant divergente/i)
    const iNotNull = sql.search(/alter column organization_id set not null/i)
    // (le premier set not null est celui de sites, à l'étape 2 ; on vérifie que
    //  le contrôle de divergence précède les NOT NULL des enfants, étape 7)
    const iEnfantsNotNull = sql.search(/alter table public\.site_actions\s+alter column organization_id set not null/i)
    expect(iControle).toBeGreaterThan(-1)
    expect(iControle).toBeLessThan(iEnfantsNotNull)
    expect(iNotNull).toBeGreaterThan(-1)
  })
})
