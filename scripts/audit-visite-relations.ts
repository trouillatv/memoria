/** Audit READ-ONLY — visite terrain comme canal de preuve relationnelle. AUCUNE écriture.
 *  1. Matière réelle : occurrences field_visit par site (visites, sujets, richesse note).
 *  2. Structure cooccurrence : un pair field_visit atteint-il jamais cooc≥3 (seuil actuel) ?
 *  3. RECALL : phrases de dépendance explicites présentes dans la matière visite.
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

// Marqueurs de dépendance explicite (proxy recall)
const DEP_RE = /(d[ée]pend|n[ée]cessite|impossible tant que|tant qu[e']|avant de |avant la |apr[eè]s validation|apr[eè]s la validation|une fois que|conditionn[ée]|pr[ée]alable|bloque|bloqu[ée]|emp[eê]che|permettra|permet de|ne peut pas .* tant que|ne pourra|subordonn[ée]|en attente de|requiert)/i

async function main() {
  const line = '═'.repeat(84)

  // ── Global : field_visit occurrences ──────────────────────────────────────
  const { data: fv, count } = await sb
    .from('canonical_subject_occurrence')
    .select('site_id, canonical_subject_id, source_ref_id, label, note, effective_date', { count: 'exact' })
    .eq('source_kind', 'field_visit')
  const rows = (fv ?? []) as Array<Record<string, unknown>>
  console.log(`${line}\nOCCURRENCES field_visit (tout le dépôt) = ${count}\n${line}`)

  const { data: sites } = await sb.from('sites').select('id, name')
  const siteName = new Map((sites ?? []).map((s: Record<string, unknown>) => [s.id as string, s.name as string]))

  // Par site
  const bySite = new Map<string, Array<Record<string, unknown>>>()
  for (const r of rows) {
    const s = r.site_id as string
    if (!bySite.has(s)) bySite.set(s, [])
    bySite.get(s)!.push(r)
  }

  let totalDepPhrases = 0
  const depExamples: string[] = []

  for (const [siteId, occs] of [...bySite.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const visits = new Set(occs.map(o => o.source_ref_id))
    const subjects = new Set(occs.map(o => o.canonical_subject_id))
    const withNote = occs.filter(o => o.note && String(o.note).trim().length > 0)
    const avgNoteLen = withNote.length ? Math.round(withNote.reduce((a, o) => a + String(o.note).length, 0) / withNote.length) : 0

    // cooccurrence field_visit-only : un pair de sujets partagé par ≥ N visites
    const visitToSubj = new Map<string, Set<string>>()
    for (const o of occs) {
      const v = o.source_ref_id as string
      if (!visitToSubj.has(v)) visitToSubj.set(v, new Set())
      visitToSubj.get(v)!.add(o.canonical_subject_id as string)
    }
    const pairVisits = new Map<string, number>()
    for (const subj of visitToSubj.values()) {
      const arr = [...subj]
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const k = arr[i] < arr[j] ? `${arr[i]}|${arr[j]}` : `${arr[j]}|${arr[i]}`
        pairVisits.set(k, (pairVisits.get(k) ?? 0) + 1)
      }
    }
    const pairsCooc3 = [...pairVisits.values()].filter(n => n >= 3).length

    console.log(`\n${siteName.get(siteId) ?? siteId.slice(0, 8)} (${siteId.slice(0, 8)})`)
    console.log(`  occurrences field_visit=${occs.length} | visites distinctes=${visits.size} | sujets=${subjects.size}`)
    console.log(`  avec note=${withNote.length} (longueur moy. ${avgNoteLen} car.) | paires field_visit atteignant cooc≥3 = ${pairsCooc3}`)

    // recall : phrases de dépendance dans label/note
    for (const o of occs) {
      const txt = `${o.label ?? ''} — ${o.note ?? ''}`
      if (DEP_RE.test(txt)) {
        totalDepPhrases++
        if (depExamples.length < 12) depExamples.push(`[${siteName.get(siteId) ?? siteId.slice(0, 6)}] « ${txt.slice(0, 160)} »`)
      }
    }
  }

  // ── RECALL global ─────────────────────────────────────────────────────────
  console.log(`\n${line}\nRECALL — phrases de dépendance explicite dans la matière field_visit\n${line}`)
  console.log(`occurrences field_visit contenant un marqueur de dépendance = ${totalDepPhrases} / ${count}`)
  for (const e of depExamples) console.log(`  • ${e}`)
  if (totalDepPhrases === 0) console.log('  (aucune — soit corpus visite trop mince, soit dépendances non exprimées dans la note)')

  // ── Comparaison : même scan sur historical_pdf (référence) ────────────────
  const { data: pv } = await sb.from('canonical_subject_occurrence')
    .select('label, note').eq('source_kind', 'historical_pdf').limit(5000)
  const pvRows = (pv ?? []) as Array<Record<string, unknown>>
  const pvDep = pvRows.filter(o => DEP_RE.test(`${o.label ?? ''} — ${o.note ?? ''}`)).length
  console.log(`\n(référence) historical_pdf contenant un marqueur de dépendance = ${pvDep} / ${pvRows.length}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
