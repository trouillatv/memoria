/**
 * #228 recette LIVE — vérifie que le comportement RÉEL (code Lot A appliqué) correspond aux prédictions
 * de la simulation p227c. Utilise les fonctions RÉELLES getNavigableSubjectsForSite + computeAttentionSignals.
 * READ-ONLY.
 */
import { createClient } from '@supabase/supabase-js'
import { getNavigableSubjectsForSite } from '../lib/db/canonical-subject-life'
import { isOperationalSubject } from '../lib/subjects/kind'
import { computeAttentionSignals } from '../lib/subjects/attention'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const TARGET = /bella|ocef|petro/i
const CLOSED = new Set(['done', 'cancelled', 'not_applicable'])
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
const TEMOINS: Record<string, string> = {
  '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9': 'A électrique', 'b78526f9-9dc6-43f7-8edb-e4278f207988': 'B cuisson',
  '22bef24e-3a1a-4566-beca-c5a5c845dd1d': 'C nettoyage', '75da7744-287d-47fd-80d8-e62ea1660ca1': 'D flux',
  'cc12fce6-8780-4f93-88a1-21905a37325b': 'E éclairage',
}
// Prédictions APRÈS de la simulation p227c (élig, attn).
const PRED: Record<string, [number, number]> = {
  'BELLA NAPOLI': [8, 3], 'Lycée PETRO ATTITI': [15, 3], 'OCEF — Recette Chemin B': [32, 12],
  'OCEF Compostage[2c]': [75, 29], 'OCEF Compostage[06]': [19, 14], 'Ocef4': [4, 0],
}
function pad(s: string, n: number): string { return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length) }

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const matched: Array<{ id: string; name: string }> = []
  for (const s of ((sites ?? []) as Array<{ id: string; name: string }>).filter((x) => TARGET.test(x.name))) {
    const { count } = await sb.from('canonical_subject_occurrence').select('*', { count: 'exact', head: true }).eq('site_id', s.id)
    if ((count ?? 0) > 0) matched.push(s)
  }
  matched.sort((a, b) => a.name.localeCompare(b.name))

  console.log('#228 RECETTE LIVE — élig/attn RÉELS (post-fix) vs prédiction p227c\n')
  console.log(`${pad('Chantier', 26)}${pad('élig', 8)}${pad('attn', 8)}${pad('actErr', 8)}${pad('stag', 8)}prédit(élig/attn)`)
  let actorErrTotal = 0
  for (const site of matched) {
    const nav = await getNavigableSubjectsForSite(site.id)
    const elig = nav.filter((s) => isOperationalSubject(s.durableKind) && !CLOSED.has(s.currentStatus ?? ''))
    const attn = nav.filter((s) => computeAttentionSignals(s).attentionReasons.length > 0)
    const actorErr = elig.filter((s) => s.durableKind === 'actor')
    actorErrTotal += actorErr.length
    const stag = nav.filter((s) => s.isStagnant && isOperationalSubject(s.durableKind))
    const key = site.name.includes('2c93') || site.id.startsWith('2c939e67') ? 'OCEF Compostage[2c]'
      : site.id.startsWith('06c62e48') ? 'OCEF Compostage[06]' : site.name
    const p = PRED[key] ?? PRED[site.name]
    console.log(`${pad(site.name, 26)}${pad(String(elig.length), 8)}${pad(String(attn.length), 8)}${pad(String(actorErr.length), 8)}${pad(String(stag.length), 8)}${p ? `${p[0]}/${p[1]}` : '—'}`)
  }
  console.log(`\nActeurs inclus par erreur (total) : ${actorErrTotal}  (attendu : 0)`)

  console.log('\nBELLA — 5 témoins (LIVE) : durableKind / dominantFamily / triState / attention')
  const nav = await getNavigableSubjectsForSite(BELLA)
  for (const [cs, name] of Object.entries(TEMOINS)) {
    const s = nav.find((x) => x.canonicalSubjectId === cs); if (!s) { console.log(`  ${name}: absent`); continue }
    const sig = computeAttentionSignals(s)
    console.log(`  ${pad(name, 14)} ${pad(s.durableKind ?? 'null', 16)} ${pad(s.dominantFamily ?? 'null', 14)} ${pad(s.currentTriState, 9)} op=${sig.isOperational} [${sig.attentionReasons.join(',') || '∅'}]`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
