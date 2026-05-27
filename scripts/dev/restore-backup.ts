/**
 * scripts/dev/restore-backup.ts
 *
 * RESTAURATION « bris de glace » d'un backup logique produit par le cron
 * /api/cron/backup (fichier backup-YYYY-MM-DD.json dans le bucket db-backups).
 *
 * Lit le JSON (local OU téléchargé du bucket) et réinsère les lignes table par
 * table via le service role (bypass RLS), en UPSERT (onConflict: id) — donc
 * idempotent et rejouable. Insertion en PLUSIEURS PASSES : on retente les
 * tables en échec tant qu'il y a du progrès, ce qui résout l'ordre des clés
 * étrangères sans avoir à le coder à la main.
 *
 *   ⚠️ ÉCRIT EN BASE. Anti-rampe-de-lancement : refuse de tourner sans
 *      --confirm-restore-on=<sous-chaîne de NEXT_PUBLIC_SUPABASE_URL> ET --yes.
 *
 * USAGE
 *   # 1) Lister les backups disponibles dans le bucket :
 *   npx tsx scripts/dev/restore-backup.ts --list
 *
 *   # 2) Dry-run (montre ce qui SERAIT restauré, n'écrit rien) :
 *   npx tsx scripts/dev/restore-backup.ts --from-bucket=backup-2026-05-27.json --confirm-restore-on=srixnofmaydxouhucawn
 *
 *   # 3) Exécution réelle :
 *   npx tsx scripts/dev/restore-backup.ts --from-bucket=backup-2026-05-27.json --confirm-restore-on=srixnofmaydxouhucawn --yes
 *
 *   # Variante fichier local :
 *   npx tsx scripts/dev/restore-backup.ts --file=tmp/backup-XXXX/all.json --confirm-restore-on=... --yes
 *
 * NB : le backup ne contient PAS auth.users (3 comptes gérés à part). La table
 * public.users EST restaurée, mais les comptes d'auth doivent exister (créés via
 * l'admin ou déjà présents) pour que les FK soient satisfaites.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

// Supabase realtime client a besoin de WebSocket sous Node.
 
const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { readFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'db-backups'
const BATCH = 500 // lignes par upsert

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`))
  return p ? p.slice(name.length + 3) : undefined
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

type Dump = { generatedAt?: string; tables: Record<string, Record<string, unknown>[]> }

async function main() {
  const supabase = createAdminClient()

  // --list : juste lister les backups du bucket et sortir.
  if (hasFlag('list')) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000 })
    if (error) { console.error('Erreur list bucket:', error.message); process.exit(1) }
    console.log('Backups disponibles :')
    for (const f of (data ?? []).sort((a, b) => b.name.localeCompare(a.name))) {
      console.log(`  ${f.name}`)
    }
    return
  }

  // Anti-méprise : la cible doit correspondre.
  const confirmOn = arg('confirm-restore-on')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!confirmOn || !url.includes(confirmOn)) {
    console.error('✗ Sécurité : passe --confirm-restore-on=<sous-chaîne de NEXT_PUBLIC_SUPABASE_URL>.')
    console.error(`  URL cible actuelle : ${url}`)
    process.exit(1)
  }
  const execute = hasFlag('yes')

  // Charger le dump (local ou bucket).
  let raw: string
  const localFile = arg('file')
  const bucketFile = arg('from-bucket')
  if (localFile) {
    raw = readFileSync(localFile, 'utf-8')
    console.log(`Source : fichier local ${localFile}`)
  } else if (bucketFile) {
    const { data, error } = await supabase.storage.from(BUCKET).download(bucketFile)
    if (error || !data) { console.error('Erreur download bucket:', error?.message); process.exit(1) }
    raw = await data.text()
    console.log(`Source : bucket ${BUCKET}/${bucketFile}`)
  } else {
    console.error('✗ Précise --from-bucket=backup-YYYY-MM-DD.json OU --file=chemin.json (ou --list).')
    process.exit(1)
  }

  const dump = JSON.parse(raw) as Dump
  // Supporte 2 formats : { tables: {t: rows} } (cron) ou { t: rows } (dump manuel).
  const tables: Record<string, Record<string, unknown>[]> =
    dump.tables ?? (dump as unknown as Record<string, Record<string, unknown>[]>)
  const tableNames = Object.keys(tables).filter((t) => Array.isArray(tables[t]) && tables[t].length > 0)

  console.log(`\nDump généré le : ${dump.generatedAt ?? '(inconnu)'}`)
  console.log(`Tables non vides : ${tableNames.length}`)
  for (const t of tableNames) console.log(`  ${t.padEnd(34)} ${tables[t].length} lignes`)

  if (!execute) {
    console.log('\n[DRY-RUN] Rien écrit. Ajoute --yes pour exécuter la restauration.')
    return
  }

  // Insertion multi-passes : on retente les tables en échec tant qu'il y a du
  // progrès → résout l'ordre des FK sans le coder en dur.
  let remaining = [...tableNames]
  const done: string[] = []
  let pass = 0
  while (remaining.length > 0 && pass < 8) {
    pass++
    const stillFailing: string[] = []
    for (const t of remaining) {
      const rows = tables[t]
      let ok = true
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH)
        const { error } = await supabase.from(t).upsert(slice, { onConflict: 'id' })
        if (error) { ok = false; if (pass >= 8) console.error(`  ✗ ${t}: ${error.message}`); break }
      }
      if (ok) { done.push(t); console.log(`  ✓ pass ${pass} — ${t} (${rows.length})`) }
      else stillFailing.push(t)
    }
    if (stillFailing.length === remaining.length) {
      console.error(`\n✗ Plus de progrès — tables en échec (FK non résolue ?) : ${stillFailing.join(', ')}`)
      break
    }
    remaining = stillFailing
  }

  console.log(`\nRestauré : ${done.length}/${tableNames.length} tables.`)
  if (remaining.length) console.log(`Échec : ${remaining.join(', ')}`)
}

main().catch((e) => { console.error('RESTORE FAILED:', e); process.exit(1) })
