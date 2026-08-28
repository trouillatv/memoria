/**
 * P0-3 — SONDE CROSS-VUES READ-ONLY des 5 témoins Bella.
 *
 * Outil de RECETTE uniquement. Il n'est réutilisé par aucun read-model : il ne doit pas
 * devenir une couche d'agrégation supplémentaire (ce serait recréer exactement ce que P0-2d
 * vient de supprimer). Il se contente d'appeler les read-models EXISTANTS et d'imprimer, côte à
 * côte, ce que chacun raconte pour un même sujet canonique, avec ses preuves minimales.
 *
 * Contrat (Vincent) — la sonde ne doit :
 *   - ajouter aucune règle métier ;
 *   - réinterpréter aucun état ;
 *   - corriger aucune divergence ;
 *   - écrire aucune donnée ;
 *   - masquer aucun null, gap, non-mention ou héritage legacy.
 *
 * Le VERDICT est INFORMATIF, jamais décisionnel : il n'affirme jamais que deux formulations sont
 * « équivalentes ». Il ne lève un drapeau que sur des faits STRUCTURELS (identité, présence
 * d'occurrence, chemin legacy). Pour tout le reste il renvoie REVIEW = « aucun drapeau structurel,
 * lecture humaine requise ».
 *
 * Sources (read-models existants, inchangés) :
 *   Aperçu        → deriveSiteAttentionItems(siteId)          (lib/knowledge/site-attention-items)
 *   Fiche sujet   → getCanonicalSubjectLife(cs)               (lib/db/canonical-subject-life)
 *   Tension       → règle du read-model (runTensionState + tensionTrajectory) appliquée au seul
 *                   sujet, sur la MÊME source d'occurrences (fetchSiteHistoricalOccurrences).
 *                   Tension est un AGRÉGAT site-level : sa projection par sujet répond à une règle
 *                   propre (« résolu seulement si tout prouvé résolu »). Une projection différente
 *                   n'est donc pas une contradiction.
 *   Chronologie   → getPvDelta(from,to) sur chaque paire de PV consécutifs (lib/documents/pv-comparison)
 *   Lignes de vie → getSiteSubjectMatrix(siteId)              (lib/documents/pv-history)
 *
 * READ-ONLY : aucune écriture. Exécuter : npx tsx --env-file=.env.local scripts/p0-3-cross-view-probe.ts
 */
import { deriveSiteAttentionItems } from '../lib/knowledge/site-attention-items'
import { getCanonicalSubjectLife } from '../lib/db/canonical-subject-life'
import { getSiteSubjectMatrix, canonicalRunsForSite } from '../lib/documents/pv-history'
import { getPvDelta } from '../lib/documents/pv-comparison'
import { fetchSiteHistoricalOccurrences } from '../lib/documents/site-occurrence-timeline'
import { runTensionState, tensionTrajectory } from '../lib/documents/subject-state'
import { OPERATIONAL_EXCLUDED_FAMILIES } from '../lib/documents/canonical-transitions'

const BELLA = 'cda9f47e-98b8-4fe0-9d79-1070bd0cf6f6'

// Les 5 témoins P0-3 (canonical_subject_id résolus en base — labels bruts pour traçabilité).
const TEMOINS: Array<{ code: string; cs: string; label: string }> = [
  { code: 'A électrique', cs: '2504ad1f-99a5-46e2-8c00-12b4aef0f7e9', label: 'Contrôle des installations électriques' },
  { code: 'B cuisson',    cs: 'b78526f9-9dc6-43f7-8edb-e4278f207988', label: 'Contrôle des appareils de cuisson/remise en température' },
  { code: 'C nettoyage',  cs: '22bef24e-3a1a-4566-beca-c5a5c845dd1d', label: "Nettoyage conduits d'extraction d'air vicié/buée/graisse" },
  { code: 'D flux',       cs: '75da7744-287d-47fd-80d8-e62ea1660ca1', label: 'Séparation des flux public/personnel par chaînette' },
  { code: 'E éclairage',  cs: 'cc12fce6-8780-4f93-88a1-21905a37325b', label: 'Contrôle éclairage de sécurité' },
]

function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length) }

