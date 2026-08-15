// Trace P1-A.1 en PRODUCTION — mandat Vincent du 15/08 : « aucune nouvelle
// fonctionnalité, tracer ces trois requêtes exactes ».
//
// Lecture seule de `copilot_interactions` (mig 294), déjà écrite par la Server
// Action à chaque échange. On ne rejoue rien : on lit ce que la production a
// réellement produit, puis on date chaque échange par rapport aux déploiements
// pour savoir QUEL build a servi la capture.
//
// Champs demandés → source :
//   deploymentId ............ déduit de created_at vs table des déploiements READY
//   intent déterministe ..... NON tracé aujourd'hui (voir rapport)
//   intent après compréhension → déduit : proposal_kind non nul ⇒ intent ≠ READ
//   safeIntent .............. déduit de primary_intent via INTENT_FILTER_MAP
//   nb de contrôles ......... NON tracé ; proxy = 'visit_plan' ∈ sources_used
//   source llm|fallback ..... answer_mode / used_fallback
//   erreur parsing/schéma ... NON tracé (console serveur uniquement)
//   type de réponse à l'UI .. déduit : proposal / clarification / answer
//
// Usage : npx tsx scripts/trace-p1a-prod-3-requetes.ts [--hours 48]
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../lib/supabase/admin'

const args = process.argv.slice(2)
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const HOURS = Number(argOf('--hours') ?? 72)

// Déploiements production READY (epoch ms), relevés via l'API Vercel le 15/08.
// `ee96c862` porte la garde de routage P1-A.1 ; `d4617560` porte le correctif
// a1665286 (budget de tokens + schéma proportionnels).
const DEPLOYMENTS: Array<{ sha: string; readyAt: number; note: string }> = [
  { sha: '93b4e790', readyAt: 1786749938376, note: 'avant P1-A.1' },
  { sha: '20523e3d', readyAt: 1786751497312, note: 'avant P1-A.1' },
  { sha: 'ee96c862', readyAt: 1786754408560, note: 'P1-A.1 : garde routage + buildVisitPlan' },
  { sha: '9bb923df', readyAt: 1786754570333, note: 'P1-A.1' },
  { sha: 'd4617560', readyAt: 1786756001331, note: 'a1665286 : budget tokens + schéma' },
]

function deploymentAt(iso: string): string {
  const t = new Date(iso).getTime()
  let hit: (typeof DEPLOYMENTS)[number] | null = null
  for (const d of DEPLOYMENTS) if (t >= d.readyAt) hit = d
  return hit ? `${hit.sha} (${hit.note})` : 'antérieur à 93b4e790'
}

const INTENT_FILTER_MAP: Record<string, string> = {
  timeline: 'changes', plan_visite: 'next_visit', action_status: 'attention',
  subject_detail: 'attention', actor: 'attention', stagnation: 'stale', global: 'attention',
}

// Les trois formulations de la recette production. Filtrage par motif, pas par
// égalité stricte : l'UI mobile peut ponctuer différemment.
const PATTERNS = [
  { key: 'A. Fais-moi les points de contrôle', re: /points?\s+de\s+contr/i },
  { key: 'B. Prépare-moi ma visite',            re: /pr[ée]pare/i },
  { key: 'C. Je vérifie quoi',                  re: /v[ée]rifie\s+quoi|je\s+v[ée]rifie/i },
]

type Row = {
  created_at: string
  site_id: string | null
  question: string
  primary_intent: string | null
  secondary_intents: string[] | null
  scope: string | null
  answer_mode: string
  answer_status: string
  used_fallback: boolean
  proposal_kind: string | null
  proposal_status: string | null
  sources_used: string[] | null
  cited_reference_count: number | null
  latency_ms: number | null
  answer_text: string | null
  voice_used: boolean | null
}

function uiKind(r: Row): string {
  if (r.proposal_kind) return `proposal (${r.proposal_kind})`
  if (r.answer_mode === 'clarification') return 'clarification'
  return 'answer'
}

async function main() {
  const db = createAdminClient()
  const since = new Date(Date.now() - HOURS * 3_600_000).toISOString()

  const { data, error } = await db
    .from('copilot_interactions')
    .select('created_at, site_id, question, primary_intent, secondary_intents, scope, answer_mode, answer_status, used_fallback, proposal_kind, proposal_status, sources_used, cited_reference_count, latency_ms, answer_text, voice_used')
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  if (error) { console.error('ERREUR:', error.message); process.exit(1) }
  const rows = (data ?? []) as Row[]
  console.log(`\n${rows.length} interaction(s) Copilote sur les ${HOURS} dernières heures.\n`)

  for (const p of PATTERNS) {
    const matches = rows.filter((r) => p.re.test(r.question))
    console.log(`\n════════════════════════════════════════════════════════════`)
    console.log(`${p.key} — ${matches.length} occurrence(s)`)
    console.log(`════════════════════════════════════════════════════════════`)
    for (const r of matches) {
      const safeIntent = INTENT_FILTER_MAP[r.primary_intent ?? ''] ?? 'attention'
      const planInjecte = (r.sources_used ?? []).includes('visit_plan')
      console.log(`\n  ${r.created_at}  ${r.voice_used ? '[vocal]' : '[texte]'}`)
      console.log(`  « ${r.question} »`)
      console.log(`  déploiement servant .......... ${deploymentAt(r.created_at)}`)
      console.log(`  intent après compréhension ... ${r.proposal_kind ? 'ÉCRITURE (sortie anticipée)' : 'READ'}`)
      console.log(`  primary_intent ............... ${r.primary_intent ?? '—'}  → safeIntent=${r.proposal_kind ? 'n/a' : safeIntent}`)
      console.log(`  plan de visite injecté ....... ${r.proposal_kind ? 'non (jamais atteint)' : planInjecte ? 'OUI' : 'NON'}`)
      console.log(`  source ....................... ${r.answer_mode} (fallback=${r.used_fallback})`)
      console.log(`  réponse rendue à l'UI ........ ${uiKind(r)}  [${r.answer_status}]`)
      console.log(`  sources_used ................. ${(r.sources_used ?? []).join(', ') || '—'}`)
      console.log(`  latence ...................... ${r.latency_ms ?? '—'} ms`)
      if (r.answer_text) console.log(`  texte ........................ ${r.answer_text.slice(0, 220).replace(/\n/g, ' ⏎ ')}${r.answer_text.length > 220 ? '…' : ''}`)
    }
    if (matches.length === 0) console.log('  (aucune trace — la question n’a pas été posée sur cet intervalle)')
  }

  // Contexte : tout ce qui a produit un brouillon, quelle qu'en soit la formulation.
  const proposals = rows.filter((r) => r.proposal_kind)
  console.log(`\n\n──── Tous les brouillons produits sur l'intervalle (${proposals.length}) ────`)
  for (const r of proposals) {
    console.log(`  ${r.created_at}  ${r.proposal_kind}  ${deploymentAt(r.created_at).split(' ')[0]}  « ${r.question} »`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
