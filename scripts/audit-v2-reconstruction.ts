/** Dry-run V2 (READ-ONLY, aucune écriture) — reconstruction de la conservation de preuve relationnelle.
 *  Simule : SI on capturait la phrase source relationnelle (depuis debrief.summary + proposition.body)
 *  et l'attachait au niveau report/occurrence, combien de PAIRES DE SUJETS réelles obtiendraient une
 *  preuve cit-able ? (= ce que V3 pourrait consommer, aujourd'hui 0 via cooc≥3).
 *  Mesure : phrases relationnelles ; couvrant 0 / 1 / ≥2 sujets ; paires-preuves ; >2 sujets ; taille.
 */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const REL = /(d[ée]pend|n[ée]cessite|impossible (?:de |tant)|tant qu[e']|avant (?:de |la |le |d')|apr[eè]s (?:validation|la |le |l')|une fois que|conditionn[ée]|pr[ée]alable|bloqu|emp[êe]ch|permet(?:tra|tre|)? (?:de|le|la)|ne peut(?:vent)? pas|ne pourra|en attente (?:de|d')|requiert|doit être (?:termin|fait|valid|fini)|en remplacement|remplac|suite à|d[ûu] à|faute de|sous r[ée]serve)/i
const STOP = new Set(['dans','pour','avec','sans','sous','les','des','une','due','sur','aux','par','est','sont','sera','entre','leur','cette','plan','zone','point','points','general','générale','complet','chantier','travaux','realise','réalisé'])

function norm(s: string) { return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() }
function tokens(s: string) { return norm(s).split(' ').filter(t => t.length >= 5 && !STOP.has(t)) }
function sentences(txt: string) { return txt.split(/(?<=[.!?;\n])\s+/).map(s => s.trim()).filter(s => s.length > 12) }
// un sujet est "couvert" si ≥1 token distinctif de son label apparaît dans la phrase
function covers(sentTokens: Set<string>, label: string) { const lt = tokens(label); return lt.length > 0 && lt.some(t => sentTokens.has(t)) }

async function main() {
  const { data: fv } = await sb.from('canonical_subject_occurrence').select('site_id').eq('source_kind', 'field_visit')
  const siteIds = [...new Set((fv ?? []).map((o: Record<string, unknown>) => o.site_id as string))]
  const { data: sitesRows } = await sb.from('sites').select('id, name')
  const nameOf = new Map((sitesRows ?? []).map((s: Record<string, unknown>) => [s.id as string, s.name as string]))

  let relTotal = 0, cover0 = 0, cover1 = 0, cover2 = 0, coverN = 0, pairProofs = 0, sizeSum = 0
  const examples: string[] = []

  for (const siteId of siteIds) {
    // sujets business (labels) — on exclut les acteurs par company_id/contact_id
    const { data: cs } = await sb.from('canonical_subject').select('id, label, company_id, contact_id').eq('site_id', siteId).eq('status', 'active')
    const subjLabels = new Map<string, string>()
    for (const c of (cs ?? []) as Array<Record<string, unknown>>) if (!c.company_id && !c.contact_id) subjLabels.set(c.id as string, c.label as string)

    const { data: occ } = await sb.from('canonical_subject_occurrence').select('source_ref_id, canonical_subject_id').eq('site_id', siteId).eq('source_kind', 'field_visit')
    const reportSubjects = new Map<string, Set<string>>()
    for (const o of (occ ?? []) as Array<Record<string, unknown>>) {
      const r = o.source_ref_id as string; const cid = o.canonical_subject_id as string
      if (!subjLabels.has(cid)) continue
      if (!reportSubjects.has(r)) reportSubjects.set(r, new Set())
      reportSubjects.get(r)!.add(cid)
    }

    for (const [reportId, subjIds] of reportSubjects) {
      const { data: rep } = await sb.from('site_reports').select('debrief_analysis').eq('id', reportId).maybeSingle()
      const da = ((rep as Record<string, unknown>)?.debrief_analysis ?? {}) as Record<string, unknown>
      const { data: props } = await sb.from('site_knowledge_proposals').select('body, title').eq('report_id', reportId)
      const src = [
        da.summary,
        ...((da.actions as Array<Record<string, unknown>> ?? []).map(a => a.rationale)),
        ...((props ?? []) as Array<Record<string, unknown>>).map(p => `${p.title ?? ''}. ${p.body ?? ''}`),
      ].filter(Boolean).map(String).join('\n')

      const rel = sentences(src).filter(s => REL.test(s))
      const seen = new Set<string>()
      for (const s of rel) {
        const key = norm(s).slice(0, 80)
        if (seen.has(key)) continue; seen.add(key) // dédup intra-report
        relTotal++; sizeSum += s.length
        const st = new Set(tokens(s))
        const covered = [...subjIds].filter(id => covers(st, subjLabels.get(id)!))
        if (covered.length === 0) cover0++
        else if (covered.length === 1) cover1++
        else if (covered.length === 2) { cover2++; pairProofs++ }
        else { coverN++; pairProofs++ }
        if (covered.length >= 2 && examples.length < 14) {
          examples.push(`[${nameOf.get(siteId)}] (${covered.length} sujets) « ${s.slice(0, 150)} »`)
        }
      }
    }
  }

  const line = '━'.repeat(80)
  console.log(`${line}\nDRY-RUN V2 — reconstruction preuve relationnelle (proof-store simulé)\n${line}`)
  console.log(`phrases relationnelles (dédupliquées) = ${relTotal}`)
  console.log(`  couvrant 0 sujet du report = ${cover0}   (contexte, pas de paire)`)
  console.log(`  couvrant 1 sujet          = ${cover1}   (sujet→action/contexte : hors périmètre sujet↔sujet)`)
  console.log(`  couvrant 2 sujets         = ${cover2}   ← PAIRE-PREUVE (V3 candidat cooc=1)`)
  console.log(`  couvrant >2 sujets        = ${coverN}   (preuve multi-sujets, à décomposer en paires)`)
  console.log(`  ═> PAIRES-PREUVES cit-ables = ${pairProofs}  (aujourd'hui via cooc≥3 → 0)`)
  console.log(`taille moyenne phrase = ${relTotal ? Math.round(sizeSum / relTotal) : 0} car.`)
  console.log(`\nExemples de paires-preuves (à lire) :`)
  for (const e of examples) console.log(`  • ${e}`)
}
main().catch(e => { console.error(e); process.exit(1) })
