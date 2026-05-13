// Phase 3.4 — Garde-fou doctrinal pour les « À savoir » de site (verrou V4.1).
//
// Vérifie que :
//   1. Le mot « consigne » (charge administrative/militaire) ne réapparaît PAS
//      dans le code de surface (UI/labels/placeholders) — on a délibérément
//      basculé sur « À savoir » au moment de migration 045.
//   2. Les placeholders/help-text qui guident la saisie ne suggèrent JAMAIS
//      une formulation directive envers les personnes.
//
// Référence : docs/09_REGLES_DE_MODIFICATION.md § Verrou V4.1

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

// Fichiers UI/UX où le wording compte. On scanne uniquement les fichiers liés
// à la gestion des site_notes / À savoir (pas tout le projet, pour éviter les
// faux positifs sur des contextes non liés).
const TARGETS = [
  'app/(dashboard)/sites/[id]',
  'app/(field)/m/intervention/[id]/AddSiteNoteButton.tsx',
  'app/(field)/m/intervention/[id]/SiteResumeCard.tsx',
  'app/(dashboard)/briefing/SiteNotesPopover.tsx',
]

function listFiles(dir: string): string[] {
  const full = join(REPO_ROOT, dir)
  try {
    const stat = statSync(full)
    if (stat.isFile()) return [full]
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of readdirSync(full)) {
    const path = join(full, entry)
    try {
      const stat = statSync(path)
      if (stat.isDirectory()) {
        out.push(...listFiles(relative(REPO_ROOT, path)))
      } else if (
        entry.endsWith('.ts') ||
        entry.endsWith('.tsx')
      ) {
        out.push(path)
      }
    } catch {
      /* ignore */
    }
  }
  return out
}

const files = TARGETS.flatMap(listFiles)

describe('Doctrine V4.1 — À savoir, jamais consigne', () => {
  it('aucune occurrence de "consigne" dans les fichiers UI des site_notes', () => {
    const violations: Array<{ file: string; lines: string[] }> = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const matched = content
        .split('\n')
        .map((line, idx) => ({ line: line.trim(), n: idx + 1 }))
        // On match « consigne » avec frontières de mot — évite les faux
        // positifs sur d'autres mots.
        .filter((l) => /\bconsigne[s]?\b/i.test(l.line))
        // Ignore les commentaires explicatifs qui justifient l'absence du mot.
        .filter((l) => !l.line.startsWith('//') && !l.line.startsWith('*'))
        .map((l) => `L${l.n}: ${l.line}`)
      if (matched.length) violations.push({ file: relative(REPO_ROOT, file), lines: matched })
    }
    if (violations.length) {
      const msg = violations
        .map((v) => `  ${v.file}\n    ${v.lines.join('\n    ')}`)
        .join('\n')
      throw new Error(
        `Le mot « consigne » est réapparu dans le code UI. Verrou V4.1 dit ` +
        `d'utiliser « À savoir ». Renommer ou ajuster :\n${msg}`,
      )
    }
    expect(violations).toEqual([])
  })

  it('aucune formulation impérative directive dans les placeholders/labels', () => {
    // Ces patterns suggèrent qu'un placeholder ou label encourage l'utilisateur
    // à écrire une directive nominative. On les bloque.
    const RISKY = [
      /\bdois? faire\b/i, // "ce qu'il doit faire", "tu dois faire"
      /\bobligatoire\s+(de|pour)\b/i,
      /\bimpératif\b/i,
      /\bil faut (que|qu'il)\b/i,
    ]
    const violations: Array<{ file: string; lines: string[] }> = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const matched = content
        .split('\n')
        .map((line, idx) => ({ line, n: idx + 1 }))
        .filter((l) => RISKY.some((r) => r.test(l.line)))
        .filter((l) => !l.line.trim().startsWith('//') && !l.line.trim().startsWith('*'))
        .map((l) => `L${l.n}: ${l.line.trim()}`)
      if (matched.length) violations.push({ file: relative(REPO_ROOT, file), lines: matched })
    }
    if (violations.length) {
      const msg = violations
        .map((v) => `  ${v.file}\n    ${v.lines.join('\n    ')}`)
        .join('\n')
      throw new Error(
        `Formulation impérative directive détectée dans la surface UI des site_notes. ` +
        `Verrou V4.1 : les À savoir décrivent le lieu, jamais les personnes :\n${msg}`,
      )
    }
    expect(violations).toEqual([])
  })
})
