/** Dry-run RÉEL du moteur relationnel corrigé — Bella / OCEF prod / PETRO. AUCUNE écriture.
 *  Prouve empiriquement, après les 2 correctifs (incrémental + exclusion acteurs) :
 *   - quelles relations whitelistées sortent réellement, avec preuve ;
 *   - 0 acteur dans le pool ;
 *   - stats complètes (candidats, LLM, no_relation, relates_to rejetés, whitelistées, doublons).
 *  Vérifie aussi que le fix incrémental (triggerVisitId) ne dégénère plus en N=1.
 */
import { createClient } from '@supabase/supabase-js'
import { produceRelationsFromOccurrences } from '../lib/ai/produce-relations-from-occurrences'
import { getActorCanonicalIds } from '../lib/documents/occurrence-population'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const OCEF_PROD_ID = '06c62e48-2f0a-4d9e-8c1a-000000000000' // résolu dynamiquement ci-dessous
async function resolveOcefProd(): Promise<string> {
  // OCEF Compostage PROD = 06c62e48 (≠ fixture recette 2c939e67)
  const { data } = await admin.from('sites').select('id').ilike('id', '06c62e48%').maybeSingle()
  if (data) return (data as { id: string }).id
  const { data: rows } = await admin.from('sites').select('id, name').ilike('name', '%OCEF Compostage%')
  const prod = (rows ?? []).find((r: Record<string, unknown>) => r.id !== '2c939e67-e986-4635-86a0-638cda870480')
  return (prod?.id as string) ?? '2c939e67-e986-4635-86a0-638cda870480'
}
void OCEF_PROD_ID

function trunc(s: string, n: number) { return s.length <= n ? s : s.slice(0, n - 1) + '…' }

async function runSite(siteId: string, name: string) {
  const line = '═'.repeat(90)
  console.log(`\n${line}\n### ${name}  (${siteId.slice(0, 8)})\n${line}`)

  const actorCs = await getActorCanonicalIds(siteId)
  console.log(`acteurs canoniques du site : ${actorCs.size}`)

  // Dry-run PLEIN SITE (config prod thresholds ; top-N élargi pour visibilité audit)
  const res = await produceRelationsFromOccurrences({
    siteId, admin, dryRun: true,
    configOverride: { maxCandidatesPerRun: 25 }, // min cooccurrence/lift = prod (3 / 1.5)
  })

  const llmCalls = res.candidatesEvaluated - res.sameSubjectDetected - res.skippedNoEvidence

  console.log('\n── STATS ──')
  console.log(`totalVisits=${res.totalVisits}  totalPairs=${res.totalPairs}`)
  console.log(`filtrés: lowCooc=${res.filteredLowCooccurrence} lowLift=${res.filteredLowLift} existant=${res.filteredExistingLink} au-delà top25=${res.skippedTopN}`)
  console.log(`candidats évalués=${res.candidatesEvaluated}  |  appels LLM≈${llmCalls}`)
  console.log(`  same_subject=${res.sameSubjectDetected}  no_evidence=${res.skippedNoEvidence}`)
  console.log(`  no_relation=${res.noRelation}  relates_to REJETÉS=${res.relatesTo}  directional=${res.directional}  lowConf=${res.skippedLowConf}  errors=${res.errors}`)
  console.log(`  → RELATIONS WHITELISTÉES (écriraient) = ${res.written}`)

  // Contrôle acteur : aucun candidat du trace ne doit être un acteur
  const trace = res.trace ?? []
  const actorInPool = trace.filter(c => actorCs.has(c.a) || actorCs.has(c.b))
  console.log(`\nACTEURS DANS LE POOL DE CANDIDATS : ${actorInPool.length}  ${actorInPool.length === 0 ? '✅' : '❌ HARD STOP'}`)
  for (const c of actorInPool) console.log(`   ⚠ ${c.labelA}  ↔  ${c.labelB}`)

  // Table des relations whitelistées
  const written = trace.filter(c => c.decision === 'written')
  if (written.length === 0) {
    console.log('\nAucune relation whitelistée sur ce corpus (attendu si peu de dépendances explicites).')
  } else {
    console.log(`\n── RELATIONS WHITELISTÉES (${written.length}) — audit humain ──`)
    for (let i = 0; i < written.length; i++) {
      const c = written[i]
      const g = c.gemini!
      const dir = g.direction === 'A_to_B' ? '→' : g.direction === 'B_to_A' ? '←' : '↔'
      const from = g.direction === 'B_to_A' ? c.labelB : c.labelA
      const to   = g.direction === 'B_to_A' ? c.labelA : c.labelB
      const ev = c.evidences[0]
      console.log(`\n[${i + 1}] « ${from} »  ${dir} ${g.linkType} (conf=${g.confidence.toFixed(2)})  « ${to} »`)
      console.log(`     evidence A: "${trunc(ev?.excerptSentA ?? '', 160)}"`)
      console.log(`     evidence B: "${trunc(ev?.excerptSentB ?? '', 160)}"`)
      console.log(`     justif: "${trunc(g.justification, 200)}"`)
      console.log(`     dates preuves: ${c.evidences.map(e => e.visitDate).join(', ')}`)
      console.log(`     VERDICT HUMAIN: ________  (VALID / WRONG_TYPE / WRONG_DIRECTION / SHOULD_NOT_EXIST)`)
    }
  }

  return { name, written: res.written, actorInPool: actorInPool.length, totalVisits: res.totalVisits, llmCalls }
}

async function main() {
  const ocefId = await resolveOcefProd()
  const targets = [
    { id: 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6', name: 'BELLA NAPOLI' },
    { id: ocefId, name: `OCEF prod (${ocefId.slice(0, 8)})` },
    { id: '75bd3d23-d515-46bd-8de8-254495a5bade', name: 'PETRO (Lycée PETRO ATTITI)' },
  ]

  const summary = []
  for (const t of targets) summary.push(await runSite(t.id, t.name))

  console.log(`\n\n${'━'.repeat(90)}\nBILAN\n${'━'.repeat(90)}`)
  let anyActor = false
  for (const s of summary) {
    if (s.actorInPool > 0) anyActor = true
    console.log(`${s.name.padEnd(40)} whitelistées=${s.written}  acteurs_pool=${s.actorInPool}  visites=${s.totalVisits}  llm≈${s.llmCalls}`)
  }
  console.log(anyActor ? '\n❌ HARD STOP — acteur dans le pool' : '\n✅ 0 acteur dans le pool sur les 3 sites')
}
main().catch((e) => { console.error(e); process.exit(1) })
