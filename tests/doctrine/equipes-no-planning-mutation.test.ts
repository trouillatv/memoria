// /EQUIPES V2 — invariant Vincent « no-Planning-mutation-from-equipes ».
//
// /equipes est un PONT vers le Planning (team_id, planning_cycle_slots.team_id
// en LECTURE), jamais un second moteur de roulement. archiveTeam (lib/db/teams.ts)
// désaffecte missions/interventions/intervention_templates mais NE PEUT PAS et
// NE DOIT PAS toucher planning_cycle / planning_cycle_slots — cf. la note
// PLAN-SEC-1 dans archiveTeam : `planning_cycle_slots.team_id` est NOT NULL,
// le choke-point de réaffectation reste `regenerateTemplates`
// (lib/db/planning-cycles.ts), jamais /equipes.
//
// Ce test parcourt le périmètre /equipes (pages, actions, read-models) et FAIL
// si une écriture (insert/update/upsert/delete) apparaît sur planning_cycle
// ou planning_cycle_slots. Les lectures (select) restent autorisées.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const SCAN_ROOTS = [
  'app/(dashboard)/equipes',
  'lib/db/teams.ts',
  'lib/db/team-profile.ts',
  'lib/db/team-field-members.ts',
  'lib/db/team-actor-insight.ts',
]

const SCAN_EXTS = ['.ts', '.tsx']

const MUTATING_VERBS = /\.(insert|update|upsert|delete)\s*\(/

function collectFiles(root: string, out: string[]) {
  const abs = join(REPO_ROOT, root)
  let st
  try {
    st = statSync(abs)
  } catch {
    return
  }
  if (st.isFile()) {
    if (SCAN_EXTS.some((e) => abs.endsWith(e))) out.push(abs)
    return
  }
  for (const name of readdirSync(abs)) {
    const full = join(abs, name)
    const s = statSync(full)
    if (s.isDirectory()) {
      collectFiles(relative(REPO_ROOT, full).replace(/\\/g, '/'), out)
    } else if (SCAN_EXTS.some((e) => name.endsWith(e))) {
      out.push(full)
    }
  }
}

interface Violation {
  file: string
  line: number
  snippet: string
}

function scan(): Violation[] {
  const files: string[] = []
  for (const root of SCAN_ROOTS) collectFiles(root, files)

  const violations: Violation[] = []
  for (const absPath of files) {
    const rel = relative(REPO_ROOT, absPath).replace(/\\/g, '/')
    const content = readFileSync(absPath, 'utf-8')
    const fromCalls = [...content.matchAll(/\.from\(\s*['"](planning_cycle(?:_slots)?)['"]\s*\)/g)]
    for (const m of fromCalls) {
      const start = m.index ?? 0
      // Fenêtre jusqu'au prochain .from( (ou 300 caractères) : le chaînage
      // .from(table).verb(...) est immédiat dans ce codebase (cf. archiveTeam).
      const nextFrom = content.indexOf('.from(', start + m[0].length)
      const windowEnd = nextFrom === -1 ? start + 300 : Math.min(nextFrom, start + 300)
      const window = content.slice(start, windowEnd)
      if (MUTATING_VERBS.test(window)) {
        const line = content.slice(0, start).split('\n').length
        violations.push({ file: rel, line, snippet: window.replace(/\s+/g, ' ').trim().slice(0, 160) })
      }
    }
  }
  return violations
}

describe('Doctrine /EQUIPES V2 — jamais de mutation Planning depuis équipes', () => {
  it('aucune écriture sur planning_cycle / planning_cycle_slots dans le périmètre équipes', () => {
    const violations = scan()
    if (violations.length > 0) {
      const report = violations.map((v) => `  ${v.file}:${v.line} — ${v.snippet}`).join('\n')
      throw new Error(
        `/equipes est un PONT (team_id) vers le Planning, jamais un second moteur ` +
          `de roulement. Écriture(s) détectée(s) sur planning_cycle(_slots) :\n${report}`,
      )
    }
    expect(violations).toEqual([])
  })

  it('témoin structurel — planning_cycle_slots est bien LU (sinon le test ci-dessus est vide de sens)', () => {
    const teams = readFileSync(join(REPO_ROOT, 'lib/db/teams.ts'), 'utf-8')
    expect(teams).toMatch(/\.from\(\s*['"]planning_cycle_slots['"]\s*\)\s*\n?\s*\.select\(/)
  })
})
