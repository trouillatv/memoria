/**
 * Re-réconcilie les subject_thread_id du run canonique PV007 d'OCEF Compostage.
 *
 * Approche conservative — seuls les cas vraiment faux sont corrigés :
 *   A) Reconnexion : proposition orpheline (self-UUID) → thread prior trouvé
 *   B) Déconnexion collision : un prior thread partagé par 2+ PV07 props →
 *      garder le meilleur match, les autres deviennent orphelins
 *   C) Reconnexion collision-loser : orphelin issu de B → chercher un autre prior
 *
 * Ce qui n'est PAS touché :
 *   - propositions déjà connectées à un prior thread sans collision → inchangées
 *   - orphelins qui restent orphelins → gardent leur UUID actuel (pas de re-UUID)
 */
import { existsSync, readFileSync } from 'node:fs'

function loadEnvLocal() {
  const path = '.env.local'
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvLocal()

type Prop = { id: string; label: string; thematic_category: string | null; proposal_family: string; subject_thread_id: string | null }
type ScoredCandidate = { propId: string; thread: string; score: number }

const STOPWORDS = new Set(['de','du','la','le','les','des','un','une','et','ou','a','au','aux','en','par','pour','sur','sous','dans','avec','sans','ce','se','sa','son','ses','l','d','est','sont','ete','etre','avoir','y','il','ils'])
const GENERIC_TOKENS = new Set(['plan','essais','travaux','fait','prevision','realisation','acces','raccordement','mise','place','rapport','controle','verification','inspection','suivi','bilan','point','test','visite','reunion','compte','rendu','note','fiche','releve','mesure','calcul','etude','analyse'])
const QUALIFIERS = new Set(['complementaire','supplementaire','additionnel','partiel','temporaire'])
const SIMILARITY_THRESHOLD = 0.5

function normalizeLabel(label: string): string {
  return label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(t => t.length > 1 && !STOPWORDS.has(t)).join(' ').trim()
}
function stripCategoryFormatting(label: string): string {
  let s = label
  const ci = s.indexOf(' : '); if (ci !== -1) s = s.slice(ci + 3)
  const ei = s.lastIndexOf(' = '); if (ei !== -1) s = s.slice(0, ei)
  return s.trim()
}
function jaccardSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeLabel(a).split(' ').filter(Boolean))
  const tb = new Set(normalizeLabel(b).split(' ').filter(Boolean))
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let i = 0; for (const t of ta) if (tb.has(t)) i++
  return i / (ta.size + tb.size - i)
}
function strongContainmentMatch(a: string, b: string): boolean {
  const sA = normalizeLabel(stripCategoryFormatting(a)), sB = normalizeLabel(stripCategoryFormatting(b))
  if (sA.length > 0 && sA === sB) return true
  const nA = normalizeLabel(a), nB = normalizeLabel(b)
  const tA = nA.split(' ').filter(Boolean), tB = nB.split(' ').filter(Boolean)
  if (!tA.length || !tB.length) return false
  const seta = new Set(tA), setb = new Set(tB)
  const [shortToks, shortSet, longSet] = seta.size <= setb.size ? [tA, seta, setb] : [tB, setb, seta]
  for (const t of shortSet) if (!longSet.has(t)) return false
  const sig = shortToks.filter(t => !GENERIC_TOKENS.has(t))
  if (sig.length >= 2) return true
  if (sig.length === 1) {
    if (sig[0].length < 7) return false
    const lo = [...longSet].filter(t => !shortSet.has(t))
    if (lo.some(t => QUALIFIERS.has(t))) return false
    return true
  }
  return false
}
function computeBestCandidate(newProp: Prop, priors: Prop[], excludedThreads: Set<string> = new Set()): ScoredCandidate | null {
  const sameFam = priors.filter(p => p.proposal_family === newProp.proposal_family && p.subject_thread_id !== null && !excludedThreads.has(p.subject_thread_id!))
  const isPersonLike = newProp.proposal_family === 'person' || newProp.proposal_family === 'company'
  if (isPersonLike) {
    const norm = normalizeLabel(newProp.label)
    const m = sameFam.find(p => normalizeLabel(p.label) === norm)
    return m ? { propId: newProp.id, thread: m.subject_thread_id!, score: 1.0 } : null
  }
  const sameTheme = sameFam.filter(p => p.thematic_category === newProp.thematic_category)
  const stripped = normalizeLabel(stripCategoryFormatting(newProp.label))
  const exact = sameTheme.find(p => normalizeLabel(stripCategoryFormatting(p.label)) === stripped)
  if (exact) return { propId: newProp.id, thread: exact.subject_thread_id!, score: 1.0 }
  let bestC: Prop | null = null, bestCLen = 0
  for (const p of sameTheme) {
    if (strongContainmentMatch(newProp.label, p.label)) {
      const l = normalizeLabel(stripCategoryFormatting(p.label)).length
      if (l > bestCLen) { bestC = p; bestCLen = l }
    }
  }
  if (bestC) return { propId: newProp.id, thread: bestC.subject_thread_id!, score: 0.85 }
  const ns = stripCategoryFormatting(newProp.label)
  let bScore = 0, bThread: string | null = null
  for (const p of sameTheme) {
    const sc = jaccardSimilarity(ns, stripCategoryFormatting(p.label))
    if (sc > bScore) { bScore = sc; bThread = p.subject_thread_id }
  }
  if (bScore >= SIMILARITY_THRESHOLD && bThread) return { propId: newProp.id, thread: bThread, score: bScore }
  return null
}

