/** Dry-run V3 — voie explicite depuis subject_relational_evidence. READ-ONLY, AUCUNE écriture.
 *  Chaîne : preuves V2 (≥2 sujets) → paires bornées → MÊME juge durci (qualifyLinkCandidate)
 *  → whitelist serveur simulée → ce qui serait écrit en canonical_subject_links suggested.
 *  La table V2 étant vide (se remplit aux futures visites), on reconstruit les preuves par la
 *  MÊME extraction pure que le module de capture V2 (fidèle au comportement prod).
 */
import { createClient } from '@supabase/supabase-js'
import { extractRelationalEvidence, type RelSource, type RelSubject } from '../lib/db/subject-relational-evidence'
import { qualifyLinkCandidate, type CandidatePair } from '../lib/ai/qualify-link-candidates'
import { getActorCanonicalIds } from '../lib/documents/occurrence-population'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const WHITELIST = new Set(['requires', 'enables', 'validates', 'causes', 'replaces'])
const MAX_SUBJECTS_PER_EVIDENCE = 4 // au-delà = sur-appariement probable → on n'énumère pas

function pairKey(a: string, b: string) { return a < b ? `${a}|${b}` : `${b}|${a}` }

async function main() {
  const { data: fv } = await sb.from('canonical_subject_occurrence').select('site_id').eq('source_kind', 'field_visit')
  const siteIds = [...new Set((fv ?? []).map((o: Record<string, unknown>) => o.site_id as string))]

  // 1. Reconstruire les preuves V2 (≥2 sujets) par site/report
  interface Cand { siteId: string; reportId: string; a: string; b: string; labelA: string; labelB: string; evidence: string }
  const cands: Cand[] = []
  let evTotal = 0, ev2 = 0
  const seenPairEvidence = new Set<string>()

  for (const siteId of siteIds) {
    const actorCs = await getActorCanonicalIds(siteId)
    const { data: cs } = await sb.from('canonical_subject').select('id, label, company_id, contact_id').eq('site_id', siteId).eq('status', 'active')
    const allSubjects = (cs ?? []).filter((c: Record<string, unknown>) => !c.company_id && !c.contact_id && !actorCs.has(c.id as string))
    const labelOf = new Map(allSubjects.map((c: Record<string, unknown>) => [c.id as string, c.label as string]))
    const { data: occ } = await sb.from('canonical_subject_occurrence').select('source_ref_id, canonical_subject_id').eq('site_id', siteId).eq('source_kind', 'field_visit')
    const reportIds = [...new Set((occ ?? []).map((o: Record<string, unknown>) => o.source_ref_id as string))]

    for (const reportId of reportIds) {
      const inReport = new Set((occ ?? []).filter((o: Record<string, unknown>) => o.source_ref_id === reportId).map((o: Record<string, unknown>) => o.canonical_subject_id as string))
      const subjects: RelSubject[] = allSubjects.filter((c: Record<string, unknown>) => inReport.has(c.id as string)).map((c: Record<string, unknown>) => ({ id: c.id as string, label: c.label as string }))
      const { data: rep } = await sb.from('site_reports').select('debrief_analysis').eq('id', reportId).maybeSingle()
      const da = ((rep as Record<string, unknown>)?.debrief_analysis ?? {}) as Record<string, unknown>
      const { data: props } = await sb.from('site_knowledge_proposals').select('id, title, body').eq('report_id', reportId)
      const sources: RelSource[] = [
        { text: String(da.summary ?? '') },
        ...((da.actions as Array<Record<string, unknown>> ?? []).map((a) => ({ text: String(a.rationale ?? '') }))),
        ...((props ?? []) as Array<Record<string, unknown>>).map((p) => ({ text: `${p.title ?? ''}. ${p.body ?? ''}`, sourceProposalId: p.id as string })),
      ]
      const evidences = extractRelationalEvidence(sources, subjects)
      for (const e of evidences) {
        evTotal++
        if (e.subjectIds.length < 2) continue
        ev2++
        if (e.subjectIds.length > MAX_SUBJECTS_PER_EVIDENCE) continue // borne
        // paires bornées : toutes les paires de la preuve (n≤4 → ≤6 paires), dédupliquées globalement
        for (let i = 0; i < e.subjectIds.length; i++) for (let j = i + 1; j < e.subjectIds.length; j++) {
          const a = e.subjectIds[i], b = e.subjectIds[j]
          const k = `${reportId}:${pairKey(a, b)}:${e.evidenceText.slice(0, 30)}`
          if (seenPairEvidence.has(k)) continue; seenPairEvidence.add(k)
          cands.push({ siteId, reportId, a, b, labelA: labelOf.get(a)!, labelB: labelOf.get(b)!, evidence: e.evidenceText })
        }
      }
    }
  }

  console.log('════════ DRY-RUN V3 — voie explicite (READ-ONLY, aucune écriture) ════════\n')
  console.log(`preuves V2 reconstruites = ${evTotal} | avec ≥2 sujets = ${ev2} | paires candidates bornées = ${cands.length}`)

  // 2. Soumettre chaque paire au MÊME juge durci (l'evidence = la phrase reliant A et B)
  let llm = 0, noRel = 0, relatesRejected = 0, written = 0, actorInPool = 0
  const suggested: Array<{ from: string; to: string; type: string; conf: number; evidence: string; report: string }> = []
  for (const c of cands) {
    const pair: CandidatePair = {
      csIdA: c.a, labelA: c.labelA, famA: 'observation',
      csIdB: c.b, labelB: c.labelB, famB: 'observation',
      countA: 1, countB: 1, countAB: 1, N: 1, lift: 1.0, confAB: 1.0, confBA: 1.0,
      evidence: [{ runId: c.reportId, runDate: '', excerptA: c.evidence, excerptB: c.evidence, proposalIdA: '', proposalIdB: '' }],
    }
    llm++
    const r = await qualifyLinkCandidate(pair)
    if (!r || r.linkType === 'no_relation') { noRel++; continue }
    if (!WHITELIST.has(r.linkType)) { relatesRejected++; continue }
    written++
    const srcIsA = r.direction === 'A_to_B'
    suggested.push({ from: srcIsA ? c.labelA : c.labelB, to: srcIsA ? c.labelB : c.labelA, type: r.linkType, conf: r.confidence, evidence: c.evidence, report: c.reportId })
  }

  console.log(`\nappels juge=${llm} | no_relation=${noRel} | relates_to rejetés=${relatesRejected} | SUGGESTED (écriraient)=${written} | acteurs pool=${actorInPool}`)
  console.log(`\n── SUGGESTED — vérification humaine obligatoire ──`)
  for (let i = 0; i < suggested.length; i++) {
    const s = suggested[i]
    console.log(`\n[${i + 1}] « ${s.from} » ${s.type} « ${s.to} »  (conf=${s.conf.toFixed(2)})`)
    console.log(`     evidence_text: "${s.evidence.slice(0, 180)}"`)
    console.log(`     source: visite ${s.report.slice(0, 8)}`)
    console.log(`     VERDICT: ______ (VALID / WRONG_DIR / WRONG_TYPE / INSUFFICIENT / SHOULD_NOT_EXIST)`)
  }
  if (suggested.length === 0) console.log('   (aucune — corpus visite ne porte pas encore de dépendance sujet↔sujet prouvée)')
}
main().catch((e) => { console.error(e); process.exit(1) })
