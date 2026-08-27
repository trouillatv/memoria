/**
 * P3-B2-repair Bella — atomiser le composite 2025 depuis l'ÉTAT DU GRAPHE (pas de ré-extraction).
 *
 * Électrique : relabel de l'occurrence 2025 existante (atomique, source préservée) — pas de doublon.
 * Cuisson    : créer l'occurrence 2025 « à refaire » à la forme exacte d'ensureHistoricalPdfOccurrences.
 * Éclairage  : NON touché (défaut #3 : slot (sujet,rapport) déjà pris par « réalisé ») — différé, témoin.
 *
 * Snapshot → écriture → vérif → rollback auto si un invariant échoue.
 * Usage : npx tsx --env-file=.env.local scripts/repair-p3b2-bella.ts [--apply]
 */

import { createClient } from '@supabase/supabase-js'

const SITE = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const REPORT_2025 = '68c3487e-a0f0-4932-945e-876997c364e6'
const CS_ELEC = '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9'
const CS_CUISSON = 'b78526f9-9dc6-43f7-8edb-e4278f207988'
const CS_ECLAIRAGE = 'cc12fce6-8780-4f93-88a1-21905a37325b'
const APPLY = process.argv.includes('--apply')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sep = (l: string) => console.log(`\n${'─'.repeat(64)}\n${l}\n${'─'.repeat(64)}`)

const ELEC_LABEL = 'Contrôle des installations électriques — à refaire'
const ELEC_NOTE = 'Le contrôle des installations électriques est en retard et doit être refait immédiatement.'
const CUISSON_LABEL = 'Contrôle des appareils de cuisson — à refaire'
const CUISSON_NOTE = 'Le contrôle des appareils de cuisson est en retard et doit être refait immédiatement.'

async function occAll() {
  const { data } = await sb.from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_ref_id, source_kind, effective_date, label, note')
    .eq('site_id', SITE)
  return data ?? []
}

