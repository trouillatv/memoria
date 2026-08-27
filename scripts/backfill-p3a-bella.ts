/**
 * P3-A — Backfill contrôlé des 2 observations orphelines de Bella Napoli VIA LE MÉCANISME P3-B1.
 *
 * N'utilise PAS d'INSERT spécifiques : appelle ensureHistoricalPdfOccurrences (le même chemin que
 * les futurs imports), désormais éligible aux observations significatives. Snapshot → run → vérif →
 * rollback auto si un invariant critique échoue.
 *
 * Cibles : 2024 « Registre de sécurité … non renseigné » ; 2025 « Largeur de passage … réduite ».
 *
 * Usage : npx tsx --env-file=.env.local scripts/backfill-p3a-bella.ts        (dry-run : n'écrit pas)
 *         npx tsx --env-file=.env.local scripts/backfill-p3a-bella.ts --apply (écrit)
 */

import { createClient } from '@supabase/supabase-js'
import { ensureHistoricalPdfOccurrences } from '../lib/db/canonical-subject-historical-occurrence'

const SITE = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const APPLY = process.argv.includes('--apply')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sep = (l: string) => console.log(`\n${'─'.repeat(64)}\n${l}\n${'─'.repeat(64)}`)

async function occSnapshot() {
  const { data } = await sb.from('canonical_subject_occurrence')
    .select('id, canonical_subject_id, source_ref_id, source_kind, effective_date, label')
    .eq('site_id', SITE)
  return data ?? []
}
async function actorLinkSnapshot(occIds: string[]) {
  if (occIds.length === 0) return []
  const { data } = await sb.from('canonical_subject_occurrence_actor_link')
    .select('id, occurrence_id, actor_subject_id, relation_type').in('occurrence_id', occIds)
  return data ?? []
}

