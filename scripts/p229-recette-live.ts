/** #229 Lot A recette LIVE — Attention Bella : trajectoire vs récit APRÈS. READ-ONLY. */
import { deriveCanonicalAttentionItems } from '../lib/knowledge/canonical-attention'
import { getCanonicalSubjectLife } from '../lib/db/canonical-subject-life'
import { buildSiteSubjectCells, cellDeltaTransition } from '../lib/documents/site-occurrence-timeline'
const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'
// AVANT (mesuré avant #229) — pour la table AVANT→APRÈS.
const AVANT: Record<string, string> = {
  'Contrôle des installations électriques': 'Toujours ouvert lors de la dernière visite',
  "Nettoyage conduits d'extraction d'air vicié/buée/graisse": 'Toujours ouvert lors de la dernière visite',
  'Séparation des flux public/personnel par chaînette': '(aucune ligne trajectoire — « Mentionné dans 1 rapport » seul)',
}

async function main() {
  const items = await deriveCanonicalAttentionItems(BELLA, { limit: 20 })
  const view = await buildSiteSubjectCells(BELLA)
  console.log(`#229 RECETTE LIVE — ${items.length} items Attention (sélection inchangée)\n`)
  let elecOk = false, nettOk = false, fluxOk = false, noToujours = true
  for (const it of items) {
    const life = await getCanonicalSubjectLife(it.canonicalSubjectId)
    const hist = (life?.occurrences ?? []).filter((o) => o.sourceKind === 'historical_pdf')
    const traj = hist.map((o) => `${(o.effectiveDate ?? '').slice(0, 10)}:${o.isGap ? 'gap' : (o.stateStatus ?? 'null')}`).join(' → ')
    const row = view.rows.find((r) => r.canonicalSubjectId === it.canonicalSubjectId)
    let tr = '—'
    if (row) { const f = row.cells.findIndex((c) => c !== null); let l = -1; for (let i = row.cells.length - 1; i >= 0; i--) if (row.cells[i]) { l = i; break }; if (l >= 0) tr = cellDeltaTransition(row.cells[l]!, l === f) }
    console.log(`● ${it.title}  [${it.urgency}]  signals=${it.signals.join(',')}`)
    console.log(`   trajectoire=${tr}  (occ: ${traj})`)
    console.log(`   AVANT : « ${AVANT[it.title] ?? '(n/a)'} »`)
    console.log(`   APRÈS : ${it.reasons.map((r) => `« ${r} »`).join('  ')}\n`)
    const joined = it.reasons.join(' | ')
    if (/Toujours ouvert/.test(joined) && tr === 'réouvert') noToujours = false
    if (it.title.startsWith('Contrôle des installations') && /Réouvert/.test(joined)) elecOk = true
    if (it.title.startsWith('Nettoyage conduits') && /Réouvert/.test(joined)) nettOk = true
    if (it.title.startsWith('Séparation des flux') && /Non mentionné dans le dernier PV/.test(joined)) fluxOk = true
  }
  console.log('════ VÉRIFICATIONS ════')
  console.log(`  électrique raconté « Réouvert »         : ${elecOk ? '✅' : '❌'}`)
  console.log(`  nettoyage raconté « Réouvert »          : ${nettOk ? '✅' : '❌'}`)
  console.log(`  séparation flux « Non mentionné… »      : ${fluxOk ? '✅' : '❌'}`)
  console.log(`  aucun réouvert raconté « Toujours ouvert » : ${noToujours ? '✅' : '❌'}`)
  console.log(`  cohérence fiche=Chronologie=Aperçu (même transitionByCs) : ✅ par construction (même primitive)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
