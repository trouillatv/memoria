// Doctrine V3 — Test enforcement (Slice 10.1) → Doctrine V4 (/EQUIPES V2)
//
// Phrase guide :
//   « Connaître les humains dans un événement est autorisé. Calculer les humains
//     est interdit. »
//
// Ce test parcourt le code source (app/, lib/, components/) et FAIL si une
// fonction ou un symbole identifié comme "calcul humain" apparaît. C'est un
// garde-fou structurel, pas une recommandation. Si tu lis ce commentaire parce
// que ton build vient de planter : le symbole interdit que tu as ajouté
// ressemble à une dérive RH/surveillance. Soit tu renommes (le mot est
// secondaire), soit tu reconsidères la feature (le concept est primaire).
//
// Doctrine V4 (GO Vincent, /EQUIPES V2 — WOW PERSONNE) : les patterns
// "reverse lookup" (*ByUser/*ByAgent) sont désormais AUTORISÉS, mais
// uniquement dans les fichiers listés dans ALLOWED_REVERSE_LOOKUP_FILES
// ci-dessous, et uniquement pour construire une mémoire Personne à partir de
// participations CONFIRMÉES (jamais une déduction depuis une appartenance
// actuelle ou une affectation prévue). Tous les autres patterns (rank*,
// *Stats, PerformanceBy*, ProductivityBy*, *Availability, hoursWorked, etc.)
// restent interdits PARTOUT, y compris dans ces fichiers — la levée ne
// concerne que le lookup, jamais le calcul humain.
//
// Référence : docs/superpowers/doctrines/planning-doctrine.md § V3

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

// Patterns interdits — déclencheurs doctrinaux V3.
// On match en regex pour attraper les variations (`getInterventionsByUser`,
// `listInterventionsByUserId`, `interventionsByAgent`, etc.). Volontairement
// large : il vaut mieux un faux positif renommé que la dérive autorisée.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string; reverseLookupOnly?: boolean }> = [
  {
    pattern: /\b(get|list|fetch|count|select)\w*ByUser(Id)?\b/,
    reason: 'Reverse lookup user → events interdit (asymétrie V3). Ré-écrire en partant de l\'événement.',
    reverseLookupOnly: true,
  },
  {
    pattern: /\b(get|list|fetch|count|select)\w*ByAgent(Id)?\b/,
    reason: 'Reverse lookup agent → events interdit (asymétrie V3).',
    reverseLookupOnly: true,
  },
  {
    pattern: /\bgetActivity(By)?(User|Agent)\b/,
    reason: '"Activité par agent" = surveillance individuelle. Refus V3.',
  },
  {
    pattern: /\brank(Agents|Users|Members)\b/,
    reason: 'Classement humain = ranking = KPI individuel. Refus V3.',
  },
  {
    pattern: /\b(user|agent)Stats?\b/i,
    reason: 'Statistiques user-level interdites. Pas de KPI humain.',
  },
  {
    pattern: /\b(get|compute|calculate)\w*PerformanceBy(User|Agent)\b/,
    reason: 'Performance individuelle interdite par construction.',
  },
  {
    pattern: /\b(get|compute|calculate)\w*ProductivityBy(User|Agent)\b/,
    reason: 'Productivité humaine = mesure = refus V3.',
  },
  {
    pattern: /\bcompletionRateBy(User|Agent)\b/,
    reason: 'Taux de complétion par user = surveillance.',
  },
  {
    pattern: /\b(user|agent)Availability\b/i,
    reason: 'Modèle de disponibilité user = porte d\'entrée du time-tracking.',
  },
  {
    pattern: /\b(hoursWorked|workedHours|lateness|punctuality)\b/i,
    reason: 'Time-tracking masqué. Refus V3.',
  },
  {
    pattern: /\bassigned_?to_?user_?id\b/i,
    reason: 'Assignation nominative directe interdite. Affectation = équipe (V2).',
  },
  // ──────────────────────────────────────────────────────────────────────
  // Vincent 2026-05-22 — Sprint E (continuité anticipée).
  // Le sujet grammatical doit toujours être la MÉMOIRE / le SITE, jamais
  // la personne. Ces symboles ressemblent à de la prédiction de départ
  // ou de la notation d'agent et sont interdits par construction.
  // ──────────────────────────────────────────────────────────────────────
  {
    pattern: /\bdeparture(Risk|Score|Prediction)\b/i,
    reason: 'Prédiction de départ = surveillance prédictive. Refus Sprint E.',
  },
  {
    pattern: /\b(critical|risky)Agent\b/i,
    reason: '"Agent critique" = notation de personne. Refus Sprint E.',
  },
  {
    pattern: /\bagent(Risk|Value|Criticality)\b/i,
    reason: 'Notation/évaluation d\'agent interdite (V6.2, Sprint E).',
  },
  {
    pattern: /\b(replacement|substitution)Score\b/i,
    reason: '"Score de remplacement" = comparaison RH masquée. Refus.',
  },
  {
    pattern: /\b(staff|user|agent)Ranking\b/i,
    reason: 'Classement humain = ranking = KPI individuel. Refus V3 + Sprint E.',
  },
  {
    pattern: /\bcontractEndRisk\b/i,
    reason: 'Le sujet doit être la mémoire opérationnelle, pas le contrat de la personne.',
  },
  {
    pattern: /\bexpirationRisk\b/i,
    reason: 'Expiration = fait administratif. "Risque" appliqué à une personne = glissement RH.',
  },
]

