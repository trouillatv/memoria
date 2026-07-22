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
// 10 JOURS GLISSANTS (Vincent, 2026-07-22). Descendu de 14 à 10 : la fenêtre
// utile n'est pas « le plus longtemps possible », c'est « assez pour qu'une
// bêtise soit remarquée ». Au-delà d'une dizaine de jours, un dump quotidien
// ne sert plus à rattraper une erreur — personne ne revient en arrière de deux
// semaines sur des données d'exploitation — il ne fait qu'accumuler.
const RETENTION_DAYS = 10

// ÉNUMÉRATION DYNAMIQUE (mig 192, Vincent 2026-07-09) : la liste en dur avait
// dérivé (~80 migrations de retard — site_actions, site_decisions, dossiers…
// non sauvegardés). RÈGLE : toute table est sauvegardée par défaut ; toute
// exclusion est EXPLICITE, ici, avec sa justification écrite.
const EXCLUDED: Record<string, string> = {
  // (aucune exclusion — le jour où une table doit sortir du backup, elle
  // s'inscrit ici avec sa raison, et c'est un acte doctrinal délibéré.)
}

// Pagination du dump : PostgREST plafonne un select à ~1000 lignes — l'ancien
// dump tronquait SILENCIEUSEMENT les grosses tables. NB : sans ORDER BY la
// pagination n'est pas transactionnelle ; le cron tourne à 03h00 (fenêtre
// calme), le risque résiduel est accepté pour un dump logique quotidien.
const PAGE = 1000
async function dumpTable(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
): Promise<{ rows: unknown[] } | { error: string }> {
  const rows: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1)
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return { rows }
}

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

  // 0. Énumérer les tables (mig 192) — si l'énumération échoue, on REFUSE de
  //    produire un backup partiel silencieux.
  const { data: tableRows, error: listErr } = await supabase.rpc('backup_list_tables')
  if (listErr || !tableRows?.length) {
    return NextResponse.json(
      { ok: false, reason: `backup_list_tables failed: ${listErr?.message ?? 'empty'}` },
      { status: 500 },
    )
  }
  const tables = (tableRows as string[]).filter((t) => !(t in EXCLUDED))

  // 1. Dump table par table (paginé — jamais de troncature silencieuse)
  for (const t of tables) {
    const result = await dumpTable(supabase, t)
    if ('error' in result) { errors.push(`${t}: ${result.error}`); continue }
    ;(dump.tables as Record<string, unknown[]>)[t] = result.rows
    counts[t] = result.rows.length
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
    tables: tables.length,
    excluded: Object.keys(EXCLUDED).length ? EXCLUDED : undefined,
    rows: totalRows,
    purged,
    errors: errors.length ? errors : undefined,
    durationMs: Date.now() - startedAt.getTime(),
  })
}
