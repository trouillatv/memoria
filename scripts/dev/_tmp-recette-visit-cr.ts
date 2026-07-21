/**
 * RECETTE RÉELLE — le CR de visite comme document (Étape A).
 *
 * Ce que le navigateur ne peut PAS prouver : deux appels concurrents. Ce script
 * les déclenche pour de vrai, sur la base réelle, et vérifie qu'il n'en reste
 * qu'un seul document. Il couvre aussi le non-écrasement d'une correction
 * humaine et la restauration ciblée.
 *
 * Il n'écrit QUE sur le document de la visite choisie. Il ne touche aucun objet
 * métier. Fichier temporaire de recette : à supprimer une fois le lot clos.
 *
 *   npx tsx scripts/dev/_tmp-recette-visit-cr.ts
 */
import 'dotenv/config'
import * as fs from 'fs'

for (const rawLine of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split('\n') : []) {
  const m = rawLine.replace(/\r$/, '').match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!
}

import { createClient } from '@supabase/supabase-js'
import { buildVisitCrSections, CR_VISITE_TEMPLATE_KEY } from '../../lib/visits/cr-visite-sections'
import { withAiBaseline, restoreSectionProposal, hasHumanEdits } from '../../lib/visits/cr-visite-policy'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** La même opération que `getOrCreateVisitCrDocument`, en direct (hors Next). */
async function getOrCreate(reportId: string, siteId: string | null, orgId: string | null, analysis: unknown) {
  const { data: found } = await db
    .from('report_documents')
    .select('id, sections, status')
    .eq('report_id', reportId)
    .eq('template_key', CR_VISITE_TEMPLATE_KEY)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (found) return found

  const sections = withAiBaseline(buildVisitCrSections(analysis as never))
  const { data, error } = await db
    .from('report_documents')
    .insert({ report_id: reportId, site_id: siteId, organization_id: orgId, template_key: CR_VISITE_TEMPLATE_KEY, sections, status: 'draft' })
    .select('id, sections, status')
    .single()
  if (error) {
    // La course perdue : on relit le gagnant plutôt que de propager l'erreur.
    const { data: winner } = await db
      .from('report_documents')
      .select('id, sections, status')
      .eq('report_id', reportId)
      .eq('template_key', CR_VISITE_TEMPLATE_KEY)
      .maybeSingle()
    if (winner) return winner
    throw error
  }
  return data
}

async function main() {
  const { data: visits } = await db
    .from('site_reports')
    .select('id, site_id, organization_id, debrief_analysis')
    .not('debrief_analysis', 'is', null)
    .not('origin', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)

  const visit = visits?.[0] as { id: string; site_id: string | null; organization_id: string | null; debrief_analysis: unknown } | undefined
  if (!visit) {
    console.log('Aucune visite avec analyse en cache — recette impossible.')
    process.exit(2)
  }
  console.log(`Visite de recette : ${visit.id}\n`)

  // On repart d'un état propre pour CETTE visite uniquement.
  await db.from('report_documents').delete().eq('report_id', visit.id).eq('template_key', CR_VISITE_TEMPLATE_KEY)

  // ── 1. DEUX CRÉATIONS CONCURRENTES ────────────────────────────────────────
  const [a, b] = await Promise.all([
    getOrCreate(visit.id, visit.site_id, visit.organization_id, visit.debrief_analysis),
    getOrCreate(visit.id, visit.site_id, visit.organization_id, visit.debrief_analysis),
  ])
  check('deux appels concurrents rendent le MÊME document', a!.id === b!.id, `${a!.id} / ${b!.id}`)

  const { count } = await db
    .from('report_documents')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', visit.id)
    .eq('template_key', CR_VISITE_TEMPLATE_KEY)
  check('une seule ligne cr_visite.v1 pour ce rapport', count === 1, `count=${count}`)

  const created = a as { id: string; sections: Array<{ key: string; content: string; ai_content?: string }> }
  check('sept sections créées', created.sections.length === 7, `${created.sections.length}`)
  check('origine IA figée à la création', !hasHumanEdits(created.sections as never))

  // ── 2. CORRECTION HUMAINE ─────────────────────────────────────────────────
  const corrige = created.sections.map((s) =>
    s.key === 'resume' ? { ...s, content: 'RÉSUMÉ CORRIGÉ PAR LA RECETTE' } : s,
  )
  await db.from('report_documents').update({ sections: corrige }).eq('id', created.id).eq('status', 'draft')

  // ── 3. RAPPEL DE getOrCreate : LA CORRECTION DOIT SURVIVRE ────────────────
  const again = (await getOrCreate(visit.id, visit.site_id, visit.organization_id, visit.debrief_analysis)) as typeof created
  check('même document au rappel', again.id === created.id)
  const resume = again.sections.find((s) => s.key === 'resume')!
  check('la correction humaine n’a PAS été écrasée', resume.content === 'RÉSUMÉ CORRIGÉ PAR LA RECETTE', resume.content.slice(0, 40))
  check('la proposition IA est toujours conservée à part', resume.ai_content !== undefined && resume.ai_content !== resume.content)
  check('hasHumanEdits détecte le passage humain', hasHumanEdits(again.sections as never))

  // ── 4. RESTAURATION CIBLÉE ────────────────────────────────────────────────
  const autreAvant = again.sections.find((s) => s.key === 'decisions')!.content
  const restaure = restoreSectionProposal(again.sections as never, 'resume')
  await db.from('report_documents').update({ sections: restaure }).eq('id', created.id).eq('status', 'draft')
  const { data: after } = await db.from('report_documents').select('sections').eq('id', created.id).single()
  const secs = (after as { sections: Array<{ key: string; content: string; ai_content?: string }> }).sections
  const resumeApres = secs.find((s) => s.key === 'resume')!
  check('« revenir à la proposition » restaure la section', resumeApres.content === resumeApres.ai_content)
  check('les autres sections n’ont pas bougé', secs.find((s) => s.key === 'decisions')!.content === autreAvant)

  // ── 5. LECTURE SEULE UNE FOIS VALIDÉ ──────────────────────────────────────
  await db.from('report_documents').update({ status: 'validated' }).eq('id', created.id)
  const tentative = secs.map((s) => (s.key === 'resume' ? { ...s, content: 'NE DOIT PAS PASSER' } : s))
  await db.from('report_documents').update({ sections: tentative }).eq('id', created.id).eq('status', 'draft')
  const { data: locked } = await db.from('report_documents').select('sections, status').eq('id', created.id).single()
  const lockedSecs = (locked as { sections: Array<{ key: string; content: string }> }).sections
  check(
    'un document validé refuse l’écriture',
    lockedSecs.find((s) => s.key === 'resume')!.content !== 'NE DOIT PAS PASSER',
  )

  // On laisse la visite dans un état propre : brouillon, proposition d'origine.
  await db
    .from('report_documents')
    .update({ status: 'draft', sections: withAiBaseline(buildVisitCrSections(visit.debrief_analysis as never)) })
    .eq('id', created.id)

  console.log(`\n${failures === 0 ? 'RECETTE VERTE' : `RECETTE ROUGE — ${failures} échec(s)`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
