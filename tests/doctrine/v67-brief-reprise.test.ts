// =============================================================================
// Enforcement structurel V6 — verrous 6 à 9 (Pilier V6.7)
// =============================================================================
//
// Doctrine : docs/superpowers/doctrines/exploitation-doctrine-V6.md
//            § « Enforcement structurel V6 (tests, pas texte) », points 6-9.
// Journal   : docs/10_JOURNAL_DECISIONS.md, 2026-05-19 (Doctrine V6.7).
//
//   « Sans les verrous 6-9, V6.7 est la dérive que V6.2 bloque.
//     Tant qu'ils ne sont pas verts, V6.7 n'est pas activable. »
//
// Le « brief de reprise déclenché par événement » n'est PAS encore implémenté
// (journal : « à venir, non implémenté »). Ces tests sont donc des TRIPWIRES :
// ils passent sur le code actuel (feature absente) et FAIL à la seconde où
// quelqu'un construit la feature en violant un verrou. Le verrou 8 (seuil k)
// est, lui, déjà exécutable : il teste la fonction pure que le futur brief
// DEVRA traverser (`applyContinuityKThreshold`, lib/db/site-cockpit.ts).
//
// Si tu lis ce commentaire parce que ton build vient de planter : tu as
// probablement ajouté un générateur de brief de reprise qui (6) prend une
// personne en entrée primaire hors événement, (7) persiste le brief en base,
// (8) rend un nom sous le seuil k, ou (9) ne journalise pas l'audit. Relis le
// Pilier V6.7 — retirer un verrou = retour au refus V6.2.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  applyContinuityKThreshold,
  CONTINUITY_K_THRESHOLD,
  type HumanContinuityEntry,
} from '@/lib/db/site-cockpit'

const REPO_ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(p, 'utf-8')

const SCAN_DIRS = ['app', 'lib', 'services', 'components']
const SCAN_EXTS = ['.ts', '.tsx']
const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.turbo'])

// Ce fichier de test cite légitimement tous les interdits.
const SELF = 'tests/doctrine/v67-brief-reprise.test.ts'

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
    else if (st.isFile() && SCAN_EXTS.some((e) => name.endsWith(e))) out.push(full)
  }
}

function sourceFiles(): string[] {
  const files: string[] = []
  for (const d of SCAN_DIRS) walk(join(REPO_ROOT, d), files)
  return files
}

// Retire les lignes de commentaire pur : la doctrine peut citer les interdits.
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

// Identifie un générateur/surface de « brief de reprise » : co-occurrence,
// dans un MÊME identifiant, de (reprise|handover) et (brief), dans un ordre
// quelconque, avec n'importe quel préfixe/suffixe (`getRepriseBriefForUser`,
// `briefDeRepriseData`, `handoverBrief`, …). Volontairement large — mieux
// vaut un faux positif renommé que la dérive autorisée. Ne matche PAS
// `getSiteTransmissionReadings` (lecture site-first passive, V6.2-conforme).
const REPRISE_BRIEF_SYMBOL =
  /(?:reprise|handover)[A-Za-z]*brief|brief[A-Za-z]*(?:reprise|handover)/i

function repriseBriefFiles(): { rel: string; code: string }[] {
  const hits: { rel: string; code: string }[] = []
  for (const abs of sourceFiles()) {
    const rel = relative(REPO_ROOT, abs).replace(/\\/g, '/')
    if (rel === SELF) continue
    let code: string
    try {
      code = stripComments(read(abs))
    } catch {
      continue
    }
    if (REPRISE_BRIEF_SYMBOL.test(code)) hits.push({ rel, code })
  }
  return hits
}

