// Dry-run P0-C — Moteur d'attention canonical chantier
//
// Usage :
//   npx tsx scripts/dry-run-canonical-attention.ts [--site <id>] [--limit <n>]
//
// Exemples :
//   npx tsx scripts/dry-run-canonical-attention.ts              # OCEF par défaut
//   npx tsx scripts/dry-run-canonical-attention.ts --site 75bd3d23-d515-46bd-8de8-254495a5bade  # PETRO
//   npx tsx scripts/dry-run-canonical-attention.ts --limit 10

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { deriveCanonicalAttentionItems } from '../lib/knowledge/canonical-attention'

const args = process.argv.slice(2)
function getArg(flag: string, fallback?: string): string | undefined {
  const idx = args.indexOf(`--${flag}`)
  return idx >= 0 ? args[idx + 1] : fallback
}

const SITE_ID = getArg('site', '2c939e67-e986-4635-86a0-638cda870480')!
const LIMIT = Number(getArg('limit', '10'))

const URGENCY_ICON: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '🟢',
}

async function main() {
  console.log(`\n=== P0-C Canonical Attention Dry-Run ===`)
  console.log(`Site     : ${SITE_ID}`)
  console.log(`Limit    : ${LIMIT}`)
  console.log(`Date     : ${new Date().toISOString().slice(0, 10)}\n`)

  const items = await deriveCanonicalAttentionItems(SITE_ID, { limit: LIMIT })

  if (items.length === 0) {
    console.log('Aucun sujet avec signal d\'alerte sur ce chantier.')
    return
  }

  console.log(`${items.length} sujet${items.length > 1 ? 's' : ''} avec signal :\n`)

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const icon = URGENCY_ICON[item.urgency] ?? '⚪'
    console.log(`${i + 1}. ${icon} [${item.urgency.toUpperCase()}] ${item.title}`)
    console.log(`   Score   : ${item.score}`)
    console.log(`   Signaux : ${item.signals.join(', ')}`)
    for (const reason of item.reasons) {
      console.log(`   • ${reason}`)
    }
    console.log(`   Lien    : ${item.href}`)
    console.log()
  }

  // Synthèse par urgence
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const it of items) counts[it.urgency]++
  console.log('=== Synthèse ===')
  console.log(`🔴 critical : ${counts.critical}`)
  console.log(`🟠 high     : ${counts.high}`)
  console.log(`🟡 medium   : ${counts.medium}`)
  console.log(`🟢 low      : ${counts.low}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
