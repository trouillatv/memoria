/** Recette du BRANCHEMENT PV/CR — simulation de run réel, AUCUNE écriture (dryRun).
 *  Reproduit EXACTEMENT ce que fait runHistoricalMemoryBuildPipeline après import :
 *  produceRelationsFromOccurrences({ siteId, triggerVisitId: siteReportId }).
 *  Prouve, avec le prompt durci actif : métriques + relations produites + direction/type corrects + 0 acteur.
 */
import { createClient } from '@supabase/supabase-js'
import { produceRelationsFromOccurrences } from '../lib/ai/produce-relations-from-occurrences'
import { getActorCanonicalIds } from '../lib/documents/occurrence-population'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function resolveOcefProd(): Promise<string> {
  // Prod = id commençant par 06c62e48 (≠ fixture recette 2c939e67). ilike sur uuid ne
  // marche pas → on filtre en JS.
  const { data } = await admin.from('sites').select('id, name').ilike('name', '%OCEF Compostage%')
  const prod = (data ?? []).find((r: Record<string, unknown>) => String(r.id).startsWith('06c62e48'))
  if (!prod) throw new Error('OCEF prod 06c62e48 introuvable')
  return prod.id as string
}

function trunc(s: string, n: number) { return s.length <= n ? s : s.slice(0, n - 1) + '…' }

async function main() {
  const siteId = await resolveOcefProd()
  const actorCs = await getActorCanonicalIds(siteId)

  // Reports (source_ref_id) réels du site, du plus récent au plus ancien
  const { data: occ } = await admin
    .from('canonical_subject_occurrence')
    .select('source_ref_id, effective_date')
    .eq('site_id', siteId).eq('source_kind', 'historical_pdf')
  const byRef = new Map<string, string>()
  for (const o of (occ ?? []) as Array<{ source_ref_id: string; effective_date: string | null }>) {
    const d = o.effective_date ?? ''
    if (!byRef.has(o.source_ref_id) || d > byRef.get(o.source_ref_id)!) byRef.set(o.source_ref_id, d)
  }
  const reports = [...byRef.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))
  console.log(`Site OCEF prod ${siteId.slice(0, 8)} · ${reports.length} PV · ${actorCs.size} acteurs\n`)

  // Simule le run sur le PV le PLUS RÉCENT (= le cas d'un nouvel import).
  const [reportId, reportDate] = reports[0]
  console.log(`══ SIMULATION IMPORT du PV le plus récent (${reportDate}, ref=${reportId.slice(0, 8)}) ══`)
  console.log(`appel identique au pipeline : produceRelationsFromOccurrences({ siteId, triggerVisitId: "${reportId.slice(0, 8)}…" })\n`)

  const r = await produceRelationsFromOccurrences({
    siteId, admin, dryRun: true, triggerVisitId: reportId,
    configOverride: { maxCandidatesPerRun: 25 },
  })
  const llm = r.candidatesEvaluated - r.sameSubjectDetected - r.skippedNoEvidence
  const trace = r.trace ?? []
  const actorInPool = trace.filter(c => actorCs.has(c.a) || actorCs.has(c.b)).length

  console.log('── MÉTRIQUES (run) ──')
  console.log(`sujets du run analysés | paires candidates=${r.totalPairs} | appels LLM≈${llm}`)
  console.log(`no_relation=${r.noRelation} | relates_to rejetés=${r.relatesTo} | suggested créées=${r.written} | same_subject=${r.sameSubjectDetected} | doublons/exist=${r.filteredExistingLink} | acteurs pool=${actorInPool} | errors=${r.errors}`)

  const written = trace.filter(c => c.decision === 'written')
  console.log(`\n── SUGGESTED qui seraient écrites (${written.length}) — vérification humaine ──`)
  for (let i = 0; i < written.length; i++) {
    const c = written[i]; const g = c.gemini!
    const srcIsA = g.direction === 'A_to_B'
    const from = srcIsA ? c.labelA : c.labelB
    const to = srcIsA ? c.labelB : c.labelA
    const ev = c.evidences[0]
    console.log(`\n[${i + 1}] « ${from} » ${g.linkType} « ${to} »  (conf=${g.confidence.toFixed(2)})`)
    console.log(`     evidence_text A: "${trunc(ev?.excerptSentA ?? '', 150)}"`)
    console.log(`     evidence_text B: "${trunc(ev?.excerptSentB ?? '', 150)}"`)
    console.log(`     source: PV ${ev?.visitDate}  |  justif: "${trunc(g.justification, 160)}"`)
    console.log(`     VERDICT HUMAIN: ______ (VALID / WRONG_DIR / WRONG_TYPE / SHOULD_NOT_EXIST)`)
  }
  if (written.length === 0) console.log('   (aucune — ce run ne touche aucune paire à dépendance prouvée)')

  console.log(`\n${actorInPool === 0 ? '✅' : '❌'} acteurs dans le pool : ${actorInPool}`)
  console.log('ℹ️  DRY-RUN : rien n\'a été écrit. Le pipeline réel écrirait ces suggested dans canonical_subject_links.')
}
main().catch((e) => { console.error(e); process.exit(1) })
