// Recette P1-A.1 (2/2) — trouver un corpus qui DÉMONTRE la hiérarchie de visite.
//
// PETRO ne produit qu'une seule famille (`subject_changed`) : la hiérarchie y est
// codée mais invisible. Ce script balaie les chantiers et compte, pour chacun, le
// nombre de familles de contrôle réellement représentées — puis détaille le plan
// du meilleur candidat, où l'on doit voir l'ordre MÉTIER dominer l'urgence
// d'attention (une réserve `medium` avant un sujet modifié `low`).
//
// Lecture seule. Usage : npx tsx scripts/dry-run-p1a1-hierarchie.ts [--site <uuid>]
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../lib/supabase/admin'
import { getSiteOverview } from '../lib/knowledge/site-overview'
import { buildVisitBriefing } from '../lib/knowledge/visit-briefing'
import { isVisitPlanSignal, COPILOT_MAX_VISIT_PLAN } from '../lib/visits/copilot-context'
import { buildVisitPlan, type VisitControl } from '../lib/visits/visit-plan-builder'

const args = process.argv.slice(2)
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const ONLY = argOf('--site')

async function planFor(siteId: string): Promise<VisitControl[]> {
  const [overview, briefing] = await Promise.all([
    getSiteOverview(siteId),
    buildVisitBriefing(siteId),
  ])
  return buildVisitPlan(
    (briefing?.allAttention ?? []).filter((i) => isVisitPlanSignal(i.signal)),
    overview.pvToVerify,
    COPILOT_MAX_VISIT_PLAN,
  )
}

// L'inversion attendue : un contrôle MOINS urgent placé AVANT un plus urgent,
// parce que sa famille métier prime. C'est la preuve demandée en recette.
const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
function inversionsOf(plan: VisitControl[]): VisitControl[] {
  return plan.filter((c, n) =>
    n > 0 && (rank[String(c.priority)] ?? 9) < (rank[String(plan[n - 1].priority)] ?? 9))
}

function detail(plan: VisitControl[]) {
  plan.forEach((c, n) => {
    console.log(`\n${n + 1}. [${c.tierLabel} · attention=${c.priority}] ${c.label}`)
    console.log(`   check   : ${c.check}`)
    console.log(`   why     : ${c.why}`)
    console.log(`   état    : ${c.lastKnown ?? '—'}`)
    console.log(`   depuis  : ${c.changeSinceLastVisit ?? '—'}`)
  })
  const inversions = inversionsOf(plan)
  console.log(`\nInversions urgence→famille (preuve que l'ordre métier domine) : ${inversions.length}`)
  for (const c of inversions) console.log(`   ↑ ${c.label} (${c.tierLabel} · ${c.priority})`)
}

async function main() {
  if (ONLY) {
    const plan = await planFor(ONLY)
    console.log(`\n──── ${ONLY} — ${plan.length} contrôle(s) ────`)
    detail(plan)
    return
  }

  const db = createAdminClient()
  const { data, error } = await db.from('sites').select('id, name').order('name')
  if (error) { console.error('ERREUR:', error.message); process.exit(1) }
  const sites = (data ?? []) as Array<{ id: string; name: string }>

  const rows: Array<{ id: string; name: string; total: number; tiers: string[]; inv: number }> = []
  for (const s of sites) {
    try {
      const plan = await planFor(s.id)
      if (plan.length === 0) continue
      const tiers = [...new Set(plan.map((c) => c.tier))]
      rows.push({ id: s.id, name: s.name, total: plan.length, tiers, inv: inversionsOf(plan).length })
    } catch {
      // Un chantier illisible ne bloque pas le balayage.
    }
  }

  rows.sort((a, b) => b.inv - a.inv || b.tiers.length - a.tiers.length || b.total - a.total)
  console.log('\n──── Familles de contrôle représentées, par chantier ────')
  for (const r of rows) {
    console.log(`${String(r.tiers.length)} famille(s) · ${String(r.total).padStart(2)} contrôle(s) · ${r.inv} inversion(s)  ${r.id.slice(0, 8)}  ${r.name}`)
    console.log(`    ${r.tiers.join(', ')}`)
  }

  const best = rows[0]
  if (best && best.tiers.length > 1) {
    console.log(`\n\n──── Candidat recette hiérarchie : ${best.name} ────`)
    detail(await planFor(best.id))
  } else {
    console.log('\n⚠️  Aucun chantier ne représente plus d’une famille : la hiérarchie reste non démontrable.')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
