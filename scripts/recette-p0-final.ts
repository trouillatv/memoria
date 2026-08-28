/** Recette FINALE P0 Phase 2B — cross-vues + invariant PAR SUJET TÉMOIN. READ-ONLY.
 *  Toutes les surfaces de suivi dérivent de la MÊME population produit (acteurs exclus #228,
 *  knowledge_fact gardé). Au-delà des nombres : canonical → PV1/PV2 → catégorie → libellé. */
import { createClient } from '@supabase/supabase-js'
import { canonicalRunsForSite } from '../lib/documents/pv-history'
import { buildOccurrencePvSummary } from '../lib/documents/occurrence-pv-summary'
import { buildOccurrenceActivityMap, getActorCanonicalIds } from '../lib/documents/occurrence-population'
import { buildEvolutionReadModel } from '../lib/documents/pv-evolution'
import { getPvDelta } from '../lib/documents/pv-comparison'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ok = (b: boolean) => (b ? '✅' : '❌')
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

async function counts(siteId: string) {
  const runs = await canonicalRunsForSite(siteId)
  if (runs.length < 2) return null
  const from = runs[runs.length - 2].id, to = runs[runs.length - 1].id
  const lastIdx = runs.length - 1

  const syn = await buildOccurrencePvSummary(siteId, from, to)
  const am = await buildOccurrenceActivityMap(siteId)
  const evo = await buildEvolutionReadModel(siteId)
  const raw = await getPvDelta(from, to)
  const actorCs = await getActorCanonicalIds(siteId)
  const chr = raw.items.filter((i) => !actorCs.has(i.subjectThreadId))

  const amNouveau = am.rows.filter((r) => r.cells.findIndex((c) => c.state !== 'absent') === lastIdx && lastIdx > 0).length
  const amReopened = am.rows.filter((r) => r.cells.some((c) => c.state === 'reopened')).length
  const evoLast = evo.periods.filter((p) => !p.isSilence).at(-1)
  const chrNouveau = chr.filter((i) => i.transition === 'nouveau').length
  const chrReouvert = chr.filter((i) => i.transition === 'réouvert').length

  return {
    synNouveau: syn.nouveau.length, synReouvert: syn.réouvert.length, synResolu: syn.résolu.length, synNonMent: syn.nonMentionné.length,
    amNouveau, amReopened, amRows: am.rows.length,
    evoAppeared: evoLast?.appeared.length ?? 0, evoReopened: evoLast?.reopened.length ?? 0, evoAggr: evoLast?.aggravated.length ?? 0,
    chrNouveau, chrReouvert,
  }
}

async function main() {
  console.log('════════ CONVERGENCE CROSS-VUES ════════')
  const { data: sites } = await sb.from('sites').select('id, name')
  const targets = [{ id: BELLA, name: 'BELLA NAPOLI' },
    ...((sites ?? []) as Array<{ id: string; name: string }>).filter((s) => /^ocef compostage$|lyc[eé]e petro/i.test(s.name.trim()))]
  const seen = new Set<string>()
  for (const s of targets) {
    if (seen.has(s.name)) continue
    const c = await counts(s.id)
    if (!c) continue
    seen.add(s.name)
    // Convergence STRICTE sur le delta des 2 derniers PV : Synthèse = Historique PV = Chronologie.
    // Évolution mesure une FENÊTRE PAR PÉRIODE (multi-PV) — informational, jamais contraint égal au delta.
    console.log(`\n### ${s.name}`)
    console.log(`   NOUVEAUX (delta 2 PV) → Synthèse=${c.synNouveau} · HistoriquePV=${c.amNouveau} · Chronologie=${c.chrNouveau}  ${ok(c.synNouveau === c.amNouveau && c.synNouveau === c.chrNouveau)}   [Évolution période=${c.evoAppeared}, fenêtre distincte]`)
    console.log(`   RÉOUVERTS → Synthèse=${c.synReouvert} · HistoriquePV=${c.amReopened} · Chronologie=${c.chrReouvert} · Évolution=${c.evoReopened}  ${ok(c.synReouvert === c.amReopened && c.synReouvert === c.chrReouvert && c.synReouvert === c.evoReopened)}`)
    console.log(`   aggravé≠réouvert (Évolution aggravated=${c.evoAggr}, reopened=${c.evoReopened}) : ${ok(c.evoAggr === 0 || c.evoAggr !== c.evoReopened)} · HistoriquePV non vide (${c.amRows} lignes) : ${ok(c.amRows > 0)}`)
  }

  // ── INVARIANT PAR SUJET TÉMOIN (Bella) — via la projection partagée (labels CANONIQUES, dédup) ──
  console.log('\n\n════════ TÉMOINS BELLA — projection partagée : catégorie → libellé canonique ════════')
  const runs = await canonicalRunsForSite(BELLA)
  const syn = await buildOccurrencePvSummary(BELLA, runs[runs.length - 2].id, runs[runs.length - 1].id)
  const inCat = (cat: keyof typeof syn, re: RegExp) => (syn[cat] as Array<{ label: string }>).some((x) => re.test(x.label))
  console.log(`   électrique → réouvert       : ${ok(inCat('réouvert', /Contrôle des installations électriques/i))}`)
  console.log(`   cuisson → réouvert          : ${ok(inCat('réouvert', /cuisson/i))}`)
  console.log(`   nettoyage → réouvert        : ${ok(inCat('réouvert', /Nettoyage/i))}`)
  console.log(`   séparation → non mentionné  : ${ok(inCat('nonMentionné', /Séparation des flux/i))}`)
  console.log(`   un vrai nouveau (Portes CF) : ${ok(inCat('nouveau', /Portes CF/i))}`)
  console.log(`   réouvert = 3 exactement     : ${ok(syn.réouvert.length === 3)} · nouveau = 12 : ${ok(syn.nouveau.length === 12)}`)
  // aucun acteur dans la projection
  const raw = await getPvDelta(runs[runs.length - 2].id, runs[runs.length - 1].id)
  const actorCs = await getActorCanonicalIds(BELLA)
  const actorsInDelta = raw.items.filter((i) => actorCs.has(i.subjectThreadId)).length
  const actorsInSyn = [...syn.réouvert, ...syn.nouveau, ...syn.nonMentionné, ...syn.maintenu].filter((x) => actorCs.has(x.canonicalSubjectId)).length
  console.log(`   acteurs : ${actorsInDelta} dans le delta brut → ${actorsInSyn} dans la projection produit  ${ok(actorsInSyn === 0)}`)
  console.log('\n(READ-ONLY. Même vérité métier : Aperçu → Synthèse → Chronologie → Historique PV → Évolution.)')
}
main().catch((e) => { console.error(e); process.exit(1) })