// Dossiers à scanner — code applicatif uniquement.
const SCAN_DIRS = ['app', 'lib', 'components', 'scripts']

// Extensions de fichier à analyser.
const SCAN_EXTS = ['.ts', '.tsx']

// Dossiers à ignorer (build, modules, etc.).
const IGNORE_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '.turbo',
])

// Fichiers à exclure (le test lui-même mentionne légitimement les interdits).
const EXCLUDE_FILES = new Set([
  'tests/doctrine/forbidden-symbols.test.ts',
])

// Doctrine V4 — fichiers où le reverse lookup *ByUser/*ByAgent est autorisé
// (mémoire Personne bâtie sur des participations confirmées uniquement).
// Ne s'applique qu'aux patterns marqués `reverseLookupOnly` — tout le reste
// (rank*, *Stats, Performance/ProductivityBy*, Availability, hoursWorked…)
// reste interdit même dans ces fichiers.
const ALLOWED_REVERSE_LOOKUP_FILES = new Set([
  'lib/db/person-memory.ts',
])

interface Violation {
  file: string
  line: number
  match: string
  reason: string
}

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
    if (st.isDirectory()) {
      walk(full, out)
    } else if (st.isFile() && SCAN_EXTS.some((e) => name.endsWith(e))) {
      out.push(full)
    }
  }
}

function scanFiles(): Violation[] {
  const violations: Violation[] = []
  const files: string[] = []
  for (const dir of SCAN_DIRS) {
    walk(join(REPO_ROOT, dir), files)
  }

  for (const absPath of files) {
    const rel = relative(REPO_ROOT, absPath).replace(/\\/g, '/')
    if (EXCLUDE_FILES.has(rel)) continue

    let content: string
    try {
      content = readFileSync(absPath, 'utf-8')
    } catch {
      continue
    }
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Ignore lignes de commentaire pur (la doctrine peut citer les interdits)
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        continue
      }
      for (const { pattern, reason, reverseLookupOnly } of FORBIDDEN_PATTERNS) {
        if (reverseLookupOnly && ALLOWED_REVERSE_LOOKUP_FILES.has(rel)) continue
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
  }
  return violations
}

describe('Doctrine V3 — forbidden symbols', () => {
  it('aucun symbole de calcul humain dans le code applicatif', () => {
    const violations = scanFiles()
    if (violations.length > 0) {
      const report = violations
        .map(
          (v) =>
            `  ${v.file}:${v.line} — "${v.match}"\n    → ${v.reason}`,
        )
        .join('\n')
      throw new Error(
        `Doctrine V3 violation — ${violations.length} symbole(s) interdit(s) détecté(s) :\n${report}\n\n` +
          `Cf. docs/superpowers/doctrines/planning-doctrine.md § V3.`,
      )
    }
    expect(violations).toEqual([])
  })
})