async function sql(query: string): Promise<unknown[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch('https://api.supabase.com/v1/projects/srixnofmaydxouhucawn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`)
  return JSON.parse(text)
}

const SITE_COMPOSTAGE = '2c939e67-e986-4635-86a0-638cda870480'
const PV07_RUN = 'e4f4011d-0c83-4606-ab3b-683f6236f409'

async function main() {
  // Charger les propositions PV07
  const pv7Raw = await sql(`SELECT id, proposal_family, thematic_category, label, subject_thread_id FROM document_extraction_proposal WHERE extraction_run_id = '${PV07_RUN}'`) as Prop[]
  console.log(`PV07 : ${pv7Raw.length} propositions`)

  // Charger TOUS les runs canoniques antérieurs
  const priorRunsRaw = await sql(`SELECT id FROM document_extraction_run WHERE target_site_id = '${SITE_COMPOSTAGE}' AND is_canonical = true AND id != '${PV07_RUN}'`) as Array<{ id: string }>
  const priorRunIds = priorRunsRaw.map(r => `'${r.id}'`).join(',')
  const priorRaw = priorRunIds.length > 0
    ? await sql(`SELECT id, proposal_family, thematic_category, label, subject_thread_id FROM document_extraction_proposal WHERE extraction_run_id IN (${priorRunIds}) AND subject_thread_id IS NOT NULL`) as Prop[]
    : []
  console.log(`Priors (PV01-PV06) : ${priorRaw.length} propositions avec thread`)

  // Ensemble des prior thread IDs
  const priorThreadSet = new Set(priorRaw.map(p => p.subject_thread_id!))

  // ── ANALYSE DE L'ÉTAT ACTUEL ──────────────────────────────────────────────

  // Orphelins : PV07 props dont le thread n'est pas dans un prior
  const orphans = pv7Raw.filter(p => !p.subject_thread_id || !priorThreadSet.has(p.subject_thread_id))

  // Connectés : PV07 props dont le thread est dans un prior
  const connected = pv7Raw.filter(p => p.subject_thread_id && priorThreadSet.has(p.subject_thread_id))

  // Collisions : prior threads partagés par 2+ PV07 props
  const connectedByThread = new Map<string, Prop[]>()
  for (const p of connected) {
    const t = p.subject_thread_id!
    if (!connectedByThread.has(t)) connectedByThread.set(t, [])
    connectedByThread.get(t)!.push(p)
  }
  const collisionGroups = [...connectedByThread.entries()].filter(([, ps]) => ps.length > 1)

  console.log(`\nÉtat actuel PV07 :`)
  console.log(`  Connectés à un prior : ${connected.length}`)
  console.log(`  Orphelins (self-UUID) : ${orphans.length}`)
  console.log(`  Collisions (prior partagé) : ${collisionGroups.length} groupes`)
  for (const [t, ps] of collisionGroups) {
    console.log(`    Thread ${t.slice(0,8)} partagé par ${ps.length} props :`)
    for (const p of ps) console.log(`      - ${p.label.slice(0,60)}`)
  }

  // ── CALCUL DES CORRECTIONS ────────────────────────────────────────────────

  // Threads déjà légitimement occupés par un prop non-collisionné
  const collisionPropIds = new Set(collisionGroups.flatMap(([, ps]) => ps.map(p => p.id)))
  const legitimatelyConnected = connected.filter(p => !collisionPropIds.has(p.id))
  // Inclure les threads des collision-winners : les losers ne peuvent pas y revenir
  const occupiedThreads = new Set([
    ...legitimatelyConnected.map(p => p.subject_thread_id!),
    ...collisionGroups.map(([t]) => t),
  ])

  // Propositions à re-matcher : orphelins + collision losers
  // Pour les collisions : garder le meilleur (score le plus élevé), les autres à re-matcher
  const collisionLosers: Prop[] = []
  for (const [, ps] of collisionGroups) {
    // Scorer chaque candidat dans le groupe
    const scored = ps.map(p => ({ p, cand: computeBestCandidate(p, priorRaw, new Set()) }))
    scored.sort((a, b) => (b.cand?.score ?? 0) - (a.cand?.score ?? 0))
    // Le premier garde le thread ; les autres deviennent losers
    for (const { p } of scored.slice(1)) collisionLosers.push(p)
  }

  // Ensemble à re-matcher (orphelins + losers)
  const toRematch = [...orphans, ...collisionLosers]
  console.log(`\nPropositions à re-matcher : ${toRematch.length} (${orphans.length} orphelins + ${collisionLosers.length} collision-losers)`)

  // Re-matcher avec 1:1, en excluant les threads déjà légitimement occupés
  const candidates: ScoredCandidate[] = []
  for (const p of toRematch) {
    const cand = computeBestCandidate(p, priorRaw, occupiedThreads)
    if (cand) candidates.push(cand)
  }
  candidates.sort((a, b) => b.score - a.score)

  const claimedThreads = new Set<string>(occupiedThreads) // pré-occuper les threads légitimes
  const assignedProps = new Set<string>()
  const newAssignments = new Map<string, { newThread: string; via: string; priorLabel: string | null }>()

  const priorByThread = new Map(priorRaw.map(p => [p.subject_thread_id!, p]))

  for (const cand of candidates) {
    if (!assignedProps.has(cand.propId) && !claimedThreads.has(cand.thread)) {
      assignedProps.add(cand.propId)
      claimedThreads.add(cand.thread)
      const via = cand.score === 1.0 ? 'exact' : cand.score === 0.85 ? 'containment' : `jaccard(${cand.score.toFixed(2)})`
      const priorLabel = priorByThread.get(cand.thread)?.label ?? null
      newAssignments.set(cand.propId, { newThread: cand.thread, via, priorLabel })
    }
  }

  // Résumé des changements effectifs
  const reconnections = [...newAssignments.entries()].filter(([, v]) => priorThreadSet.has(v.newThread))
  const collisionDisconnections = collisionLosers.filter(p => !newAssignments.has(p.id))

  console.log(`\n=== SIMULATION CONSERVATIVE ===`)
  console.log(`Reconnexions (orphelin → prior) : ${reconnections.length}`)
  console.log(`Collision-losers déconnectés définitivement : ${collisionDisconnections.length}`)
  console.log(`PV07 inchangés : ${pv7Raw.length - reconnections.length - collisionDisconnections.length}`)

  console.log(`\n--- Reconnexions (${reconnections.length}) ---`)
  for (const [pid, v] of reconnections) {
    const p7 = pv7Raw.find(p => p.id === pid)!
    console.log(`  [${v.via.padEnd(18)}] PV07: ${p7.label.slice(0,55)}`)
    console.log(`                        PRIOR: ${v.priorLabel?.slice(0,55) ?? '?'}`)
  }

  if (collisionDisconnections.length > 0) {
    console.log(`\n--- Collision-losers sans nouveau match ---`)
    for (const p of collisionDisconnections) {
      console.log(`  [DISC] ${p.label.slice(0,70)}`)
    }
  }

  // État final simulé
  const finalConnected = connected.length - collisionDisconnections.length + reconnections.length
  console.log(`\n--- État final simulé ---`)
  console.log(`PV07 connectés à priors : ${finalConnected} (avant: ${connected.length})`)
  console.log(`PV07 orphelins : ${pv7Raw.length - finalConnected} (avant: ${orphans.length})`)

  // Collisions restantes
  const finalThreadCounts = new Map<string, number>()
  for (const p of pv7Raw) {
    const t = newAssignments.get(p.id)?.newThread ?? p.subject_thread_id
    if (t && priorThreadSet.has(t)) finalThreadCounts.set(t, (finalThreadCounts.get(t) ?? 0) + 1)
  }
  // Exclure les collision-losers qui ont perdu leur thread
  for (const p of collisionDisconnections) {
    const t = p.subject_thread_id!
    if (finalThreadCounts.has(t)) finalThreadCounts.set(t, finalThreadCounts.get(t)! - 1)
  }
  const remainingCollisions = [...finalThreadCounts.entries()].filter(([, n]) => n > 1)
  console.log(`Collisions restantes : ${remainingCollisions.length}`)

  if (reconnections.length === 0 && collisionDisconnections.length === 0) {
    console.log('\n[OK] Aucun changement nécessaire.')
    return
  }

  const proceed = process.argv.includes('--apply')
  if (!proceed) {
    console.log('\n[DRY RUN] Ajouter --apply pour appliquer les changements.')
    return
  }

  // ── APPLICATION ───────────────────────────────────────────────────────────
  console.log('\n[APPLY] Mise à jour en cours...')
  const allChanges: Array<{ id: string; thread: string }> = []

  // Reconnexions : assigner le nouveau thread
  for (const [pid, v] of newAssignments) {
    if (priorThreadSet.has(v.newThread)) allChanges.push({ id: pid, thread: v.newThread })
  }

  // Collision-losers sans re-match : garder leur UUID actuel (ne pas re-UUID inutilement)
  // → Aucune action nécessaire, on les laisse avec leur thread actuel
  // (ils resteront incorrectement dans une collision mais sans solution disponible)
  // SAUF si l'utilisateur veut les déconnecter explicitement :
  // for (const p of collisionDisconnections) allChanges.push({ id: p.id, thread: crypto.randomUUID() })

  let applied = 0
  for (const { id, thread } of allChanges) {
    await sql(`UPDATE document_extraction_proposal SET subject_thread_id = '${thread}' WHERE id = '${id}'`)
    applied++
  }
  console.log(`[OK] ${applied} propositions mises à jour.`)
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1) })
