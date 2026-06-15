// Tripwire V6.1 — `planned_start` / `planned_end` sont des ancrages de
// PRESTATION (site/contrat), JAMAIS des pointages de personne.
//
// Pare-feu doctrinal : aucune agrégation de planned_* par user_id /
// created_by / assigned_team_id / personne identifiable n'est autorisée
// nulle part dans le code applicatif.
//
// Si un développeur écrit demain un dashboard « heures travaillées par
// agent » en agrégeant planned_start, ce test échoue et bloque le merge.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'node_modules' || name === '.next' || name === 'dist' || name.startsWith('.')) continue
    const s = statSync(p)
    if (s.isDirectory()) {
      yield* walk(p)
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) {
      yield p
    }
  }
}

function readCodeOnly(p: string): string {
  return readFileSync(p, 'utf-8')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('V6.1 — planned_start / planned_end ne sont JAMAIS agrégés par personne', () => {
  // Liste des patterns interdits : agrégat planned_* avec user_id /
  // created_by / assigned_team_id à proximité.
  const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
    {
      name: 'sum(planned_start ... by user_id)',
      re: /sum\([^)]*planned_(start|end)[^)]*\)[\s\S]{0,200}?group by\s+[\w.]*(user_id|created_by|assigned_team_id)/i,
    },
    {
      name: 'avg(planned_*) groupé par user',
      re: /avg\([^)]*planned_(start|end)[^)]*\)[\s\S]{0,200}?group by\s+[\w.]*(user_id|created_by)/i,
    },
    {
      name: 'planned_duration agrégé par personne',
      re: /planned_(start|end|duration)[\s\S]{0,100}?group_by\(\s*['"](?:user_id|created_by)['"]\s*\)/i,
    },
  ]

  it('aucun fichier de production n\'agrège planned_* par user_id / created_by', () => {
    const violations: Array<{ file: string; pattern: string }> = []
    for (const file of walk(join(ROOT, 'lib'))) {
      const code = readCodeOnly(file)
      for (const p of FORBIDDEN_PATTERNS) {
        if (p.re.test(code)) {
          violations.push({ file: file.replace(ROOT + '/', ''), pattern: p.name })
        }
      }
    }
    for (const file of walk(join(ROOT, 'app'))) {
      const code = readCodeOnly(file)
      for (const p of FORBIDDEN_PATTERNS) {
        if (p.re.test(code)) {
          violations.push({ file: file.replace(ROOT + '/', ''), pattern: p.name })
        }
      }
    }
    expect(violations, `V6.1 pare-feu violé :\n${violations.map((v) => `  ${v.file} → ${v.pattern}`).join('\n')}`).toEqual([])
  })

  it('le commentaire de doctrine V6.1 est préservé dans lib/db/interventions.ts', () => {
    const code = readFileSync(join(ROOT, 'lib/db/interventions.ts'), 'utf-8')
    expect(/V6\.1/.test(code)).toBe(true)
    expect(/JAMAIS pointage personne|pare-feu|jamais agréger par user_id/i.test(code)).toBe(true)
  })

  it('migration 071 contient le pare-feu doctrinal explicite', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/071_intervention_planned_start.sql'), 'utf-8')
    expect(/JAMAIS\s+un pointage de personne|pare-feu/i.test(sql)).toBe(true)
    expect(/Ne jamais agréger par user_id/i.test(sql)).toBe(true)
  })
})

