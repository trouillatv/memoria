/**
 * scripts/dev/probe-collaboration-graph.ts
 *
 * LECTURE SEULE — vérifie que le graphe de collaboration produit des forces
 * réellement contrastées (épaisseur/pâleur) sur les données de l'org démo, sans
 * ouvrir le canvas. Preuve de bout en bout du langage visuel.
 *
 * Usage : tsx scripts/dev/probe-collaboration-graph.ts
 */
import * as fs from 'fs'

const ws = require('ws')
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') {
  ;(globalThis as { WebSocket: unknown }).WebSocket = ws
}

import { getCollaborationGraph } from '@/lib/db/collaboration-graph'
import { collaborationEdgeWidth, collaborationEdgeAlpha } from '@/lib/knowledge/collaboration-graph'

const DEMO_ORG_ID = '95df55b5-11cf-4ace-b2ca-18b000ba9b25'

function loadEnvLocal() {
  const path = '.env.local'
  if (!fs.existsSync(path)) return
  for (const rawLine of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!
  }
}

async function main() {
  loadEnvLocal()
  const g = await getCollaborationGraph([DEMO_ORG_ID], new Date())
  const label = new Map(g.nodes.map((n) => [n.key, `${n.label}${n.kind === 'person' ? ' (p)' : ''}`]))
  const rows = g.edges
    .map((e) => ({
      pair: `${label.get(e.a) ?? e.a} ↔ ${label.get(e.b) ?? e.b}`,
      force: e.strength, width: collaborationEdgeWidth(e.strength), alpha: collaborationEdgeAlpha(e.daysSinceLastInteraction),
      inter: e.interactionCount, days: e.daysSinceLastInteraction, trend: e.trend,
    }))
    .sort((a, b) => b.force - a.force)

  console.log(`${g.nodes.length} nœuds · ${g.edges.length} collaborations (org démo)\n`)
  console.log('force  épaisseur  pâleur  inter  récence(j)  tendance   couple')
  for (const r of rows) {
    console.log(
      `${r.force.toFixed(1).padStart(5)}  ${r.width.toFixed(1).padStart(8)}  ${r.alpha.toFixed(2).padStart(6)}  ${String(r.inter).padStart(5)}  ${String(r.days).padStart(9)}  ${r.trend.padEnd(9)}  ${r.pair}`,
    )
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
