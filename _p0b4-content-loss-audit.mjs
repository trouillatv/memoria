// P0-B.4 — audit READ-ONLY : les fusions déjà exécutées (patch vide, AUTO_SAFE)
// ont-elles laissé une durable avec title/body VIDE alors qu'un loser superseded
// (superseded_by = durable.id) avait un title/body RENSEIGNÉ ?
//
// Portée : les 79 groupes déjà exécutés sur les 3 sites autorisés P0-B
// (Centre commercial Dumbéa Mall 7 + Hyper Dumbéa Mall 72). Tous exécutés avec
// p_patch={} par construction (AUTO_SAFE) : le title/body courant de la durable
// EST son title/body pré-fusion, aucune reconstruction nécessaire.
//
// Aucune écriture, aucun appel RPC.

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const SITE_NAMES = ['Centre commercial Dumbéa Mall', 'Hyper Dumbéa Mall']

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === ''
}

let totalDurables = 0
let totalCases = 0
const cases = []

for (const siteName of SITE_NAMES) {
  const { data: sites, error: sitesErr } = await supabase.from('sites').select('id, name').eq('name', siteName)
  if (sitesErr) throw sitesErr
  if (sites.length !== 1) throw new Error(`Site "${siteName}" : ${sites.length} résultat(s) exact(s)`)
  const site = sites[0]

  const { data: actions, error: actionsErr } = await supabase
    .from('site_actions')
    .select('id, status, superseded_by, title, body')
    .eq('site_id', site.id)
  if (actionsErr) throw actionsErr
  const actionById = new Map(actions.map((a) => [a.id, a]))

  // durables = actions actives (non cancelled, superseded_by null) qui sont la cible
  // d'au moins un loser cancelled+superseded_by pointant vers elles.
  const losersByDurable = new Map()
  for (const a of actions) {
    if (a.status === 'cancelled' && a.superseded_by) {
      const list = losersByDurable.get(a.superseded_by) ?? []
      list.push(a)
      losersByDurable.set(a.superseded_by, list)
    }
  }

  for (const [durableId, losers] of losersByDurable.entries()) {
    const durable = actionById.get(durableId)
    if (!durable) continue
    if (durable.status === 'cancelled' || durable.superseded_by) continue // pas une durable finale
    totalDurables += 1

    const durableTitleEmpty = isEmpty(durable.title)
    const durableBodyEmpty = isEmpty(durable.body)
    if (!durableTitleEmpty && !durableBodyEmpty) continue

    for (const loser of losers) {
      const titleLossCandidate = durableTitleEmpty && !isEmpty(loser.title)
      const bodyLossCandidate = durableBodyEmpty && !isEmpty(loser.body)
      if (titleLossCandidate || bodyLossCandidate) {
        totalCases += 1
        cases.push({
          site: siteName,
          durableId,
          loserId: loser.id,
          titleLossCandidate,
          bodyLossCandidate,
          durableTitle: durable.title,
          durableBody: durable.body,
          loserTitle: loser.title,
          loserBody: loser.body,
        })
      }
    }
  }
}

console.log(`Durables issues d'une fusion (les 2 sites) = ${totalDurables}`)
console.log(`Cas de perte de contenu candidate (title/body vide sur durable, renseigné sur loser) = ${totalCases}`)

for (const c of cases) {
  console.log('\n---')
  console.log(`site=${c.site} durable=${c.durableId} loser=${c.loserId}`)
  if (c.titleLossCandidate) console.log(`  TITLE perdu : loser.title="${c.loserTitle}"`)
  if (c.bodyLossCandidate) console.log(`  BODY perdu : loser.body="${(c.loserBody || '').slice(0, 200)}"`)
}

console.log(`\nVERDICT = ${totalCases === 0 ? 'NO_DATA_REPAIR' : 'CASES_FOUND — HARD STOP AVANT CORRECTION'}`)
console.log('AUCUNE ÉCRITURE EFFECTUÉE — script lecture seule.')
