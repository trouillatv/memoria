/** #231 Phase 1 — caractérise les reports porteurs des propositions « proposées » (READ-ONLY).
 *  Ces reports sont-ils des visites réelles atteignables (/visites/[id]/memoire) ? imports ? */
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

const SITES = ['cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6', '06c62e48', '75bd3d23'] // Bella, OCEF (prefix), PETRO (prefix)

async function main() {
  const { data: sites } = await sb.from('sites').select('id, name')
  const all = (sites ?? []) as Array<{ id: string; name: string }>
  const targets = all.filter((s) => SITES.some((p) => s.id.startsWith(p.slice(0, 8))))

  for (const s of targets) {
    const { data: props } = await sb
      .from('site_knowledge_proposals')
      .select('report_id')
      .eq('site_id', s.id).eq('kind', 'action').eq('status', 'proposed')
    const reportIds = [...new Set(((props ?? []) as Array<{ report_id: string | null }>).map((p) => p.report_id))]
    console.log(`\n### ${s.name}  — ${reportIds.length} report(s) porteur(s)`)
    for (const rid of reportIds) {
      if (!rid) { console.log(`   report_id=null → aucune page visite`); continue }
      const { data: rep } = await sb.from('site_reports').select('id, origin, started_at, ended_at, text_input').eq('id', rid).maybeSingle()
      const r = rep as { id: string; origin: string | null; started_at: string | null; ended_at: string | null; text_input: string | null } | null
      const { count } = await sb.from('site_knowledge_proposals').select('id', { count: 'exact', head: true })
        .eq('site_id', s.id).eq('kind', 'action').eq('status', 'proposed').eq('report_id', rid)
      console.log(`   report ${rid.slice(0, 8)}  origin=${r?.origin ?? '??'}  ${r?.text_input ? `"${r.text_input.slice(0, 30)}"` : ''}  → ${count} proposées  → page /visites/${rid.slice(0, 8)}…`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
