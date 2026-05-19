// =============================================================================
// Enforcement V6.7 — configurable V6/V7, protège la philosophie pas l'évolution
// =============================================================================
//
// Doctrine : docs/superpowers/doctrines/exploitation-doctrine-V6.md
//            § « Enforcement structurel V6 » + raffinements Vincent 2026-05-19.
// Journal   : docs/10_JOURNAL_DECISIONS.md, 2026-05-19.
//
// PRINCIPE GRAVÉ (autorité doctrinale 2026-05-19) :
//   « Si on change la doctrine, on le fait EXPLICITEMENT — pas en contournant
//     les tests parce qu'ils gênent. Les verrous protègent la PHILOSOPHIE
//     (anti dérive RH/surveillance), pas l'évolution produit. »
//
// Deux strates :
//
//  A. CŒUR RH/SURVEILLANCE — interdit en V6 ET V7, non négociable :
//     - route d'analyse personne : /<personne>/[id]/(performance|score|ranking|
//       classement|productivité|evaluation)
//     - table d'historique/score personnel : *_performance, *_score, *_rank…
//     - symbole de score/ranking humain : agent_score, performance_rank…
//     - générateur IA personne→analyse hors événement
//     - vocabulaire de jugement : « agent lent », « agent à risque »,
//       « classement des agents », « comparaison entre agents »
//
//  B. VUE AGENT AUTONOME — CONFIGURABLE par décision doctrinale explicite :
//       V6 (défaut)  : aucune vue agent autonome (refus V6.2)
//       V7           : vue agent autorisée SOUS CONTRAINTES — continuité
//                      opérationnelle (sites connus, contrats travaillés,
//                      interventions passées, habilitations, heures déclarées,
//                      documents, continuité terrain). JAMAIS de scoring RH.
//     Routes V7 autorisées : /agents/[id]/(operations|sites|history|contrats|
//       habilitations|heures|documents|continuite). Interdites même en V7 :
//       /agents/[id]/(performance|score|ranking) → relève du cœur A.
//
// Changer DOCTRINE_AGENT_VIEW ci-dessous = décision V7 explicite (journal +
// doctrine). Ce n'est PAS un contournement : les tests s'adaptent, le cœur A
// reste verrouillé dans les deux modes.
//
// La traçabilité opérationnelle (created_by, taken_by, assigned_to, auteur
// d'une note, clôturé par, audit, équipe d'une intervention, personne citée
// dans un événement réel) ne casse JAMAIS — garanti par la section ALLOWLIST.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  applyContinuityKThreshold,
  CONTINUITY_K_THRESHOLD,
  type HumanContinuityEntry,
} from '@/lib/db/site-cockpit'

// ───────────────────────────────────────────────────────────────────────────
// MODE DOCTRINAL — changer ici = décision doctrinale V7 explicite et tracée.
// ───────────────────────────────────────────────────────────────────────────
const DOCTRINE_AGENT_VIEW: 'V6' | 'V7' = 'V6'

const REPO_ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(p, 'utf-8')
const SCAN_DIRS = ['app', 'lib', 'services', 'components']
const SCAN_EXTS = ['.ts', '.tsx']
const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', '.turbo'])
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
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

// =============================================================================
// PATTERNS — cœur RH (A) vs vue agent (B)
// =============================================================================

const PERSON_NOUN = '(?:agents|users|people|personnes|operateurs|ressources|intervenants)'

// A. Suffixes d'analyse RH — interdits en V6 ET V7.
const RH_SUFFIX =
  '(?:performance|perf|scoring|score|ranking|rank|classement|productivit[ée]|productivity|evaluation|notation|comparaison|compare)'
const RH_PERSON_ROUTE = new RegExp(
  `/${PERSON_NOUN}/\\[[^\\]/]+\\]/(?:[^/]+/)*${RH_SUFFIX}(?:/|$)`,
  'i',
)
// B. Toute route /<personne>/[id]/… (vue agent autonome).
const PERSON_VIEW_ROUTE = new RegExp(`/${PERSON_NOUN}/\\[[^\\]/]+\\]/`, 'i')

