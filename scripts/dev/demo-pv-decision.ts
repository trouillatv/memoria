// Démontre le LOOP DÉCISION (table 125) : Ignorer un bloquant le LÈVE du gate
// SANS toucher la mémoire ; Annuler le réactive. Aller-retour (état restauré).
// Distinct de demo-pv-resolver (qui, lui, CORRIGE la mémoire). Lecture/écriture
// bornée à pv_signal_decisions. Usage : npx tsx scripts/dev/demo-pv-decision.ts [reportId]

import { readFileSync } from 'node:fs'
function loadEnvLocal() {
  try {
    const content = readFileSync('.env.local', 'utf-8')
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* déjà exportées */ }
}
loadEnvLocal()

import { createAdminClient } from '@/lib/supabase/admin'
import { buildPvValidation } from '@/lib/documents/pv-validation'
import { upsertPvSignalDecision, clearPvSignalDecision } from '@/lib/db/pv-signal-decisions'

async function findReport(explicitId?: string): Promise<string | null> {
  const sb = createAdminClient()
  const ids = explicitId
    ? [explicitId]
    : (await sb.from('site_reports').select('id, created_at').not('site_id', 'is', null)
        .order('created_at', { ascending: false }).limit(8)).data?.map((r) => r.id as string) ?? []
  for (const id of ids) {
    const pv = await buildPvValidation(id)
    if (pv?.gaps.some((g) => g.niveau === 'bloquant')) return id
  }
  return null
}

async function main() {
  const reportId = await findReport(process.argv[2])
  if (!reportId) { console.log('Aucune réunion avec un bloquant à démontrer.'); return }

  const before = await buildPvValidation(reportId)
  const gap = before!.gaps.find((g) => g.niveau === 'bloquant')!
  console.log(`Réunion ${reportId}`)
  console.log(`\n① AVANT — durs=${before!.durs} · PDF ${before!.blocking ? 'BLOQUÉ' : 'OK'}`)
  console.log(`   signal ciblé : 🔴 ${gap.libelle}  (id: ${gap.id})`)

  console.log(`\n② IGNORER (décision, AUCUNE écriture mémoire) …`)
  await upsertPvSignalDecision({ reportId, signalId: gap.id, statut: 'ignored', comment: 'démo' })

  const after = await buildPvValidation(reportId)
  const ann = after!.gaps.find((g) => g.id === gap.id)
  console.log(`\n③ APRÈS — durs=${after!.durs} (était ${before!.durs}) · PDF ${after!.blocking ? 'BLOQUÉ' : 'OK'}`)
  console.log(`   décision portée par le signal : ${ann?.decision?.statut ?? 'aucune'}  → levé du gate : ${after!.durs < before!.durs ? '✅' : '— (autres bloquants restants)'}`)

  console.log(`\n④ ANNULER la décision …`)
  await clearPvSignalDecision(reportId, gap.id)
  const restored = await buildPvValidation(reportId)
  console.log(`   durs=${restored!.durs} (retour à ${before!.durs}) · décision : ${restored!.gaps.find((g) => g.id === gap.id)?.decision?.statut ?? 'aucune'}`)

  console.log(`\nLoop décision vérifié : Ignorer lève le gate sans toucher la mémoire ; Annuler restaure. Aucune donnée laissée modifiée.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