describe('V6.1 — helpers de saisie heure précise', () => {
  it('isValidHHMM accepte 06:30, 23:59 et refuse 25:00, 06:60, abc', async () => {
    const { isValidHHMM } = await import('@/lib/time/prestation-slot')
    expect(isValidHHMM('06:30')).toBe(true)
    expect(isValidHHMM('00:00')).toBe(true)
    expect(isValidHHMM('23:59')).toBe(true)
    expect(isValidHHMM('25:00')).toBe(false)
    expect(isValidHHMM('06:60')).toBe(false)
    expect(isValidHHMM('abc')).toBe(false)
    expect(isValidHHMM('')).toBe(false)
  })

  it('buildPlannedTimestamp construit un timestamptz cohérent ou retourne null', async () => {
    const { buildPlannedTimestamp } = await import('@/lib/time/prestation-slot')
    expect(buildPlannedTimestamp('2026-05-20', '06:30')).toBe('2026-05-20T06:30:00.000Z')
    expect(buildPlannedTimestamp('2026-05-20', '14:15')).toBe('2026-05-20T14:15:00.000Z')
    expect(buildPlannedTimestamp('2026-05-20', '25:00')).toBeNull()
    expect(buildPlannedTimestamp('2026-05-20', 'invalid')).toBeNull()
  })

  it('fmtHourFr formate « 6h30 », « 14h », « 7h15 »', async () => {
    const { fmtHourFr } = await import('@/lib/time/prestation-slot')
    expect(fmtHourFr('2026-05-20T06:30:00.000Z')).toBe('6h30')
    expect(fmtHourFr('2026-05-20T14:00:00.000Z')).toBe('14h')
    expect(fmtHourFr('2026-05-20T07:15:00.000Z')).toBe('7h15')
    expect(fmtHourFr(null)).toBe('—')
  })

  it('fmtDurationFr calcule « 1h30 », « 45 min », « 2h »', async () => {
    const { fmtDurationFr } = await import('@/lib/time/prestation-slot')
    expect(fmtDurationFr('2026-05-20T06:30:00.000Z', '2026-05-20T08:00:00.000Z')).toBe('1h30')
    expect(fmtDurationFr('2026-05-20T13:00:00.000Z', '2026-05-20T13:45:00.000Z')).toBe('45 min')
    expect(fmtDurationFr('2026-05-20T08:00:00.000Z', '2026-05-20T10:00:00.000Z')).toBe('2h')
    // Cas pathologique : end avant start
    expect(fmtDurationFr('2026-05-20T08:00:00.000Z', '2026-05-20T07:00:00.000Z')).toBeNull()
  })

  it('isPlannedStartPrecise distingue ancrage canonique (07/14/19) vs saisie précise', async () => {
    const { isPlannedStartPrecise } = await import('@/lib/time/prestation-slot')
    // Ancrages canoniques (faux)
    expect(isPlannedStartPrecise('2026-05-20T07:00:00.000Z')).toBe(false)
    expect(isPlannedStartPrecise('2026-05-20T14:00:00.000Z')).toBe(false)
    expect(isPlannedStartPrecise('2026-05-20T19:00:00.000Z')).toBe(false)
    // Heures précises terrain (vrai)
    expect(isPlannedStartPrecise('2026-05-20T06:30:00.000Z')).toBe(true)
    expect(isPlannedStartPrecise('2026-05-20T07:15:00.000Z')).toBe(true)
    expect(isPlannedStartPrecise('2026-05-20T13:45:00.000Z')).toBe(true)
    expect(isPlannedStartPrecise(null)).toBe(false)
  })

  it('formatPlannedTimeRange : range complet avec durée', async () => {
    const { formatPlannedTimeRange } = await import('@/lib/time/prestation-slot')
    expect(formatPlannedTimeRange(
      '2026-05-20T06:30:00.000Z',
      '2026-05-20T08:00:00.000Z',
      'morning',
    )).toBe('6h30 – 8h (1h30)')
    // Seul start
    expect(formatPlannedTimeRange(
      '2026-05-20T06:30:00.000Z',
      null,
      'morning',
    )).toBe('6h30')
    // Fallback slot
    expect(formatPlannedTimeRange(null, null, 'morning')).toBe('7h')
  })

  it('formatInterventionTimeLabel : heure précise prend le pas sur slot, sinon fallback', async () => {
    const { formatInterventionTimeLabel } = await import('@/lib/time/prestation-slot')
    // Heure précise → utilise range
    expect(formatInterventionTimeLabel({
      planned_start: '2026-05-20T06:30:00.000Z',
      planned_end: '2026-05-20T08:00:00.000Z',
      slot: 'morning',
    })).toBe('6h30 – 8h (1h30)')
    // Pas d'heure précise → fallback sur l'ancrage HORAIRE du créneau (7h / 14h
    // / 19h). Décision Vincent 2026-06-15 : on ne dit JAMAIS « Matin / Après-midi
    // / Soir » côté UI — on reste sur des créneaux horaires.
    expect(formatInterventionTimeLabel({
      planned_start: '2026-05-20T07:00:00.000Z',
      planned_end: null,
      slot: 'morning',
    })).toBe('7h')
    expect(formatInterventionTimeLabel({
      planned_start: null,
      planned_end: null,
      slot: 'afternoon',
    })).toBe('14h')
  })
})