// A. Tables d'historique/score personnel (ensemble précis, pas substring
// large). NB : une TABLE `person_history`/`agent_history` = interdit RH absolu
// (magasin d'historique personnel autonome), distinct d'une ROUTE
// `/agents/[id]/history` (vue continuité lisant des événements, autorisée V7).
const FORBIDDEN_TABLE =
  /^(?:person|persons|people|agent|user|operateur|operator)_(?:history|historique|performance|perf|score|scoring|ranking|rank|notation|evaluation)$|^(?:handover|reprise)_person$|^(?:agent|user|productivity|performance)_(?:score|rank|ranking)$/i

// A. Symbole de score/ranking HUMAIN (snake & camel). N'attrape PAS
// `opportunity_score` (AO), ni `score` seul, ni `*_by`.
const HUMAN_SCORE_SYMBOL =
  /\b(agent_score|user_score|productivity_score|performance_rank|agentScore|userScore|productivityScore|performanceRank|score_(?:agent|personne|user)|rank(?:ing)?_(?:agents?|users?|personnes?))\b/i

// A. Vocabulaire de jugement humain (code user-facing, hors commentaires).
const RH_JUDGMENT_VOCAB =
  /\bagents?\s+(?:lents?|rapides?|à\s+risque|peu\s+fiables?|fiables?|mauvais|bons?)\b|\bclassement\s+des\s+(?:agents|intervenants|personnes)\b|\bcomparaison\s+(?:entre\s+)?(?:agents|intervenants)\b|\bproductivit[ée]\s+de\s+l['’]?(?:agent|intervenant)\b/i

// A. Générateur IA personne→analyse hors événement.
const ANALYSIS_GEN_SYMBOL =
  /(?:reprise|handover)[A-Za-z]*(?:brief|analys|synth|report|eval)|(?:brief|analys|synth|report|eval)[A-Za-z]*(?:reprise|handover|person|agent)/i
const PERSON_PRIMARY_INPUT =
  /\b(user_?id|agent_?id|person_?id|user_?name|agent_?name|full_?name|nom_intervenant|searchPerson|queryPerson)\b/i
const EVENT_CONTEXT =
  /\b(event|evenement|planning|absence|depart|départ|unavailab|indispo|leave|cong[ée]|fin_?de_?mission|intervention|mission|site|contrat)\w*/i

// Verdict pur d'une route — testable indépendamment du mode courant.
type RouteVerdict = 'ok' | 'rh-forbidden' | 'v6-no-agent-view'
function agentRouteVerdict(path: string, mode: 'V6' | 'V7'): RouteVerdict {
  const p = path.endsWith('/') ? path : path + '/'
  if (RH_PERSON_ROUTE.test(p)) return 'rh-forbidden' // A : interdit V6 ET V7
  if (PERSON_VIEW_ROUTE.test(p)) return mode === 'V6' ? 'v6-no-agent-view' : 'ok'
  return 'ok'
}

function appRouteDirs(): string[] {
  const dirs: string[] = []
  function collect(dir: string) {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (IGNORE_DIRS.has(name)) continue
      const full = join(dir, name)
      try {
        if (!statSync(full).isDirectory()) continue
      } catch {
        continue
      }
      dirs.push('/' + relative(REPO_ROOT, full).replace(/\\/g, '/'))
      collect(full)
    }
  }
  collect(join(REPO_ROOT, 'app'))
  return dirs
}

