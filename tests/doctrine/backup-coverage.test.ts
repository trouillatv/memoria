// Doctrine backup (Vincent 2026-07-09) : toute table est sauvegardée par
// défaut, toute exclusion est EXPLICITE et justifiée. Tripwire structurel pur
// (lecture de fichiers, zéro DB) — empêche le retour d'une liste en dur qui
// dérive (la précédente avait ~80 migrations de retard).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const route = readFileSync(join(ROOT, 'app/api/cron/backup/route.ts'), 'utf-8')
const mig = readFileSync(join(ROOT, 'supabase/migrations/192_backup_list_tables.sql'), 'utf-8')

describe('Doctrine backup — énumération dynamique (mig 192)', () => {
  it('la route énumère les tables via backup_list_tables (jamais une liste en dur)', () => {
    expect(/\.rpc\('backup_list_tables'\)/.test(route)).toBe(true)
    expect(/const TABLES\s*=\s*\[/.test(route)).toBe(false)
  })

  it('les exclusions sont explicites (const EXCLUDED) et filtrées', () => {
    expect(/const EXCLUDED:\s*Record<string,\s*string>/.test(route)).toBe(true)
    expect(/!\(t in EXCLUDED\)/.test(route)).toBe(true)
  })

  it('échec d’énumération → refus de backup partiel silencieux (500)', () => {
    expect(/backup_list_tables failed/.test(route)).toBe(true)
  })

  it('dump paginé — jamais de troncature silencieuse à 1000 lignes', () => {
    expect(/\.range\(from,\s*from \+ PAGE - 1\)/.test(route)).toBe(true)
  })

  it('mig 192 : fonction verrouillée service-role (revoke anon/authenticated)', () => {
    expect(/security definer/i.test(mig)).toBe(true)
    expect(/revoke all on function public\.backup_list_tables\(\) from anon/i.test(mig)).toBe(true)
    expect(/revoke all on function public\.backup_list_tables\(\) from authenticated/i.test(mig)).toBe(true)
    expect(/grant execute on function public\.backup_list_tables\(\) to service_role/i.test(mig)).toBe(true)
  })
})