async function main() {
  console.log(APPLY ? '⚠️  MODE APPLY — écriture réelle' : 'DRY-RUN (ajouter --apply pour écrire)')

  // Runs + rapports + date d'effet (dérivée d'une occurrence existante du même rapport).
  const { data: reports } = await sb.from('site_reports').select('id, extraction_run_id').eq('site_id', SITE).not('extraction_run_id', 'is', null)
  const runs: { runId: string; reportId: string; date: string }[] = []
  for (const r of reports ?? []) {
    const { data: anyOcc } = await sb.from('canonical_subject_occurrence')
      .select('effective_date').eq('source_ref_id', r.id).eq('source_kind', 'historical_pdf').limit(1).maybeSingle()
    if (anyOcc?.effective_date) runs.push({ runId: r.extraction_run_id as string, reportId: r.id as string, date: anyOcc.effective_date as string })
  }
  console.log('Runs à rejouer :', runs.map(r => `${r.date}`).join(', '))

  // ── SNAPSHOT ─────────────────────────────────────────────────────────────────
  const before = await occSnapshot()
  const beforeIds = new Set(before.map(o => o.id))
  const beforeLinks = await actorLinkSnapshot(before.map(o => o.id))
  const beforeLinkKeys = new Set(beforeLinks.map(l => `${l.occurrence_id}|${l.actor_subject_id}|${l.relation_type}`))
  const { count: suggBefore } = await sb.from('canonical_subject_similarity_suggestion').select('id', { count: 'exact', head: true }).eq('site_id', SITE)
  console.log(`Snapshot : ${before.length} occurrences, ${beforeLinks.length} liens acteur, ${suggBefore ?? 0} suggestions.`)

  if (!APPLY) { console.log('\nDRY-RUN : rien écrit. Relancer avec --apply.'); return }

  // ── RUN (mécanisme générique) ────────────────────────────────────────────────
  sep('Exécution ensureHistoricalPdfOccurrences (2 runs)')
  for (const r of runs) {
    const res = await ensureHistoricalPdfOccurrences({ runId: r.runId, siteId: SITE, siteReportId: r.reportId, visitDate: r.date })
    console.log(`  run ${r.date} → created=${res.created} skipped=${res.skipped} errors=${res.errors}`)
  }

  // ── VÉRIFICATION ─────────────────────────────────────────────────────────────
  sep('Vérification des invariants')
  const after = await occSnapshot()
  const newOcc = after.filter(o => !beforeIds.has(o.id))
  const afterLinks = await actorLinkSnapshot(after.map(o => o.id))
  const newLinks = afterLinks.filter(l => !beforeLinkKeys.has(`${l.occurrence_id}|${l.actor_subject_id}|${l.relation_type}`))
  const { count: suggAfter } = await sb.from('canonical_subject_similarity_suggestion').select('id', { count: 'exact', head: true }).eq('site_id', SITE)

  const csIds = [...new Set(newOcc.map(o => o.canonical_subject_id))]
  const { data: csRows } = await sb.from('canonical_subject').select('id, label, kind, status, merged_into').in('id', csIds)
  const csMap = new Map((csRows ?? []).map(c => [c.id, c]))

  const checks: { name: string; ok: boolean; detail: string }[] = []
  // 1. exactement 2 nouvelles occurrences
  checks.push({ name: '2 nouvelles occurrences', ok: newOcc.length === 2, detail: `${newOcc.length} créée(s)` })
  // 2. ce sont bien Registre + Largeur
  const labels = newOcc.map(o => (csMap.get(o.canonical_subject_id)?.label ?? o.label)).sort()
  const isRegistre = labels.some(l => /registre/i.test(l))
  const isLargeur = labels.some(l => /largeur/i.test(l))
  checks.push({ name: 'cibles = Registre + Largeur', ok: isRegistre && isLargeur, detail: labels.join(' | ') })
  // 3. provenance/kind/date corrects
  for (const o of newOcc) {
    const cs = csMap.get(o.canonical_subject_id)
    const dateExpected = runs.find(r => r.reportId === o.source_ref_id)?.date
    checks.push({
      name: `provenance « ${(cs?.label ?? '').slice(0, 32)} »`,
      ok: o.source_kind === 'historical_pdf' && !!o.source_ref_id && o.effective_date === dateExpected && cs?.kind === 'business_subject',
      detail: `kind=${cs?.kind} date=${o.effective_date} src=${o.source_ref_id?.slice(0, 8)} channel=${o.source_kind}`,
    })
  }
  // 4. chaque cible a EXACTEMENT 1 occurrence
  for (const csId of csIds) {
    const n = after.filter(o => o.canonical_subject_id === csId).length
    checks.push({ name: `1 occurrence pour « ${(csMap.get(csId)?.label ?? '').slice(0, 32)} »`, ok: n === 1, detail: `${n}` })
  }
  // 5. aucune occurrence en trop hors les 2 (les 6 couvertes intactes)
  checks.push({ name: 'aucune occurrence surnuméraire', ok: after.length === before.length + 2, detail: `${before.length} → ${after.length}` })
  // 6. aucun nouveau lien acteur (pas d'absorption acteur)
  checks.push({ name: 'aucun nouveau lien acteur', ok: newLinks.length === 0, detail: `${newLinks.length} nouveau(x)` })
  // 7. aucune suggestion/fusion déclenchée
  checks.push({ name: 'aucun rapprochement déclenché', ok: (suggAfter ?? 0) === (suggBefore ?? 0), detail: `${suggBefore} → ${suggAfter}` })
  // 8. aucune fusion (kind business, non mergé)
  const noMerge = (csRows ?? []).every(c => c.status === 'active' && !c.merged_into && c.kind === 'business_subject')
  checks.push({ name: 'cibles actives, business, non fusionnées', ok: noMerge, detail: (csRows ?? []).map(c => `${c.status}/${c.kind}`).join(', ') })

  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.name} — ${c.detail}`)
  const allOk = checks.every(c => c.ok)

  if (!allOk) {
    sep('❌ INVARIANT ÉCHOUÉ → ROLLBACK')
    if (newLinks.length) await sb.from('canonical_subject_occurrence_actor_link').delete().in('id', newLinks.map(l => l.id))
    if (newOcc.length) await sb.from('canonical_subject_occurrence').delete().in('id', newOcc.map(o => o.id))
    console.log(`Rollback : ${newOcc.length} occurrence(s) + ${newLinks.length} lien(s) supprimés. État restauré.`)
    process.exit(1)
  }
  sep('✅ BACKFILL VALIDÉ — tous les invariants tenus, aucune écriture hors périmètre.')
}

main().catch((e) => { console.error(e); process.exit(1) })
