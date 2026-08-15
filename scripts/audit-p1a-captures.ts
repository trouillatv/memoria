// Audit P1-A (2/2) — retrouver les 3 captures de recette dans la télémétrie,
// tous chantiers confondus. Lecture seule.
//
// La première passe (audit-p1a-payload-reel.ts) ne trouve AUCUNE des trois
// formulations sur PETRO. Avant d'accuser un étage du pipeline, il faut savoir
// si la production a seulement vu ces questions — et sous quel build.
//
// Usage : npx tsx scripts/audit-p1a-captures.ts
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../lib/supabase/admin'

const DEPLOY_MS = 1786751497312 // 20523e3d en production
const NEEDLES = ['surveiller', 'Prépare-moi', 'prepare-moi', 'je vérifie quoi', 'verifie quoi',
  'points de contrôle', 'points de controle', 'en priorité sur place', 'visite de demain']

async function main() {
  const db = createAdminClient()
  const { data, error } = await db
    .from('copilot_interactions')
    .select('created_at, site_id, question, conversation_mode, primary_intent, scope, answer_mode, ' +
      'answer_status, used_fallback, proposal_kind, voice_used, answer_text')
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) { console.error('ERREUR:', error.message); process.exit(1) }
  const rows = (data ?? []) as Record<string, unknown>[]

  console.log(`\n=== ${rows.length} dernières interactions (tous chantiers) ===`)
  console.log(`Plus récente : ${rows[0]?.created_at ?? '—'}`)
  console.log(`Déploiement 20523e3d : ${new Date(DEPLOY_MS).toISOString()}`)
  const after = rows.filter((r) => new Date(String(r.created_at)).getTime() >= DEPLOY_MS)
  console.log(`Interactions POSTÉRIEURES au déploiement P1-A : ${after.length}\n`)

  const hits = rows.filter((r) => {
    const q = String(r.question ?? '').toLowerCase()
    return NEEDLES.some((n) => q.includes(n.toLowerCase()))
  })
  console.log(`=== Formulations « plan de visite » retrouvées : ${hits.length} ===\n`)
  for (const r of hits) {
    const ts = new Date(String(r.created_at))
    console.log('─'.repeat(78))
    console.log(`${ts.toISOString()}  [${ts.getTime() >= DEPLOY_MS ? '20523e3d' : 'AVANT P1-A'}]`
      + `  site=${String(r.site_id).slice(0, 8)}  mode=${r.conversation_mode}  vocal=${r.voice_used}`)
    console.log(`Q. ${r.question}`)
    console.log(`   primary_intent=${r.primary_intent} | scope=${r.scope} | answer_mode=${r.answer_mode}`
      + ` | status=${r.answer_status} | proposal=${r.proposal_kind ?? '—'}`)
    const t = r.answer_text ? String(r.answer_text) : null
    console.log(`   → ${t ? t.replace(/\n/g, '\n     ').slice(0, 700) : '(aucune réponse tracée)'}`)
  }
  console.log('─'.repeat(78))

  // Répartition par chantier sur les 300 dernières — situe l'environnement testé.
  const bySite = new Map<string, number>()
  for (const r of rows) bySite.set(String(r.site_id), (bySite.get(String(r.site_id)) ?? 0) + 1)
  console.log('\nRépartition par chantier :')
  for (const [s, n] of [...bySite.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s} : ${n}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
