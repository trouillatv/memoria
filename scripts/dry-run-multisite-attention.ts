// Dry-run P0-D — Moteur d'attention multi-site
//
// Usage :
//   npx tsx scripts/dry-run-multisite-attention.ts [--limit <n>] [--sites <id1,id2,...>]
//
// Si --sites est omis, utilise les chantiers OCEF + PETRO par défaut.
// Passer --sites "" pour lister tous les sites via listSites() (contexte Next.js nécessaire).

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { deriveMultiSiteAttention } from '../lib/knowledge/multi-site-attention'

const args = process.argv.slice(2)
function getArg(flag: string, fallback?: string): string | undefined {
  const idx = args.indexOf(`--${flag}`)
  return idx >= 0 ? args[idx + 1] : fallback
}

const LIMIT = Number(getArg('limit', '20'))

// Sites par défaut : OCEF Compostage + PETRO
const DEFAULT_SITES = [
  '2c939e67-e986-4635-86a0-638cda870480', // OCEF Compostage
  '75bd3d23-d515-46bd-8de8-254495a5bade', // PETRO
]
const sitesArg = getArg('sites')
const SITE_IDS = sitesArg ? sitesArg.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_SITES

const URGENCY_ICON: Record<string, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '🟢',
  none:     '⚪',
}

async function main() {
  console.log(`\n=== P0-D Multi-Site Attention Dry-Run ===`)
  console.log(`Sites    : ${SITE_IDS.length} chantier${SITE_IDS.length > 1 ? 's' : ''}`)
  console.log(`Limit    : ${LIMIT}`)
  console.log(`Date     : ${new Date().toISOString().slice(0, 10)}\n`)

  const sites = await deriveMultiSiteAttention({ limit: LIMIT, siteIds: SITE_IDS })

  if (sites.length === 0) {
    console.log('Aucun chantier avec signal d\'alerte canonical.')
    return
  }

  console.log(`${sites.length} chantier${sites.length > 1 ? 's' : ''} avec signal :\n`)

  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]
    const icon = URGENCY_ICON[s.urgency] ?? '⚪'

    console.log(`${i + 1}. ${icon} ${s.siteName}`)
    console.log(`   Score total : ${s.score}`)
    console.log(`   └─ sujet top   : ${s.contributions.topSubjectScore}`)
    console.log(`   └─ volume H+   : +${s.contributions.highCountBoost}`)
    console.log(`   └─ overdue obj : +${s.contributions.overdueObjectBoost}`)
    console.log(`   └─ débrief     : +${s.contributions.pendingDebriefBoost}`)
    console.log(`   └─ visite imm. : +${s.contributions.upcomingVisitBoost}`)

    if (s.lastVisitAt) {
      const days = Math.round((Date.now() - new Date(s.lastVisitAt).getTime()) / 86_400_000)
      console.log(`   Dernière visite : il y a ${days} j`)
    } else {
      console.log(`   Dernière visite : aucune`)
    }
    if (s.nextVisitAt) {
      console.log(`   Prochaine visite : ${s.nextVisitAt.slice(0, 10)}`)
    }

    for (let j = 0; j < s.topSubjects.length; j++) {
      const sub = s.topSubjects[j]
      console.log(`   Sujet ${j + 1} : [${sub.urgency.toUpperCase()}] ${sub.title} (score ${sub.score})`)
      for (const reason of sub.reasons) {
        console.log(`     • ${reason}`)
      }
    }
    console.log()
  }

  // Synthèse
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, none: 0 }
  for (const s of sites) counts[s.urgency]++
  console.log('=== Synthèse par urgence de sujet top ===')
  console.log(`🔴 critical : ${counts.critical}`)
  console.log(`🟠 high     : ${counts.high}`)
  console.log(`🟡 medium   : ${counts.medium}`)
  console.log(`🟢 low      : ${counts.low}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