// ---------------------------------------------------------------------------
// Verrou 6 — Brief de reprise = déclenché-événement uniquement
// ---------------------------------------------------------------------------
describe('Verrou V6.7 #6 — déclenché-événement, jamais personne-en-entrée', () => {
  it('aucune route app/**/(reprise|handover)/[param] (sujet-personne routable)', () => {
    const offenders: string[] = []
    function scan(dir: string) {
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
        if (!st.isDirectory()) continue
        const rel = relative(REPO_ROOT, full).replace(/\\/g, '/')
        // Un dossier reprise/handover contenant un segment dynamique [..]
        // matérialiserait une destination « personne » navigable.
        if (
          /\/(reprise|handover|brief-reprise)$/i.test(rel) &&
          readdirSync(full).some((c) => c.startsWith('['))
        ) {
          offenders.push(rel)
        }
        scan(full)
      }
    }
    scan(join(REPO_ROOT, 'app'))
    expect(
      offenders,
      `Route(s) sujet-personne pour un brief de reprise — interdit V6.2/V6.7 :\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it("aucun générateur de brief de reprise ne prend une personne comme entrée primaire hors événement", () => {
    const PERSON_INPUT =
      /\b(user_?id|agent_?id|user_?name|agent_?name|full_?name|nom_intervenant|search|query|\bq\b)\b/i
    const EVENT_CONTEXT =
      /\b(event|planning|absence|depart|départ|unavailab|indispo|leave|cong[ée]|fin_?de_?mission)\w*/i
    const violations: string[] = []
    for (const { rel, code } of repriseBriefFiles()) {
      // Signature(s) du générateur : `function NAME(...)` ou
      // `const NAME = (...) =>`, où NAME matche le symbole brief-de-reprise.
      // (Pas d'ancrage rigide sur un suffixe : `getRepriseBriefForUser` doit
      // être attrapé autant que `getRepriseBrief`.)
      const decls = [
        ...code.matchAll(
          /function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)/g,
        ),
        ...code.matchAll(
          /const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:async\s+)?\(([\s\S]*?)\)\s*(?::[^=]+)?=>/g,
        ),
      ]
      for (const d of decls) {
        const name = d[1]
        const params = d[2] ?? ''
        if (!REPRISE_BRIEF_SYMBOL.test(name)) continue
        if (PERSON_INPUT.test(params) && !EVENT_CONTEXT.test(params)) {
          violations.push(
            `${rel} — ${name}(${params.trim()}) : personne-en-entrée sans contexte événement`,
          )
        }
      }
      // Champ de recherche / input nominatif feeding the brief.
      if (
        /<input\b[\s\S]*?(name|placeholder)=["'][^"']*(intervenant|agent|nom|user)/i.test(code)
      ) {
        violations.push(`${rel} — <input> de recherche personne sur une surface de brief`)
      }
    }
    expect(
      violations,
      `Brief de reprise NON déclenché-événement :\n${violations.join('\n')}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Verrou 7 — Zéro persistance du brief
// ---------------------------------------------------------------------------
describe('Verrou V6.7 #7 — le brief ne s’écrit jamais en base', () => {
  const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations')
  // Doctrine V6.7 #7 : tables `*reprise*`, `*handover*`, `*person_history*`.
  // Substring (pas `\b…\b`) : `handover_briefs` doit matcher — `_` est un
  // word-char, un ancrage de mot raterait précisément le cas réel.
  const FORBIDDEN_TABLE = /(reprise|handover|person_?history|repris_?brief|brief_?reprise)/i

  it('aucune migration ne crée de table reprise/handover/person_history', () => {
    let files: string[] = []
    try {
      files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    } catch {
      files = []
    }
    const offenders: string[] = []
    for (const f of files) {
      const sql = read(join(MIGRATIONS_DIR, f))
        .split('\n')
        .filter((l) => !l.trim().startsWith('--')) // commentaires doctrinaux exclus
        .join('\n')
      const re =
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([A-Za-z0-9_]+)"?/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(sql)) !== null) {
        if (FORBIDDEN_TABLE.test(m[1])) offenders.push(`${f} → CREATE TABLE ${m[1]}`)
      }
    }
    expect(
      offenders,
      `Table de persistance de brief interdite (V6.7 #7) :\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it("aucun générateur de brief n’insère/upsert vers une table reprise/handover", () => {
    const violations: string[] = []
    for (const { rel, code } of repriseBriefFiles()) {
      if (
        /\.from\(\s*['"][^'"]*(reprise|handover|person_?history)[^'"]*['"]\s*\)/i.test(code) ||
        /\b(insert|upsert)\s*\([\s\S]{0,200}?(reprise|handover|person_?history)/i.test(code)
      ) {
        violations.push(`${rel} — écriture en base d'un brief de reprise`)
      }
    }
    expect(
      violations,
      `Brief de reprise persisté — doit être jetable (V6.7 #7) :\n${violations.join('\n')}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Verrou 8 — Seuil k = 4 (anti-ré-identification)
// ---------------------------------------------------------------------------
describe('Verrou V6.7 #8 — seuil k : sous k participants, aucun nom rendu', () => {
  const entry = (firstName: string): HumanContinuityEntry => ({
    firstName,
    firstSeenAt: '2025-01-01T00:00:00.000Z',
    lastSeenAt: '2025-06-01T00:00:00.000Z',
    spanMonths: 5,
    isCurrent: false,
  })
  const names = (n: number) =>
    Array.from({ length: n }, (_, i) => entry(`P${i + 1}`))

  it('le seuil doctrinal gravé est k = 4', () => {
    expect(CONTINUITY_K_THRESHOLD).toBe(4)
  })

  it('0 à 3 participants → lecture généralisée, zéro nom', () => {
    for (const n of [0, 1, 2, 3]) {
      const r = applyContinuityKThreshold(names(n))
      expect(r.generalized, `n=${n} doit être généralisé`).toBe(true)
      expect(r.predecessors, `n=${n} ne doit rendre aucun nom`).toEqual([])
    }
  })

  it('4 participants ou plus → libellés non navigables restitués', () => {
    for (const n of [4, 5, 9]) {
      const r = applyContinuityKThreshold(names(n))
      expect(r.generalized, `n=${n} ne doit pas être généralisé`).toBe(false)
      expect(r.predecessors).toHaveLength(n)
    }
  })

  it('k est paramétrable mais la sémantique du seuil tient (< k → généralisé)', () => {
    expect(applyContinuityKThreshold(names(2), 2).generalized).toBe(false)
    expect(applyContinuityKThreshold(names(1), 2).generalized).toBe(true)
  })

  it('ne mute pas le tableau d’entrée', () => {
    const input = names(5)
    const snapshot = [...input]
    applyContinuityKThreshold(input)
    expect(input).toEqual(snapshot)
  })
})

// ---------------------------------------------------------------------------
// Verrou 9 — Audit obligatoire de la génération du brief
// ---------------------------------------------------------------------------
describe('Verrou V6.7 #9 — toute génération de brief journalise un audit', () => {
  it('tout fichier générant un brief de reprise référence logAuditEvent', () => {
    const violations: string[] = []
    for (const { rel, code } of repriseBriefFiles()) {
      const audited =
        /\blogAuditEvent\s*\(/.test(code) || /\binsertActivityLog\s*\(/.test(code)
      if (!audited) {
        violations.push(`${rel} — génère un brief de reprise sans ligne d'audit`)
      }
    }
    expect(
      violations,
      `Brief de reprise non audité (V6.7 #9) :\n${violations.join('\n')}`,
    ).toEqual([])
  })
})
