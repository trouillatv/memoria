// Cron de sauvegarde logique — dump quotidien de la base dans le bucket privé
// `db-backups` (Vincent 2026-05-27, option 2 « dump gratuit »).
//
// Déclenché par Vercel Cron (cf. vercel.json) — 03h00 Nouméa = 16h00 UTC.
// Auth : Bearer CRON_SECRET (même pattern que refresh-memory-readings).
//
// Ce que ça fait :
//   1. Dump toutes les tables publiques (SELECT *) en un seul JSON horodaté.
//   2. Upload dans le bucket privé `db-backups` : backup-YYYY-MM-DD.json
//      (1 fichier par jour, écrasé si relancé le même jour).
//   3. Rétention : supprime les backups de plus de RETENTION_DAYS jours.
//
// NB : ne sauvegarde PAS auth.users (3 comptes stables, gérés à part ; évite de
// répandre des hashs de mots de passe dans le storage). Restaure les DONNÉES.
// Ce n'est pas un PITR : la granularité = la fréquence du cron (1 jour).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

const BUCKET = 'db-backups'
const RETENTION_DAYS = 14

// Tables publiques à sauvegarder. ⚠️ Ajouter ici toute NOUVELLE table métier.
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

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startedAt = new Date()
  const dump: Record<string, unknown> = {
    generatedAt: startedAt.toISOString(),
    tables: {} as Record<string, unknown[]>,
  }
  const counts: Record<string, number> = {}
  const errors: string[] = []

  // 1. Dump table par table
  for (const t of TABLES) {
    const { data, error } = await supabase.from(t).select('*')
    if (error) { errors.push(`${t}: ${error.message}`); continue }
    ;(dump.tables as Record<string, unknown[]>)[t] = data ?? []
    counts[t] = data?.length ?? 0
  }

  // 2. Upload (1 fichier par jour, écrasé si relance le même jour)
  const day = startedAt.toISOString().slice(0, 10) // YYYY-MM-DD
  const path = `backup-${day}.json`
  const body = JSON.stringify(dump)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: 'application/json', upsert: true })
  if (upErr) {
    return NextResponse.json({ ok: false, reason: `upload_failed: ${upErr.message}`, errors }, { status: 500 })
  }

  // 3. Rétention : purge des backups > RETENTION_DAYS
  let purged = 0
  const { data: files } = await supabase.storage.from(BUCKET).list('', { limit: 1000 })
  if (files) {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    const toDelete = files
      .filter((f) => {
        const m = f.name.match(/^backup-(\d{4}-\d{2}-\d{2})\.json$/)
        if (!m) return false
        return new Date(m[1]).getTime() < cutoff
      })
      .map((f) => f.name)
    if (toDelete.length) {
      await supabase.storage.from(BUCKET).remove(toDelete)
      purged = toDelete.length
    }
  }

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0)
  return NextResponse.json({
    ok: true,
    file: path,
    bytes: body.length,
    tables: TABLES.length,
    rows: totalRows,
    purged,
    errors: errors.length ? errors : undefined,
    durationMs: Date.now() - startedAt.getTime(),
  })
}
