/**
 * scripts/dev/backup-export.ts
 *
 * BACKUP COMPLET « avant opération » + RECONNAISSANCE (LECTURE SEULE sur la base).
 *
 * Produit un export restaurable par scripts/dev/restore-backup.ts :
 *   - dump des tables publiques (SELECT *) au format { generatedAt, tables: {} }
 *   - capture EN PLUS auth.users (que le cron n'inclut pas) dans un fichier à part
 *   - écrit en local sous tmp/backup-prewipe-<timestamp>/ ET upload dans le
 *     bucket privé db-backups (durabilité : survit au nettoyage de tmp/).
 *
 * Imprime un état complet : counts par table, total, comptes auth, et présence
 * des 3 comptes à conserver — sert de reconnaissance avant tout nettoyage.
 *
 * N'ÉCRIT AUCUNE donnée métier. Seuls écrits : fichiers locaux + objet storage.
 *
 * USAGE
 *   npx tsx scripts/dev/backup-export.ts --confirm-on=<sous-chaîne de NEXT_PUBLIC_SUPABASE_URL>
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })


const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { mkdirSync, writeFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'db-backups'

// Mêmes tables que le cron /api/cron/backup (garder synchronisé).
const TABLES = [
  'activity_logs', 'ai_usage', 'clients', 'contracts', 'document_collections',
  'document_links', 'documents', 'engagements', 'feedback', 'handover_briefs',
  'intervention_access_events', 'intervention_anomalies', 'intervention_checklist_items',
  'intervention_participants', 'intervention_photos', 'intervention_templates',
  'intervention_validations', 'intervention_voice_notes', 'interventions',
  'knowledge_chunks', 'knowledge_items', 'missions', 'proof_share_tokens',
  'proof_verification_tokens', 'reports', 'share_access_log', 'site_notes',
  'site_reading_candidates', 'sites', 'team_members', 'teams', 'tender_agent_analyses',
  'tender_analyses', 'tender_chat_attachments', 'tender_chat_messages',
  'tender_conversations', 'tender_documents', 'tenders', 'trace_embeddings', 'users',
]

const KEEP_EMAILS = ['admin@memoria.nc', 'manager@memoria.nc', 'guillaume.demene@memoria.nc']

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`))
  return p ? p.slice(name.length + 3) : undefined
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const confirmOn = arg('confirm-on')
  if (!confirmOn || !url.includes(confirmOn)) {
    console.error('✗ Sécurité : passe --confirm-on=<sous-chaîne de NEXT_PUBLIC_SUPABASE_URL>.')
    console.error(`  URL cible actuelle : ${url.replace(/(https?:\/\/[^.]+).*/, '$1...(masqué)')}`)
    process.exit(1)
  }

  const supabase = createAdminClient()
  const startedAt = new Date()
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-')

  // 1) Dump tables publiques + counts
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  const errors: string[] = []
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select('*')
    if (error) { errors.push(`${t}: ${error.message}`); continue }
    tables[t] = data ?? []
    counts[t] = data?.length ?? 0
  }

  // 2) auth.users (NON inclus dans le backup cron) — capturé à part
  const authUsers: Array<{ id: string; email: string | undefined; created_at: string }> = []
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) { errors.push(`auth.listUsers: ${error.message}`); break }
    for (const u of data?.users ?? []) authUsers.push({ id: u.id, email: u.email, created_at: u.created_at })
    if (!data || data.users.length < 1000) break
    page++
  }

  // 3) public.users (email + role) pour la lisibilité du rapport
  const { data: pubUsers } = await supabase.from('users').select('id, email, full_name, role, deleted_at')

  // 4) Écriture locale
  const dir = `tmp/backup-prewipe-${stamp}`
  mkdirSync(dir, { recursive: true })
  const dataPath = `${dir}/data.json`
  const body = JSON.stringify({ generatedAt: startedAt.toISOString(), tables })
  writeFileSync(dataPath, body)
  const authPath = `${dir}/auth-users.json`
  writeFileSync(authPath, JSON.stringify({ generatedAt: startedAt.toISOString(), authUsers, publicUsers: pubUsers ?? [] }, null, 2))

  // 5) Upload bucket (durabilité)
  const bucketName = `backup-prewipe-${stamp}.json`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(bucketName, body, { contentType: 'application/json', upsert: true })

  // 6) Rapport
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log('\n=== BACKUP + RECON (lecture seule) ===')
  console.log(`Cible        : ${url.replace(/(https?:\/\/[^.]+).*/, '$1...(masqué)')}`)
  console.log(`Fichier local: ${dataPath}  (${(body.length / 1024).toFixed(1)} Ko)`)
  console.log(`auth.users   : ${authPath}`)
  console.log(`Bucket       : ${upErr ? `✗ échec upload (${upErr.message})` : `db-backups/${bucketName}`}`)
  console.log('\n--- Counts par table (non vides) ---')
  for (const t of TABLES) {
    if ((counts[t] ?? 0) > 0) console.log(`  ${t.padEnd(34)} ${counts[t]}`)
  }
  console.log(`  ${'TOTAL'.padEnd(34)} ${totalRows} lignes sur ${TABLES.length} tables`)

  console.log(`\n--- Comptes auth (${authUsers.length}) ---`)
  const roleByEmail = new Map((pubUsers ?? []).map((u: { email: string; role: string }) => [u.email, u.role]))
  for (const u of authUsers) {
    const keep = KEEP_EMAILS.includes(u.email ?? '') ? '  ✅ CONSERVÉ' : '  🗑️  hors liste'
    console.log(`  ${(u.email ?? '(sans email)').padEnd(36)} ${(roleByEmail.get(u.email ?? '') ?? '?').padEnd(14)}${keep}`)
  }

  console.log('\n--- Présence des 3 comptes à conserver ---')
  for (const e of KEEP_EMAILS) {
    const found = authUsers.find((u) => u.email === e)
    console.log(`  ${e.padEnd(36)} ${found ? `EXISTE (id ${found.id})` : '❌ ABSENT — à créer'}`)
  }

  if (errors.length) {
    console.log('\n⚠️  Erreurs de lecture :')
    for (const e of errors) console.log(`  - ${e}`)
  }
  console.log('\n(LECTURE SEULE — aucune donnée métier modifiée.)')
}

main().catch((e) => { console.error('BACKUP FAILED:', e); process.exit(1) })