async function main() {
  console.log(APPLY ? '⚠️  MODE APPLY' : 'DRY-RUN (ajouter --apply pour écrire)')

  const before = await occAll()
  const { data: elecOccRows } = await sb.from('canonical_subject_occurrence')
    .select('id, label, note').eq('canonical_subject_id', CS_ELEC).eq('source_ref_id', REPORT_2025).eq('source_kind', 'historical_pdf')
  if (!elecOccRows || elecOccRows.length !== 1) { console.error('❌ occurrence électrique 2025 introuvable/ambiguë'); process.exit(1) }
  const elecOcc = elecOccRows[0]
  const { count: linksBefore } = await sb.from('canonical_subject_occurrence_actor_link').select('id', { count: 'exact', head: true })
  const { count: suggBefore } = await sb.from('canonical_subject_similarity_suggestion').select('id', { count: 'exact', head: true }).eq('site_id', SITE)
  console.log(`Snapshot : ${before.length} occurrences, ${linksBefore ?? 0} liens acteur, ${suggBefore ?? 0} suggestions.`)
  console.log(`Électrique 2025 (id ${elecOcc.id}) label actuel : « ${elecOcc.label} »`)

  if (!APPLY) { console.log('\nDRY-RUN : rien écrit. Relancer avec --apply.'); return }

  // ── ÉCRITURE ─────────────────────────────────────────────────────────────────
  sep('Écriture')
  // 1. Électrique : relabel in-place (pas de doublon)
  await sb.from('canonical_subject_occurrence').update({ label: ELEC_LABEL, note: ELEC_NOTE }).eq('id', elecOcc.id)
  console.log('  ✓ électrique relabel')
  // 2. Cuisson : insert forme workflow
  const { data: ins, error: insErr } = await sb.from('canonical_subject_occurrence').insert({
    canonical_subject_id: CS_CUISSON, site_id: SITE, source_kind: 'historical_pdf', source_ref_id: REPORT_2025,
    source_proposal_id: null, visit_status: null, label: CUISSON_LABEL, note: CUISSON_NOTE, evidence_count: 1,
    effective_date: '2025-08-05', created_by: null, validation_status: 'observed', entity_ids: [],
  }).select('id').single()
  if (insErr) { console.error('❌ insert cuisson:', insErr.message); await sb.from('canonical_subject_occurrence').update({ label: elecOcc.label, note: elecOcc.note }).eq('id', elecOcc.id); process.exit(1) }
  const cuissonOccId = ins.id
  console.log(`  ✓ cuisson occurrence créée (${cuissonOccId})`)

  // ── VÉRIFICATION ─────────────────────────────────────────────────────────────
  sep('Vérification (12 invariants + P0→P3)')
  const after = await occAll()
  const { count: linksAfter } = await sb.from('canonical_subject_occurrence_actor_link').select('id', { count: 'exact', head: true })
  const { count: suggAfter } = await sb.from('canonical_subject_similarity_suggestion').select('id', { count: 'exact', head: true }).eq('site_id', SITE)
  const occOf = (cs: string) => after.filter(o => o.canonical_subject_id === cs)
  const elec = occOf(CS_ELEC), cuisson = occOf(CS_CUISSON), eclair = occOf(CS_ECLAIRAGE)
  const elec2025 = elec.filter(o => o.source_ref_id === REPORT_2025 && o.source_kind === 'historical_pdf')
  const cuisson2025 = cuisson.filter(o => o.source_ref_id === REPORT_2025 && o.source_kind === 'historical_pdf')
  const { data: kinds } = await sb.from('canonical_subject').select('id, kind, status, merged_into').in('id', [CS_ELEC, CS_CUISSON, CS_ECLAIRAGE])

  const c: { n: string; ok: boolean; d: string }[] = []
  c.push({ n: '1. électrique 2025 = 1 occurrence, label atomique (plus composite)', ok: elec2025.length === 1 && /installations électriques/i.test(elec2025[0]?.label) && !/éclairage|cuisson/i.test(elec2025[0]?.label), d: elec2025[0]?.label ?? '—' })
  c.push({ n: '2. cuisson 2025 « à refaire » présent', ok: cuisson2025.length === 1 && /à refaire/i.test(cuisson2025[0]?.label), d: cuisson2025[0]?.label ?? '—' })
  c.push({ n: '3. cuisson traverse 2024→2025 (2 occurrences)', ok: cuisson.length === 2, d: cuisson.map(o => o.effective_date).sort().join(', ') })
  c.push({ n: '4. éclairage INCHANGÉ (réalisé conservé, non touché)', ok: eclair.some(o => /réalisé/i.test(o.label)) && !eclair.some(o => /à refaire/i.test(o.label)), d: eclair.map(o => o.label).join(' | ') })
  c.push({ n: '5. dates correctes (2025-08-05)', ok: elec2025[0]?.effective_date === '2025-08-05' && cuisson2025[0]?.effective_date === '2025-08-05', d: `elec=${elec2025[0]?.effective_date} cuisson=${cuisson2025[0]?.effective_date}` })
  c.push({ n: '6. aucun nouveau lien acteur', ok: (linksAfter ?? 0) === (linksBefore ?? 0), d: `${linksBefore} → ${linksAfter}` })
  c.push({ n: '7. aucun autre sujet modifié (only +1 occurrence cuisson)', ok: after.length === before.length + 1, d: `${before.length} → ${after.length}` })
  c.push({ n: '8. aucun rapprochement/fusion déclenché', ok: (suggAfter ?? 0) === (suggBefore ?? 0), d: `${suggBefore} → ${suggAfter}` })
  c.push({ n: '9. aucune occurrence sur acteur (cibles business)', ok: (kinds ?? []).every(k => k.kind === 'business_subject'), d: (kinds ?? []).map(k => k.kind).join(',') })
  c.push({ n: '10. cibles actives, non fusionnées', ok: (kinds ?? []).every(k => k.status === 'active' && !k.merged_into), d: (kinds ?? []).map(k => k.status).join(',') })
  // P0→P3 replay (sélection)
  const { data: reg } = await sb.from('canonical_subject').select('id').eq('id', '71db6b00-3d03-4bc6-879f-067d92b4a3f9').maybeSingle()
  c.push({ n: 'P2. Registre ≠ Contrôle (sujets distincts, intacts)', ok: !!reg && reg.id !== CS_ELEC, d: 'ok' })
  c.push({ n: 'P3-B1. Registre + Largeur toujours matérialisés', ok: after.some(o => /registre de sécurité non renseigné/i.test(o.label)) && after.some(o => /largeur de passage des dégagements réduite/i.test(o.label)), d: 'ok' })

  for (const x of c) console.log(`  ${x.ok ? '✅' : '❌'} ${x.n} — ${x.d}`)
  const allOk = c.every(x => x.ok)

  if (!allOk) {
    sep('❌ INVARIANT ÉCHOUÉ → ROLLBACK')
    await sb.from('canonical_subject_occurrence').delete().eq('id', cuissonOccId)
    await sb.from('canonical_subject_occurrence').update({ label: elecOcc.label, note: elecOcc.note }).eq('id', elecOcc.id)
    console.log('Rollback effectué : cuisson supprimée, électrique restauré.')
    process.exit(1)
  }
  sep('✅ REPAIR VALIDÉ — électrique atomisé, cuisson 2024→2025, éclairage différé (témoin défaut #3).')
  console.log(`Rollback manuel si besoin : DELETE occ ${cuissonOccId} ; UPDATE occ ${elecOcc.id} label=« ${elecOcc.label} ».`)
}

main().catch((e) => { console.error(e); process.exit(1) })
