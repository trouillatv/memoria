// Audit P1-A (3/3) — inventaire complet de `copilot_interactions`. Lecture seule.
//
// Les deux passes précédentes ne retrouvent aucune des trois formulations de la
// recette, et aucune interaction postérieure au déploiement de `20523e3d`. Avant
// d'en conclure quoi que ce soit, on regarde la table entière : 89 lignes.
//
// Usage : npx tsx scripts/audit-p1a-telemetrie-complete.ts
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../lib/supabase/admin'

const DEPLOY_MS = 1786751497312

async function main() {
  const db = createAdminClient()
  const { data, error, count } = await db
    .from('copilot_interactions')
    .select('created_at, site_id, question, conversation_mode, guided_intent, primary_intent, ' +
      'answer_mode, answer_status, proposal_kind, voice_used', { count: 'exact' })
    .order('created_at', { ascending: false })
  if (error) { console.error('ERREUR:', error.message); process.exit(1) }
  const rows = (data ?? []) as Record<string, unknown>[]

  console.log(`\nTotal lignes en base : ${count}`)
  console.log(`Maintenant (UTC)     : ${new Date().toISOString()}`)
  console.log(`Déploiement 20523e3d : ${new Date(DEPLOY_MS).toISOString()}\n`)

  for (const r of rows) {
    const ts = String(r.created_at).slice(0, 19).replace('T', ' ')
    const flag = new Date(String(r.created_at)).getTime() >= DEPLOY_MS ? '*' : ' '
    console.log(`${flag}${ts} ${String(r.site_id).slice(0, 8)} ${String(r.conversation_mode).padEnd(6)}`
      + ` ${r.voice_used ? '🎤' : '  '} ${String(r.primary_intent ?? '—').padEnd(16)}`
      + ` ${String(r.answer_mode).padEnd(22)} ${String(r.answer_status).padEnd(18)} ${r.question}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