// =============================================================================
// A — CŒUR RH/SURVEILLANCE : interdit en V6 ET V7 (non négociable)
// =============================================================================
describe('V6.7 cœur RH — interdit dans les deux modes', () => {
  it('aucune route /<personne>/[id]/(performance|score|ranking|productivité…)', () => {
    const offenders = appRouteDirs().filter((d) => RH_PERSON_ROUTE.test(d + '/'))
    expect(
      offenders,
      `Route personne-sujet de scoring RH (cœur A) :\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('aucune table d’historique/score personnel', () => {
    const dir = join(REPO_ROOT, 'supabase', 'migrations')
    let files: string[] = []
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.sql'))
    } catch {
      files = []
    }
    const offenders: string[] = []
    for (const f of files) {
      const sql = read(join(dir, f))
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
      const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([A-Za-z0-9_]+)"?/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(sql)) !== null) {
        if (FORBIDDEN_TABLE.test(m[1])) offenders.push(`${f} → CREATE TABLE ${m[1]}`)
      }
    }
    expect(offenders, `Table RH personnelle interdite :\n${offenders.join('\n')}`).toEqual([])
  })

  it('aucun symbole de score/ranking humain ni vocabulaire de jugement', () => {
    const violations: string[] = []
    for (const abs of sourceFiles()) {
      const rel = relative(REPO_ROOT, abs).replace(/\\/g, '/')
      if (rel === SELF) continue
      let lines: string[]
      try {
        lines = read(abs).split('\n')
      } catch {
        continue
      }
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
        if (HUMAN_SCORE_SYMBOL.test(lines[i]) || RH_JUDGMENT_VOCAB.test(lines[i])) {
          violations.push(`${rel}:${i + 1} — ${t.slice(0, 90)}`)
        }
      }
    }
    expect(violations, `Score/jugement humain interdit :\n${violations.join('\n')}`).toEqual([])
  })

  it('aucun générateur IA personne→analyse hors événement', () => {
    const violations: string[] = []
    for (const abs of sourceFiles()) {
      const rel = relative(REPO_ROOT, abs).replace(/\\/g, '/')
      if (rel === SELF) continue
      let code: string
      try {
        code = stripComments(read(abs))
      } catch {
        continue
      }
      const decls = [
        ...code.matchAll(/function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)/g),
        ...code.matchAll(
          /const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:async\s+)?\(([\s\S]*?)\)\s*(?::[^=]+)?=>/g,
        ),
      ]
      for (const d of decls) {
        if (!ANALYSIS_GEN_SYMBOL.test(d[1])) continue
        const params = d[2] ?? ''
        if (PERSON_PRIMARY_INPUT.test(params) && !EVENT_CONTEXT.test(params)) {
          violations.push(`${rel} — ${d[1]}(${params.trim()}) : personne→analyse sans événement`)
        }
      }
    }
    expect(violations, `Générateur personne→analyse hors événement :\n${violations.join('\n')}`).toEqual([])
  })
})

// =============================================================================
// B — VUE AGENT AUTONOME : configurable V6 / V7
// =============================================================================
describe(`V6.7 vue agent — mode doctrinal = ${DOCTRINE_AGENT_VIEW}`, () => {
  it(`routes /<personne>/[id]/… conformes au mode ${DOCTRINE_AGENT_VIEW}`, () => {
    const offenders = appRouteDirs()
      .map((d) => ({ d, v: agentRouteVerdict(d, DOCTRINE_AGENT_VIEW) }))
      .filter((x) => x.v !== 'ok')
      .map((x) => `${x.d} → ${x.v}`)
    expect(
      offenders,
      `Mode ${DOCTRINE_AGENT_VIEW} : vue agent non conforme. ` +
        `En V6 toute route /<personne>/[id]/… est refusée (V6.2). Pour ouvrir, ` +
        `passer DOCTRINE_AGENT_VIEW='V7' via une décision doctrinale tracée :\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('le verdict pur respecte la doctrine (V6 ferme, V7 ouvre sauf RH)', () => {
    // Cœur RH : interdit dans LES DEUX modes.
    for (const m of ['V6', 'V7'] as const) {
      expect(agentRouteVerdict('/app/x/agents/[id]/performance', m)).toBe('rh-forbidden')
      expect(agentRouteVerdict('/app/x/agents/[id]/score', m)).toBe('rh-forbidden')
      expect(agentRouteVerdict('/app/x/agents/[id]/ranking', m)).toBe('rh-forbidden')
    }
    // Continuité opérationnelle : refusée V6, autorisée V7.
    for (const suffix of ['operations', 'sites', 'history', 'contrats', 'habilitations', 'documents']) {
      expect(agentRouteVerdict(`/app/x/agents/[id]/${suffix}`, 'V6')).toBe('v6-no-agent-view')
      expect(agentRouteVerdict(`/app/x/agents/[id]/${suffix}`, 'V7')).toBe('ok')
    }
    // Lieu/événement : jamais une vue personne, ok dans les deux modes.
    for (const m of ['V6', 'V7'] as const) {
      expect(agentRouteVerdict('/app/(dashboard)/interventions/[id]/page', m)).toBe('ok')
      expect(agentRouteVerdict('/app/(dashboard)/sites/[id]/history', m)).toBe('ok')
    }
  })
})

// =============================================================================
// Verrou 8 — Seuil k = 4 (inchangé : fonction pure, zéro faux positif)
// =============================================================================
describe('V6.7 #8 — seuil k : sous k participants, aucun nom rendu', () => {
  const entry = (firstName: string): HumanContinuityEntry => ({
    firstName,
    firstSeenAt: '2025-01-01T00:00:00.000Z',
    lastSeenAt: '2025-06-01T00:00:00.000Z',
    spanMonths: 5,
    isCurrent: false,
  })
  const names = (n: number) => Array.from({ length: n }, (_, i) => entry(`P${i + 1}`))

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
  it('k paramétrable, sémantique du seuil tient (< k → généralisé)', () => {
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

// =============================================================================
// ALLOWLIST — la traçabilité opérationnelle ne casse JAMAIS le build
// =============================================================================
describe('V6.7 — ALLOWLIST : traçabilité opérationnelle toujours autorisée', () => {
  const LEGIT_CODE = `
    const row = { created_by: userId, taken_by: agentId, assigned_to: teamLeadId,
      validated_by: managerId, done_by: workerId, skipped_by: userId,
      closed_by: userId, assigned_team_id: teamId, author_id: noteAuthorId }
    await logAuditEvent({ userId, entityType: 'site', action: 'updated' })
    await insertActivityLog({ userId, entityType: 'mission', action: 'closed' })
    const note = { content: 'Note de Joseph', author: 'Joseph', created_by: jId }
    const participants = await listParticipantsOfIntervention(interventionId)
    const team = intervention.assigned_team_id
    const opp = tender.opportunity_score   // score d'un AO, pas d'une personne
    function getRepriseBrief(planningEvent: AbsenceEvent, siteId: string) { return {} }
  `
  const LEGIT_TABLES = [
    'activity_logs', 'intervention_access_events', 'team_members',
    'intervention_participants', 'site_notes', 'interventions',
    'audit_log', 'tender_analyses', 'engagement_proofs', 'user_sessions',
  ]
  const LEGIT_ROUTES = [
    '/app/(dashboard)/interventions/[id]/page',
    '/app/(dashboard)/sites/[id]/history',
    '/app/(dashboard)/contracts/[id]/history',
    '/app/p/[token]/page',
  ]

  it('created_by/taken_by/assigned_to/audit/opportunity_score → 0 violation cœur', () => {
    expect(HUMAN_SCORE_SYMBOL.test(LEGIT_CODE)).toBe(false)
    expect(RH_JUDGMENT_VOCAB.test(LEGIT_CODE)).toBe(false)
  })

  it('générateur événement-first (planningEvent) ne déclenche pas le cœur #4', () => {
    const decls = [...LEGIT_CODE.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)/g)]
    const flagged = decls.filter(
      (d) =>
        ANALYSIS_GEN_SYMBOL.test(d[1]) &&
        PERSON_PRIMARY_INPUT.test(d[2] ?? '') &&
        !EVENT_CONTEXT.test(d[2] ?? ''),
    )
    expect(flagged).toEqual([])
  })

  it('tables opérationnelles légitimes → jamais traitées comme RH', () => {
    const wrongly = LEGIT_TABLES.filter((t) => FORBIDDEN_TABLE.test(t))
    expect(wrongly, `Tables légitimes faussement bloquées : ${wrongly}`).toEqual([])
  })

  it('routes lieu/événement → ok dans les deux modes', () => {
    for (const m of ['V6', 'V7'] as const) {
      const wrongly = LEGIT_ROUTES.filter((r) => agentRouteVerdict(r, m) !== 'ok')
      expect(wrongly, `Routes légitimes faussement bloquées (${m}) : ${wrongly}`).toEqual([])
    }
  })
})
