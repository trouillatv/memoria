// P0-H (Vincent, 2026-08-18) — backfill ponctuel : corrige site_decisions.date_decision
// pour le site PETRO ATTITI (75bd3d23-d515-46bd-8de8-254495a5bade) afin qu'elle
// reflète la date de la VISITE source (site_reports.started_at) plutôt que le jour
// de promotion de la proposition (défaut DB current_date, cf. knowledge-proposals.ts).
// Portée : uniquement ce chantier, pour satisfaire le critère de recette P0-H (la
// décision « accès employés » doit citer le 15 juillet, pas le 17). Pas de backfill
// global multi-chantiers dans ce lot.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createAdminClient } from '../lib/supabase/admin'

const SITE_ID = '75bd3d23-d515-46bd-8de8-254495a5bade'

async function main() {
  const db = createAdminClient()

  const { data: decisions, error } = await db
    .from('site_decisions')
    .select('id, titre, date_decision, report_id')
    .eq('site_id', SITE_ID)
  if (error) throw new Error(error.message)

  const reportIds = [...new Set((decisions ?? []).map((d) => d.report_id).filter(Boolean))] as string[]
  const { data: reports } = await db
    .from('site_reports')
    .select('id, started_at, created_at')
    .in('id', reportIds)
  const reportById = new Map((reports ?? []).map((r) => [r.id, r]))

  for (const d of decisions ?? []) {
    const r = d.report_id ? reportById.get(d.report_id) : null
    const visitDate = (r?.started_at ?? r?.created_at)?.slice(0, 10) ?? null
    if (!visitDate || visitDate === d.date_decision) {
      console.log(`[SKIP] ${d.id.slice(0, 8)} déjà correcte (${d.date_decision})`)
      continue
    }
    const { error: upErr } = await db
      .from('site_decisions')
      .update({ date_decision: visitDate })
      .eq('id', d.id)
    if (upErr) {
      console.error(`[KO] ${d.id.slice(0, 8)}:`, upErr.message)
      continue
    }
    console.log(`[OK] ${d.id.slice(0, 8)} : ${d.date_decision} → ${visitDate} ("${d.titre.slice(0, 60)}...")`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
