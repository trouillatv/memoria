// Doctrine V3 — Export whitelist (Slice 10.1)
//
// Aucun export public (Excel /semaine/export, PDF /p/[token], CSV, JSON) ne
// doit exposer d'identité agent par défaut. Ce test scanne les routes
// d'export et de partage public pour détecter des colonnes ou champs qui
// laisseraient fuiter du nominatif.
//
// L'asymétrie V3 :
//   ✅ Anonymisé : "Équipe affectée", "Participants (cardinalité)"
//   ❌ Interdit : nom d'agent, email agent, identité individuelle
//
// Si tu lis ce commentaire parce que ton build vient de planter : tu as
// probablement ajouté `taken_by_name`, `agent_name`, `participants[].full_name`
// ou équivalent dans un export. Soit (a) tu retires, soit (b) c'est un
// override admin justifié avec audit log — dans ce cas, ajoute le fichier à
// EXPLICITLY_AUDITED ci-dessous, mais lis d'abord la doctrine V3.
//
// Référence : docs/superpowers/doctrines/planning-doctrine.md § V3

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

// Patterns suspects : tout symbole qui ressemble à une identité agent exposée.
const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(agent|participant|user|member|operator|intervenant)_?(name|full_?name|email|first_?name|last_?name)\b/i,
    reason: 'Identité agent nominative dans un export = fuite. Anonymiser ou retirer.',
  },
  {
    pattern: /\btaken_by_(name|email|user)\b/i,
    reason: 'taken_by est un user_id, jamais à transformer en nom dans un export.',
  },
  {
    pattern: /\bdone_by_(name|email|user)\b/i,
    reason: 'done_by est un user_id, jamais à transformer en nom dans un export.',
  },
  {
    pattern: /\bvalidated_by_(name|email|user)\b/i,
    reason: 'validated_by est un user_id, jamais à transformer en nom dans un export.',
  },
  {
    pattern: /\b(get|fetch|list)(All)?Users(WithDetails|Names|Identities)?\b/,
    reason: 'Liste exhaustive d\'utilisateurs dans un export = leak. Refuser.',
  },
]

// Routes d'export et de partage public à scanner.
// Toute nouvelle route qui produit un fichier téléchargeable ou exposé publiquement
// doit être ajoutée ici.
const EXPORT_ROUTES = [
  'app/(dashboard)/semaine/export/route.ts',
  'app/p/[token]/page.tsx',
  'app/p/[token]/layout.tsx',
  // S2 — export ZIP « propriété des données » d'un chantier (donnees.xlsx +
  // photos + documents hors litige). Admin/manager only ; scanné comme les autres.
  'app/(dashboard)/sites/[id]/export/route.ts',
]

// Fichiers explicitement audités qui peuvent contenir des références nominatives
// LÉGITIMES (ex: option admin "include_identities" tracée). Ajouter avec
// justification écrite — c'est un acte doctrinal délibéré.
const EXPLICITLY_AUDITED = new Set<string>([
  // Pour l'instant : aucun. Toute exception doit passer en code review V3.
])

interface Violation {
  file: string
  line: number
  match: string
  reason: string
}

function fileExists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

function scanFile(absPath: string): Violation[] {
  const violations: Violation[] = []
  const rel = relative(REPO_ROOT, absPath).replace(/\\/g, '/')
  if (EXPLICITLY_AUDITED.has(rel)) return violations

  let content: string
  try {
    content = readFileSync(absPath, 'utf-8')
  } catch {
    return violations
  }
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    // Ignore les commentaires (la doctrine peut citer les interdits)
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue
    }
    for (const { pattern, reason } of SUSPICIOUS_PATTERNS) {
      const m = pattern.exec(line)
      if (m) {
        violations.push({
          file: rel,
          line: i + 1,
          match: m[0],
          reason,
        })
      }
    }
  }
  return violations
}

// Détecte toute nouvelle route d'export non répertoriée (chemin contenant
// `/export/route.ts` ou similaire) qui n'est PAS dans EXPORT_ROUTES.
function detectUnregisteredExports(): string[] {
  const found: string[] = []
  function walk(dir: string) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.next' || name === '.git') continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
      } else if (st.isFile()) {
        const rel = relative(REPO_ROOT, full).replace(/\\/g, '/')
        // Pattern : .../export/route.ts ou .../export.ts
        if (/\/export\/route\.(ts|tsx)$/.test(rel) || /\/export\.(ts|tsx)$/.test(rel)) {
          found.push(rel)
        }
      }
    }
  }
  walk(join(REPO_ROOT, 'app'))
  return found.filter((p) => !EXPORT_ROUTES.includes(p))
}

describe('Doctrine V3 — export whitelist', () => {
  it('routes d\'export répertoriées ne contiennent pas d\'identité nominative', () => {
    const violations: Violation[] = []
    for (const route of EXPORT_ROUTES) {
      const abs = join(REPO_ROOT, route)
      if (!fileExists(abs)) continue
      violations.push(...scanFile(abs))
    }
    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line} — "${v.match}"\n    → ${v.reason}`)
        .join('\n')
      throw new Error(
        `Doctrine V3 violation — identités nominatives dans un export :\n${report}\n\n` +
          `Cf. docs/superpowers/doctrines/planning-doctrine.md § V3.`,
      )
    }
    expect(violations).toEqual([])
  })

  it('aucune route d\'export non répertoriée (toute nouvelle route doit être whitelistée)', () => {
    const unregistered = detectUnregisteredExports()
    if (unregistered.length > 0) {
      throw new Error(
        `Doctrine V3 — nouvelle(s) route(s) d'export non répertoriée(s) :\n` +
          unregistered.map((p) => `  ${p}`).join('\n') +
          `\n\nAjoute-les à EXPORT_ROUTES dans tests/doctrine/export-whitelist.test.ts ` +
          `et garantis qu'aucune identité agent n'y apparaît par défaut.`,
      )
    }
    expect(unregistered).toEqual([])
  })
})
