/**
 * scripts/dev/seed-orgs.ts
 *
 * Crée les 2 organisations (BatiSud + Guillaume/MVO) et assigne
 * toutes les données existantes à BatiSud. Guillaume part sur une base vierge.
 *
 * USAGE : npx tsx scripts/dev/seed-orgs.ts
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// Tables racines à assigner à BatiSud (toutes les données existantes sont à eux)
const ROOT_TABLES = [
  'clients', 'contracts', 'sites', 'teams', 'tenders',
  'knowledge_items', 'documents', 'document_collections',
  'handover_briefs', 'reports',
]

// Tables enfants
const CHILD_TABLES = [
  'missions', 'interventions', 'intervention_templates', 'team_members',
  'knowledge_chunks', 'tender_analyses', 'tender_documents',
  'tender_chat_messages', 'tender_chat_attachments', 'tender_agent_analyses',
  'tender_conversations', 'engagements', 'proof_share_tokens',
  'site_notes', 'site_reading_candidates', 'ai_usage', 'activity_logs',
]

const BATISUD_USERS = ['adrien@memoria.nc', 'chef.batisud@memoria.nc', 'admin@memoria.nc', 'manager@memoria.nc']
const GUILLAUME_EMAIL = 'guillaume.demene@memoria.nc'

async function main() {
  // 1. Créer les organisations
  console.log('\n=== Création des organisations ===')

  const { data: existingOrgs } = await sb.from('organizations').select('id, slug')
  const existingBatisud = existingOrgs?.find(o => o.slug === 'batisud')
  const existingMvo = existingOrgs?.find(o => o.slug === 'mvo')

  let batisudId: string
  let mvoId: string

  if (existingBatisud) {
    batisudId = existingBatisud.id
    console.log(`  ↩ BatiSud existe déjà : ${batisudId}`)
  } else {
    const { data, error } = await sb.from('organizations').insert({ name: 'BatiSud Construction', slug: 'batisud' }).select('id').single()
    if (error) throw error
    batisudId = data.id
    console.log(`  ✓ Organisation BatiSud créée : ${batisudId}`)
  }

  if (existingMvo) {
    mvoId = existingMvo.id
    console.log(`  ↩ MVO existe déjà : ${mvoId}`)
  } else {
    const { data, error } = await sb.from('organizations').insert({ name: 'Mémoire Vivante Opérationnelle', slug: 'mvo' }).select('id').single()
    if (error) throw error
    mvoId = data.id
    console.log(`  ✓ Organisation MVO (Guillaume) créée : ${mvoId}`)
  }

  // 2. Assigner les users
  console.log('\n=== Assignation des utilisateurs ===')
  const { data: allUsers } = await sb.from('users').select('id, email')
  for (const u of allUsers ?? []) {
    if (u.email === GUILLAUME_EMAIL) {
      await sb.from('users').update({ organization_id: mvoId }).eq('id', u.id)
      console.log(`  ✓ Guillaume → MVO`)
    } else if (BATISUD_USERS.includes(u.email)) {
      await sb.from('users').update({ organization_id: batisudId }).eq('id', u.id)
      console.log(`  ✓ ${u.email} → BatiSud`)
    }
  }

  // 3. Assigner toutes les données existantes à BatiSud
  console.log('\n=== Assignation des données → BatiSud ===')
  for (const table of [...ROOT_TABLES, ...CHILD_TABLES]) {
    const { error } = await sb.from(table).update({ organization_id: batisudId }).is('organization_id', null)
    if (error) {
      console.warn(`  ⚠ ${table}: ${error.message}`)
    } else {
      console.log(`  ✓ ${table}`)
    }
  }

  console.log('\n✅ Organisations seedées.')
  console.log(`   BatiSud (${batisudId}) — toutes les données existantes`)
  console.log(`   MVO     (${mvoId}) — Guillaume, base vierge`)
}

main().catch(e => { console.error(e); process.exit(1) })