async function main() {
  const runs = await canonicalRunsForSite(BELLA)
  const runOrder = runs.map((r) => r.id)
  const runShort = (id: string | null) => (id && runOrder.indexOf(id) >= 0 ? `PV${runOrder.indexOf(id) + 1}` : '??')

  // ── Vues agrégées chargées une seule fois ──────────────────────────────────
  const attention = await deriveSiteAttentionItems(BELLA)
  const matrix = await getSiteSubjectMatrix(BELLA)
  const { runs: occRuns, byCsRun, familiesByCs } = await fetchSiteHistoricalOccurrences(BELLA)

  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║  P0-3 — SONDE CROSS-VUES READ-ONLY · Bella Napoli · 5 témoins                   ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  console.log(`Chantier ${BELLA} — ${occRuns.length} PV canoniques : ${occRuns.map((r, i) => `PV${i + 1}(${r.effectiveDate})`).join('  ')}`)
  console.log(`Aperçu : ${attention.length} items d'attention au total sur le chantier.`)
  console.log('Verdict INFORMATIF : REVIEW = aucun drapeau structurel, lecture humaine requise.\n')

  // Chronologie : delta de chaque paire de PV consécutifs, indexé par canonical.
  const deltas: Array<{ from: string; to: string; byCs: Map<string, string> }> = []
  for (let i = 0; i + 1 < runs.length; i++) {
    const d = await getPvDelta(runs[i].id, runs[i + 1].id)
    const byCs = new Map<string, string>()
    for (const it of d.items) byCs.set(it.subjectThreadId, it.transition)
    deltas.push({ from: runs[i].id, to: runs[i + 1].id, byCs })
  }

  const summaryRows: Array<{ code: string; apercu: string; fiche: string; tension: string; chrono: string; ldv: string; verdict: string }> = []

  for (const t of TEMOINS) {
    console.log('────────────────────────────────────────────────────────────────────────────────')
    console.log(`### ${t.code}  [cs ${t.cs.slice(0, 8)}]  « ${t.label} »`)

    // ── Aperçu ────────────────────────────────────────────────────────────────
    // Rattachement d'un item au sujet : soit metadata.canonicalSubjectId, soit href /…/<cs>.
    const apercuItems = attention.filter((a) => {
      const metaCs = (a.metadata as { canonicalSubjectId?: string } | undefined)?.canonicalSubjectId
      return metaCs === t.cs || a.href.includes(`/${t.cs}`)
    })
    const apercuTxt = apercuItems.length
      ? apercuItems.map((a) => `${a.signal}/${a.urgency}`).join(' · ')
      : '(non signalé)'
    console.log(`  Aperçu        : ${apercuTxt}`)
    if (apercuItems.length) for (const a of apercuItems) console.log(`                    · "${a.title}" — ${a.reason}`)

    // ── Fiche sujet ──────────────────────────────────────────────────────────
    const life = await getCanonicalSubjectLife(t.cs)
    const histOccs = (life.occurrences ?? []).filter((o) => o.sourceKind === 'historical_pdf')
    const occBacked = histOccs.some((o) => !o.isGap && o.stateStatus !== null)
    const occSeq = histOccs
      .map((o) => `${runShort(o.runId)}=${o.isGap ? 'gap' : (o.stateStatus ?? 'null')}`)
      .join(' ')
    console.log(`  Fiche         : currentStatus=${life.currentStatus ?? 'null'}  occHist=${histOccs.length}  pvCount=${life.pvCount}  stagnant=${life.isStagnant}  lastMeaningfulChange=${life.lastMeaningfulChangeAt ?? 'null'}`)
    console.log(`                    occ/PV: ${occSeq || '(aucune)'}`)

    // ── Tension (règle du read-model appliquée au sujet) ────────────────────────
    const rm = byCsRun.get(t.cs)
    const fam = familiesByCs.get(t.cs) ?? new Set<string>()
    const tensionExcluded = fam.size > 0 && [...fam].every((f) => OPERATIONAL_EXCLUDED_FAMILIES.has(f))
    const perRun = occRuns.map((r) => {
      const occs = rm?.get(r.id)
      return occs && occs.length > 0 ? runTensionState(occs.map((o) => o.stateStatus)) : null
    })
    const traj = tensionTrajectory(perRun)
    const tensionSeq = occRuns.map((r, i) => `${runShort(r.id)}=${perRun[i] ?? '·'}${traj[i]?.active ? '►' : ''}`).join(' ')
    const tensionActive = traj.length > 0 ? traj[traj.length - 1].active : false
    const tensionNewAt = traj.findIndex((x) => x.isNew)
    const tensionTxt = tensionExcluded
      ? 'exclu (famille opérationnelle)'
      : `actif=${tensionActive ? 'oui' : 'non'}${tensionNewAt >= 0 ? ` (nouveau@${runShort(occRuns[tensionNewAt]?.id)})` : ''}`
    console.log(`  Tension       : ${tensionTxt}  [familles: ${[...fam].join(',') || '—'}]`)
    console.log(`                    états/PV (règle runTensionState): ${tensionSeq}   ►=compté actif`)

    // ── Chronologie ─────────────────────────────────────────────────────────────
    const chronoSeq = deltas.map((d) => `${runShort(d.from)}→${runShort(d.to)}:${d.byCs.get(t.cs) ?? '—'}`).join('  ')
    const chronoLast = deltas.length ? (deltas[deltas.length - 1].byCs.get(t.cs) ?? '—') : '—'
    console.log(`  Chronologie   : ${chronoSeq || '(un seul PV)'}   dernier=${chronoLast}`)

    // ── Lignes de vie (matrice) ────────────────────────────────────────────────
    const row = matrix.rows.find((r) => r.canonicalSubjectId === t.cs)
    const ldvSeq = row
      ? row.cells.map((c, i) => {
          const pv = runShort(matrix.runs[i].id)
          if (c === null) return `${pv}:∅`
          if (c.isGap) return `${pv}:gap`
          return `${pv}:${c.status ?? 'null'}${c.transition ? `/${c.transition}` : ''}`
        }).join('  ')
      : '(ligne absente de la matrice)'
    const ldvLast = row ? (row.currentStatus ?? 'null') : 'absent'
    console.log(`  Lignes de vie : ${ldvSeq}   currentStatus=${ldvLast}`)

    // ── Drapeaux STRUCTURELS (jamais sémantiques) ──────────────────────────────
    const identityOk = !!row && row.canonicalSubjectId === t.cs && life.canonicalSubjectId === t.cs
    let verdict: string
    if (!identityOk) verdict = 'IDENTITY_MISMATCH'
    else if (!occBacked) verdict = 'LEGACY_PATH'          // aucun état porté par occurrence → chemin proposition
    else if (histOccs.length === 0) verdict = 'MISSING_PROOF'
    else verdict = 'REVIEW'
    console.log(`  Identité      : matrice=${row ? 'trouvée' : 'ABSENTE'} · fiche.cs=${life.canonicalSubjectId === t.cs ? 'ok' : 'MISMATCH'} · occurrence-backed=${occBacked}`)

    // ── Écarts inter-vues (INFORMATIFS — ne tranchent rien, attirent le regard) ──
    // Comparaisons purement STRUCTURELLES (présence d'un concern, null vs actif, non-mention vs
    // résolu). Jamais de comparaison de libellés ni de décision d'équivalence.
    const ecarts: string[] = []
    const ficheOpen = life.currentStatus === 'open'
    const ficheDone = life.currentStatus === 'done'
    if (apercuItems.length === 0 && (ficheOpen || (tensionActive && !tensionExcluded)))
      ecarts.push('Aperçu muet alors que Fiche/Tension portent un concern actif')
    if (life.currentStatus === null && tensionActive && !tensionExcluded)
      ecarts.push('Fiche indéterminée (null, états unknown) vs Tension = actif (règle « pas prouvé résolu »)')
    if (chronoLast === 'non_mentionné' && ficheDone)
      ecarts.push('INVARIANT — dernier delta non_mentionné avec Fiche=résolu : vérifier report vs fausse résolution')
    if (ecarts.length) for (const e of ecarts) console.log(`  ⚠ Écart       : ${e}`)
    console.log(`  ▶ Verdict     : ${verdict}${ecarts.length ? '  (+ écart(s) à lire)' : ''}\n`)

    summaryRows.push({
      code: t.code,
      apercu: apercuItems.length ? apercuItems.map((a) => a.signal).join('+') : 'non signalé',
      fiche: life.currentStatus ?? 'null',
      tension: tensionExcluded ? 'exclu' : (tensionActive ? 'actif' : 'inactif'),
      chrono: chronoLast,
      ldv: ldvLast,
      verdict: verdict + (ecarts.length ? ` +${ecarts.length}écart` : ''),
    })
  }

  // ── Matrice de synthèse ──────────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════════════════════════')
  console.log('SYNTHÈSE — dernier état porté par chaque vue (lecture humaine)')
  console.log('════════════════════════════════════════════════════════════════════════════════')
  console.log(`${pad('Témoin', 14)}${pad('Aperçu', 20)}${pad('Fiche', 8)}${pad('Tension', 10)}${pad('Chrono(dernier)', 16)}${pad('LignesVie', 10)}Verdict`)
  for (const r of summaryRows) {
    console.log(`${pad(r.code, 14)}${pad(r.apercu, 20)}${pad(r.fiche, 8)}${pad(r.tension, 10)}${pad(r.chrono, 16)}${pad(r.ldv, 10)}${r.verdict}`)
  }
  console.log('\nLégende : ∅=avant 1re apparition · gap=connu mais absent du PV · non_mentionné=silence')
  console.log('          Tension "actif/inactif" = projection de la règle Tension (agrégat), pas l\'état du sujet.')
  console.log('          Verdict informatif : REVIEW = aucun écart structurel ; lecture humaine tranche l\'histoire.')
}

main().catch((e) => { console.error(e); process.exit(1) })
