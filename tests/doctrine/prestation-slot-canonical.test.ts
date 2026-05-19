// =============================================================================
// Constat fondateur V6.1 — un seul mapping slot↔heure (l'ouverture paie son coût)
// =============================================================================
//
// Doctrine : exploitation-doctrine-V6.md, « Constat fondateur » + Pilier V6.1.
//
// `interventions.scheduled_at` était dérivé par des mappings slot→heure
// DIVERGENTS (6/12/18 ; 7/13/18 ; 8/14/19 ; + 7h/14h/19h à l'affichage ; +
// deux reverse `h<12 / h<17` dupliqués). Une fausse heure précise, incohérente.
//
// Ce fichier verrouille la correction V6.1 :
//  (A) tests unitaires de la fonction pure canonique (round-trip + tolérance
//      legacy non destructive) ;
//  (B) TRIPWIRE : échoue si un mapping slot→heure réapparaît HORS du module
//      canonique `lib/time/prestation-slot.ts`. La dette ne se recrée pas en
//      silence — comme les verrous V6.7, l'ouverture paie son coût structurel.
//
// Si ton build plante ici : tu as réintroduit un mapping slot→heure local.
// Importe `@/lib/time/prestation-slot` au lieu de le redupliquer.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  SLOT_UTC_HOUR,
  slotToUtcHour,
  buildScheduledAt,
  slotFromUtcHour,
  slotFromScheduledAt,
  currentSlot,
  slotReferenceLabelFr,
} from '@/lib/time/prestation-slot'
import type { InterventionSlot } from '@/types/db'

const REPO_ROOT = join(__dirname, '..', '..')
const CANONICAL = 'lib/time/prestation-slot.ts'
const SELF = 'tests/doctrine/prestation-slot-canonical.test.ts'

// ---------------------------------------------------------------------------
// (A) Fonction pure canonique
// ---------------------------------------------------------------------------
describe('Module canonique slot↔heure (V6.1)', () => {
  const SLOTS: InterventionSlot[] = ['morning', 'afternoon', 'evening']

  it('valeurs canoniques gravées = 07 / 14 / 19 UTC', () => {
    expect(SLOT_UTC_HOUR).toEqual({ morning: 7, afternoon: 14, evening: 19 })
  })

  it('round-trip : slotFromUtcHour(slotToUtcHour(s)) === s', () => {
    for (const s of SLOTS) {
      expect(slotFromUtcHour(slotToUtcHour(s))).toBe(s)
    }
  })

  it('buildScheduledAt produit un timestamptz UTC stable', () => {
    expect(buildScheduledAt('2026-05-19', 'morning')).toBe('2026-05-19T07:00:00.000Z')
    expect(buildScheduledAt('2026-05-19', 'afternoon')).toBe('2026-05-19T14:00:00.000Z')
    expect(buildScheduledAt('2026-05-19', 'evening')).toBe('2026-05-19T19:00:00.000Z')
  })

  it('slot null → ancrage matin stable (jamais de throw)', () => {
    expect(slotToUtcHour(null)).toBe(7)
    expect(buildScheduledAt('2026-05-19', null)).toBe('2026-05-19T07:00:00.000Z')
  })

  it('tolérance legacy NON DESTRUCTIVE : les 3 anciens mappings se relisent au bon slot', () => {
    // 6/7/8 → morning ; 12/13/14 → afternoon ; 18/19 → evening.
    for (const h of [6, 7, 8]) expect(slotFromUtcHour(h)).toBe('morning')
    for (const h of [12, 13, 14]) expect(slotFromUtcHour(h)).toBe('afternoon')
    for (const h of [18, 19]) expect(slotFromUtcHour(h)).toBe('evening')
    // Un scheduled_at écrit par l'ancien mapping 6/12/18 reste cohérent.
    expect(slotFromScheduledAt('2025-01-01T06:00:00.000Z')).toBe('morning')
    expect(slotFromScheduledAt('2025-01-01T12:00:00.000Z')).toBe('afternoon')
    expect(slotFromScheduledAt('2025-01-01T18:00:00.000Z')).toBe('evening')
  })

  it('currentSlot dérive le slot de l’heure UTC', () => {
    expect(currentSlot(new Date('2026-05-19T07:30:00.000Z'))).toBe('morning')
    expect(currentSlot(new Date('2026-05-19T16:59:00.000Z'))).toBe('afternoon')
    expect(currentSlot(new Date('2026-05-19T22:00:00.000Z'))).toBe('evening')
  })

  it('libellé de référence = repère grossier, jamais un horaire précis', () => {
    expect(slotReferenceLabelFr('morning')).toBe('7h')
    expect(slotReferenceLabelFr('evening')).toBe('19h')
    expect(slotReferenceLabelFr(null)).toBe('—')
  })
})

// ---------------------------------------------------------------------------
// (B) Tripwire : aucun mapping slot→heure hors du module canonique
// ---------------------------------------------------------------------------
const SCAN_DIRS = ['app', 'lib', 'services', 'components']
const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.turbo'])

function walk(dir: string, out: string[]) {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (IGNORE_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (st.isFile() && (name.endsWith('.ts') || name.endsWith('.tsx'))) out.push(full)
  }
}

// Un mapping slot→HEURE : slot littéral associé à une heure du jour (5–23) ou
// une heure-string (`'18h'`). Bornes 5–23 : exclut volontairement les maps
// d'ORDRE de tri (`{ morning: 0, afternoon: 1, evening: 2 }`) et les classes
// CSS (`morning: 'bg-amber-…'`, valeur non numérique) — ni l'une ni l'autre
// n'est la dette du Constat fondateur. Couvre tous les legacy (6/7/8,
// 12/13/14, 18/19) et l'affichage (`7h`…`19h`). Reverse : borne `h<12|17`
// adjacente à un slot littéral.
const HOUR = "(?:[5-9]|1\\d|2[0-3])"
const MAPPING_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: new RegExp(`\\b(morning|afternoon|evening)\\s*:\\s*'?${HOUR}h?'?`, 'i'),
    why: 'mapping objet slot→heure (Record/littéral)',
  },
  {
    re: new RegExp(`===\\s*'(morning|afternoon|evening)'\\s*\\?\\s*'?${HOUR}h?'?`, 'i'),
    why: 'ternaire slot→heure',
  },
  {
    re: /<\s*1[27]\b[^\n]{0,40}\b(morning|afternoon|evening)\b/i,
    why: 'reverse heure→slot (borne h<12 / h<17 dupliquée)',
  },
]

describe('Tripwire V6.1 — un seul mapping slot↔heure', () => {
  it('aucun mapping slot→heure hors de lib/time/prestation-slot.ts', () => {
    const files: string[] = []
    for (const d of SCAN_DIRS) walk(join(REPO_ROOT, d), files)

    const violations: string[] = []
    for (const abs of files) {
      const rel = relative(REPO_ROOT, abs).replace(/\\/g, '/')
      if (rel === CANONICAL || rel === SELF) continue
      let lines: string[]
      try {
        lines = readFileSync(abs, 'utf-8').split('\n')
      } catch {
        continue
      }
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
        for (const { re, why } of MAPPING_PATTERNS) {
          if (re.test(lines[i])) {
            violations.push(`${rel}:${i + 1} — ${why} : ${t.slice(0, 90)}`)
          }
        }
      }
    }
    expect(
      violations,
      `Mapping slot→heure hors du module canonique (Constat fondateur V6.1) :\n` +
        violations.join('\n') +
        `\n\n→ importe @/lib/time/prestation-slot au lieu de redupliquer.`,
    ).toEqual([])
  })
})
