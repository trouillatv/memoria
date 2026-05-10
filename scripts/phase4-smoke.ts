/**
 * scripts/phase4-smoke.ts
 *
 * Smoke test programmatique du flow Phase 4 — Cross-tender matching.
 *
 * Vérifie qu'on a au moins 3 "rich matches" (avec interventions executed > 0)
 * détectés depuis le mémoire du tender démo Sainte-Marie, en cherchant dans les
 * engagements des contrats actifs CHU / Banque / École.
 *
 * Usage : `npx tsx scripts/phase4-smoke.ts`
 *
 * Critère de succès : `rich >= 3`. Sinon, exit 1 — la démo n'est pas frappante.
 */
import * as fs from 'fs'

// Node 20 lacks native WebSocket — Supabase realtime client requires it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

import { createAdminClient } from '@/lib/supabase/admin'
import {
  findSimilarEngagementsForMemo,
  getEvidenceForEngagements,
} from '@/lib/db/engagements'

const DEMO_TENDER_TITLE_PATTERN = '%Sainte-Marie%'
const MIN_RICH_MATCHES = 3
// Same default as EvidencePanel.tsx — keep them aligned.
const PANEL_THRESHOLD = 0.25
const PANEL_LIMIT = 8

async function main() {
  const supabase = createAdminClient()

  // 1) Find the demo tender
  const { data: tender, error: tErr } = await supabase
    .from('tenders')
    .select('id, title, status')
    .ilike('title', DEMO_TENDER_TITLE_PATTERN)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (tErr) throw tErr
  if (!tender) {
    console.error(
      `❌ Demo tender matching '${DEMO_TENDER_TITLE_PATTERN}' not found. ` +
        `Run \`npx tsx scripts/seed-demo.ts\` first.`
    )
    process.exit(1)
  }
  console.log(`Tender : ${tender.title} (id=${tender.id}, status=${tender.status})`)

  // 2) Fetch the latest analysis (technical_memo)
  const { data: analysis, error: aErr } = await supabase
    .from('tender_analyses')
    .select('id, technical_memo')
    .eq('tender_id', tender.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (aErr) throw aErr
  if (!analysis || !analysis.technical_memo) {
    console.error('❌ No technical_memo on the demo tender.')
    process.exit(1)
  }
  console.log(`Memo length : ${analysis.technical_memo.length} chars`)

  // 3) Run the same matching the EvidencePanel runs server-side
  const matches = await findSimilarEngagementsForMemo({
    memo: analysis.technical_memo,
    excludeTenderId: tender.id,
    threshold: PANEL_THRESHOLD,
    limit: PANEL_LIMIT,
  })
  console.log(`Matches found (threshold=${PANEL_THRESHOLD}): ${matches.length}`)

  if (matches.length === 0) {
    console.error('❌ 0 matches — vocabulary mismatch in the demo memo.')
    process.exit(1)
  }

  // 4) Hydrate evidence and filter to "rich" matches (executed interventions > 0)
  const evidenceMap = await getEvidenceForEngagements(matches.map((m) => m.engagement.id))
  const rich = matches.filter((m) => {
    const ev = evidenceMap.get(m.engagement.id)
    return ev && ev.interventionsExecuted > 0
  })
  console.log(`Rich matches (with executed interventions): ${rich.length}`)

  for (const m of rich) {
    const ev = evidenceMap.get(m.engagement.id)!
    const pct = Math.round(m.similarity * 100)
    const contracts = ev.contractNames.join(', ') || '—'
    console.log(
      `  - "${m.engagement.short_label}" (${pct}%) → ` +
        `${ev.interventionsExecuted} interv. / ${ev.photosCount} photo(s) / ${contracts}`
    )
  }

  // 5) Verdict
  if (rich.length < MIN_RICH_MATCHES) {
    console.error(
      `❌ Smoke test failed : ${rich.length} rich matches (need >= ${MIN_RICH_MATCHES}).`
    )
    process.exit(1)
  }
  console.log(`✅ Smoke OK : ${rich.length} rich matches (>= ${MIN_RICH_MATCHES}).`)
}

main().catch((e) => {
  console.error('[phase4-smoke] Fatal:', e)
  process.exit(1)
})
