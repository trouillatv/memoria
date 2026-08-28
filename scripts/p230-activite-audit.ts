/**
 * #230 Phase 1 READ-ONLY — audit « Depuis le dernier PV ». Mesure les catégories d'activité entre les 2
 * derniers PV, via getPvDelta (occurrence-first, même source que Chronologie/#229), + raffinement
 * nouveau/réapparu depuis l'axe de présence (buildSiteSubjectCells). Compare au pvLastDelta actuel.
 * Aucune écriture. Garde-fou anti-flood : nombre de lignes réellement affichables.
 */
import { createClient } from '@supabase/supabase-js'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
import { getPvDelta } from '../lib/documents/pv-comparison'
import { buildSiteSubjectCells } from '../lib/documents/site-occurrence-timeline'
import { getSiteOverview } from '../lib/knowledge/site-overview'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function auditSite(siteId: string, name: string) {
  const runs = await canonicalRunsForSite(siteId)
  if (runs.length < 2) { console.log(`\n### ${name} — <2 PV, delta inapplicable`); return }
  const from = runs[runs.length - 2], to = runs[runs.length - 1]
  const delta = await getPvDelta(from.id, to.id)
  const view = await buildSiteSubjectCells(siteId)
  const toIdx = view.runs.findIndex((r) => r.id === to.id)
  const cellsByCs = new Map(view.rows.map((r) => [r.canonicalSubjectId, r.cells]))

  // Raffinement nouveau → réapparu : un « nouveau » ayant une présence réelle AVANT le PV courant = réapparu.
  const cat = new Map<string, { cs: string; label: string }[]>()
  const push = (k: string, cs: string, label: string) => { if (!cat.has(k)) cat.set(k, []); cat.get(k)!.push({ cs, label }) }
  for (const it of delta.items) {
    let c = it.transition as string
    if (c === 'nouveau') {
      const cells = cellsByCs.get(it.subjectThreadId) ?? []
      const firstReal = cells.findIndex((x) => x && !x.isGap)
      c = firstReal >= 0 && firstReal < toIdx ? 'réapparu' : 'nouveau'
    }
    if (c === 'levé' || c === 'réalisé') c = 'résolu'
    push(c, it.subjectThreadId, it.label)
  }
  const n = (k: string) => (cat.get(k)?.length ?? 0)

  const ov = await getSiteOverview(siteId)
  console.log(`\n### ${name}  (PV ${from.id.slice(0, 8)} → ${to.id.slice(0, 8)})`)
  console.log(`   pvLastDelta ACTUEL : ${JSON.stringify(ov.pvLastDelta && { nouveaux: ov.pvLastDelta.nouveaux, aggravésRéouverts: ov.pvLastDelta.aggravésRéouverts, réalisésLevés: ov.pvLastDelta.réalisésLevés })}`)
  console.log(`   getPvDelta occurrence-first (${delta.items.length} sujets) :`)
  console.log(`     réouvert=${n('réouvert')}  aggravé=${n('aggravé')}  nouveau=${n('nouveau')}  réapparu=${n('réapparu')}  résolu=${n('résolu')}  maintenu=${n('maintenu')}  non_mentionné=${n('non_mentionné')}  progressé=${n('progressé')}  changé=${n('changé')}  annulé=${n('annulé')}`)
  // Lignes « changement réel » (hors maintenu/non_mentionné qui sont volumineux et peu informatifs)
  const changeCats = ['réouvert', 'aggravé', 'nouveau', 'réapparu', 'résolu', 'progressé', 'changé', 'annulé']
  const changeLines = changeCats.reduce((a, k) => a + n(k), 0)
  console.log(`     → « vrais changements » (hors maintenu/non_mentionné) = ${changeLines} lignes  ·  maintenu+non_mentionné = ${n('maintenu') + n('non_mentionné')} (volumineux)`)
  for (const k of ['réouvert', 'aggravé', 'nouveau', 'réapparu']) {
    const arr = cat.get(k) ?? []
    if (arr.length) console.log(`     ${k} : ${arr.slice(0, 6).map((x) => x.label.slice(0, 30)).join(' | ')}${arr.length > 6 ? ` … (+${arr.length - 6})` : ''}`)
  }
}

async function main() {
  console.log('╔════ #230 Phase 1 — audit « Depuis le dernier PV » (READ-ONLY) ════╗')
  await auditSite(BELLA, 'BELLA NAPOLI')
  const { data: sites } = await sb.from('sites').select('id, name')
  for (const s of ((sites ?? []) as Array<{ id: string; name: string }>).filter((s) => s.id.startsWith('2c939e67') || s.id.startsWith('06c62e48'))) {
    await auditSite(s.id, s.name)
  }
  console.log('\n(READ-ONLY. Séparation aggravé/réouvert = directe depuis getPvDelta ; nouveau/réapparu = axe de présence. Aucune nouvelle sémantique.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
