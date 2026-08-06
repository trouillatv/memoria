/**
 * Audit — canonical subjects affichant « Aucune occurrence »
 *
 * Pour un site donné, identifie les canonical_subjects actifs qui n'ont
 * aucune entrée dans canonical_subject_occurrence ET n'ont pas de proposition
 * PDF rattachée via subject_thread_identity.
 *
 * Classe chaque sujet vide :
 *   true_empty   — aucun signal en base (peut être masqué sans risque)
 *   thread_only  — a des threads mais zéro proposition PDF matérialisée
 *                  → potentiel trou du read-model
 *   unknown      — a des threads et des propositions mais pas d'occurrence
 *                  → getCanonicalSubjectLife ne les remonte pas (bug probable)
 *
 * Usage : npx tsx scripts/audit-subjects-sans-occurrences.ts [SITE_NAME_ILIKE]
 * Exemple : npx tsx scripts/audit-subjects-sans-occurrences.ts compost
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

import { createAdminClient } from '../lib/supabase/admin'

const sb = createAdminClient()
const siteFilter = process.argv[2] ?? 'compost'

async function main() {
  // 1. Site cible
  const { data: sites } = await sb.from('sites').select('id, name').ilike('name', `%${siteFilter}%`).is('deleted_at', null)
  const site = (sites ?? [])[0] as { id: string; name: string } | undefined
  if (!site) { console.error(`Aucun site trouvé pour le filtre : ${siteFilter}`); process.exit(1) }
  const siteId = site.id
  console.log(`\n══ Audit sujets vides — ${site.name} ══\n`)

  // 2. Canonical subjects actifs
  const { data: csData } = await sb.from('canonical_subject').select('id, label, created_at').eq('site_id', siteId).eq('status', 'active')
  const subjects = (csData ?? []) as Array<{ id: string; label: string; created_at: string }>
  console.log(`Sujets actifs : ${subjects.length}`)

  // 3. Occurrences natives par sujet
  const { data: nativeData } = await sb.from('canonical_subject_occurrence').select('canonical_subject_id').eq('site_id', siteId)
  const withNative = new Set((nativeData ?? []).map((o: { canonical_subject_id: string }) => o.canonical_subject_id))

  // 4. Threads par sujet
  const { data: threadData } = await sb.from('subject_thread_identity').select('subject_thread_id, canonical_subject_id').eq('site_id', siteId)
  const threads = (threadData ?? []) as Array<{ subject_thread_id: string; canonical_subject_id: string }>
  const threadsByCs = new Map<string, string[]>()
  for (const t of threads) {
    if (!threadsByCs.has(t.canonical_subject_id)) threadsByCs.set(t.canonical_subject_id, [])
    threadsByCs.get(t.canonical_subject_id)!.push(t.subject_thread_id)
  }

  // 5. Propositions PDF par thread (batch)
  const allThreadIds = threads.map((t) => t.subject_thread_id)
  const withProposal = new Set<string>()
  if (allThreadIds.length > 0) {
    for (let i = 0; i < allThreadIds.length; i += 300) {
      const chunk = allThreadIds.slice(i, i + 300)
      const { data } = await sb
        .from('document_extraction_proposal')
        .select('subject_thread_id')
        .in('subject_thread_id', chunk)
        .not('document_status', 'is', null)  // au moins une proposition avec statut
      for (const p of (data ?? []) as Array<{ subject_thread_id: string }>) {
        withProposal.add(p.subject_thread_id)
      }
    }
  }

  // 6. Classification des sujets sans occurrence native
  const empty = subjects.filter((s) => !withNative.has(s.id))
  console.log(`Sujets sans occurrence native : ${empty.length} / ${subjects.length} (${Math.round(100 * empty.length / Math.max(1, subjects.length))} %)\n`)

  const trueEmpty: string[] = []
  const threadOnly: string[] = []
  const unknown: string[] = []

  for (const s of empty) {
    const csThreads = threadsByCs.get(s.id) ?? []
    if (csThreads.length === 0) {
      trueEmpty.push(s.label)
    } else {
      const hasAnyProposal = csThreads.some((tid) => withProposal.has(tid))
      if (!hasAnyProposal) {
        threadOnly.push(s.label)
      } else {
        unknown.push(s.label)
      }
    }
  }

  console.log(`── true_empty (aucun signal, masquable sans risque) : ${trueEmpty.length}`)
  for (const l of trueEmpty.slice(0, 10)) console.log(`   • ${l.slice(0, 80)}`)
  if (trueEmpty.length > 10) console.log(`   ... et ${trueEmpty.length - 10} autres`)

  console.log(`\n── thread_only (threads mais 0 proposition PDF) : ${threadOnly.length}`)
  for (const l of threadOnly.slice(0, 10)) console.log(`   • ${l.slice(0, 80)}`)
  if (threadOnly.length > 10) console.log(`   ... et ${threadOnly.length - 10} autres`)

  console.log(`\n── unknown (propositions PDF mais pas d'occurrence — trou probable du read-model) : ${unknown.length}`)
  for (const l of unknown.slice(0, 20)) console.log(`   ⚠ ${l.slice(0, 80)}`)
  if (unknown.length > 20) console.log(`   ... et ${unknown.length - 20} autres`)

  console.log(`\n══ Résumé ══`)
  console.log(`  ${withNative.size} sujets avec ≥ 1 occurrence native (displayable)`)
  console.log(`  ${trueEmpty.length} sujets true_empty → masquables`)
  console.log(`  ${threadOnly.length} sujets thread_only → inoffensifs mais à surveiller`)
  console.log(`  ${unknown.length} sujets avec propositions mais sans occurrence → à investiguer\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
