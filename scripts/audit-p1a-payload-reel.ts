// Audit P1-A — que reçoit RÉELLEMENT le LLM en production ?
//
// Recette NO-GO (Vincent, 2026-08-15) : le dry-run affirme 5 `visitPlanDetail`
// sur PETRO, la production répond comme s'ils n'existaient pas. Mandat : tracer
// le pipeline réel jusqu'au payload, EN LECTURE SEULE, sans toucher au prompt,
// au routeur ni au moteur, et identifier le PREMIER étage où les 5 disparaissent.
//
// Ce script ne rejoue rien : il lit la télémétrie `copilot_interactions`, qui est
// écrite par l'action serveur elle-même. C'est la seule preuve de ce que la
// production a fait — un rejeu local prouve seulement ce que le code ferait.
//
// Usage : npx tsx scripts/audit-p1a-payload-reel.ts [--site <uuid>] [--limit 30]
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../lib/supabase/admin'

const args = process.argv.slice(2)
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const SITE_ID = argOf('--site') ?? '75bd3d23-d515-46bd-8de8-254495a5bade' // PETRO ATTITI
const LIMIT = Number(argOf('--limit') ?? 30)

// Déploiement de `20523e3d` sur memoria (Vercel, dpl_G4Sf9vz4GPcAZCHZAVyu8KHj4gHS).
const DEPLOY_MS = 1786751497312

async function main() {
  const db = createAdminClient()
  const { data, error } = await db
    .from('copilot_interactions')
    .select('created_at, question, conversation_mode, primary_intent, secondary_intents, scope, ' +
      'answer_mode, answer_status, used_fallback, proposal_kind, model, cited_reference_count, ' +
      'latency_ms, answer_text')
    .eq('site_id', SITE_ID)
    .order('created_at', { ascending: false })
    .limit(LIMIT)

  if (error) { console.error('ERREUR:', error.message); process.exit(1) }
  const rows = (data ?? []) as Record<string, unknown>[]

  console.log(`\n=== ${rows.length} interaction(s) Copilote — site ${SITE_ID} ===`)
  console.log(`Déploiement 20523e3d : ${new Date(DEPLOY_MS).toISOString()}\n`)

  for (const r of rows) {
    const ts = new Date(String(r.created_at))
    const build = ts.getTime() >= DEPLOY_MS ? '20523e3d (P1-A)' : 'AVANT P1-A'
    console.log('─'.repeat(78))
    console.log(`${ts.toISOString()}  [${build}]`)
    console.log(`Q. ${r.question}`)
    console.log(`   primary_intent=${r.primary_intent} | scope=${r.scope} | mode=${r.answer_mode}`
      + ` | status=${r.answer_status} | fallback=${r.used_fallback} | proposal=${r.proposal_kind ?? '—'}`)
    console.log(`   model=${r.model ?? '—'} | refs=${r.cited_reference_count} | ${r.latency_ms}ms`)
    const t = r.answer_text ? String(r.answer_text) : null
    console.log(`   → ${t ? t.replace(/\n/g, '\n     ').slice(0, 600) : '(aucune réponse tracée)'}`)
  }
  console.log('─'.repeat(78))
}

main().catch((e) => { console.error(e); process.exit(1) })
