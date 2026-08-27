/**
 * P-UI-R2e — Re-sonde du contrat same_object_hypothesis (identité / ligne de vie).
 *
 * Rejoue un corpus de témoins réels + synthétiques (objet↔anomalie/document/contrôle) + de vraies
 * ÉVOLUTIONS d'état d'un même sujet, à travers le juge réel (analyzeSubjectPair, nouveau prompt).
 * Imprime le tableau : A | B | verdict | SOH avant | SOH après | identité proposée | humain | conforme ?
 *
 * "identité proposée" = ce que l'UI présenterait comme « Même sujet ? » (verdict=same_subject OU
 * related+SOH). C'est le vrai critère (proposer une fusion ou pas). Favoriser le faux négatif.
 *
 * AUCUNE écriture. Usage : npx tsx --env-file=.env.local scripts/reprobe-same-subject.ts
 */

import { analyzeSubjectPair, type SubjectInput } from '../lib/subjects/similarity-analyze'
import { detectTypeHint, fusionBlockReason, fusionWarningReason } from '../lib/subjects/similarity-candidates'

interface Case {
  key: string
  a: { label: string; ctx?: string }
  b: { label: string; ctx?: string }
  sohBefore: boolean | null // ce que l'ancien contrat produisait (audit) ; null = inconnu
  expectIdentity: boolean    // verdict humain : doit-on proposer une seule identité/ligne de vie ?
  human: string
}

const CORPUS: Case[] = [
  {
    key: 'food court ↔ Mall (contexte prouvant qu’il s’agit de la MÊME issue)',
    a: { label: 'Issue de secours du food court', ctx: 'L’issue de secours du food court donne sur l’extérieur du Mall ; réservée au personnel, comptée dans les dégagements mais non nécessaire à l’évacuation du public.' },
    b: { label: 'Dégagement extérieur du Mall', ctx: 'Ce dégagement donnant sur l’extérieur du Mall EST l’issue de secours du food court : validée avec la DSCGR en 2023 comme suffisante, réservée au personnel ; précédemment encombré par des armoires froid.' },
    sohBefore: true, expectIdentity: true, human: 'SAME_CANONICAL_SUBJECT (même issue suivie dans le temps)',
  },
  {
    key: 'Largeur réduite (frigos) ↔ Dégagement Mall',
    a: { label: 'Largeur de passage des dégagements réduite (par frigos)', ctx: 'Dégagements OK. Même si largeur de passage réduite par les frigos (voir photo).' },
    b: { label: 'Dégagement extérieur du Mall', ctx: 'Issue validée DSCGR 2023, réservée au personnel, suffisante pour l’évacuation du public.' },
    sohBefore: true, expectIdentity: false, human: 'SAME_PHYSICAL_OBJECT_BUT_DISTINCT_CONCERN',
  },
  {
    key: 'Local technique ↔ Local électrique',
    a: { label: 'Local technique', ctx: 'Accès et maintenance du local technique.' },
    b: { label: 'Local électrique', ctx: 'Conformité de l’installation électrique du local.' },
    sohBefore: true, expectIdentity: false, human: 'SAME_PHYSICAL_OBJECT_BUT_DISTINCT_CONCERN (co-localisation insuffisante)',
  },
  {
    key: 'Registre install. électriques ↔ Contrôle install. électriques',
    a: { label: 'Registre de sécurité installations électriques', ctx: 'Document réglementaire à tenir à jour.' },
    b: { label: 'Contrôle des installations électriques', ctx: 'Vérification périodique de conformité des installations.' },
    sohBefore: false, expectIdentity: false, human: 'DISTINCT (document ≠ opération de contrôle)',
  },
  {
    key: 'Rapport SSI ↔ Contrôle SSI',
    a: { label: 'Rapport SSI', ctx: 'Rapport documentaire du système de sécurité incendie.' },
    b: { label: 'Contrôle SSI', ctx: 'Opération de vérification périodique du SSI.' },
    sohBefore: false, expectIdentity: false, human: 'DISTINCT (document ≠ contrôle)',
  },
  {
    key: 'Réserve porte CF ↔ Porte CF / Contrôle porte CF',
    a: { label: 'Réserve sur la porte coupe-feu', ctx: 'Réserve émise sur une porte CF non conforme.' },
    b: { label: 'Contrôle de la porte coupe-feu', ctx: 'Vérification du degré coupe-feu de la porte.' },
    sohBefore: false, expectIdentity: false, human: 'SAME_PHYSICAL_OBJECT_BUT_DISTINCT_CONCERN (réserve ≠ contrôle ≠ objet)',
  },
  {
    key: 'objet↔anomalie : Extincteurs ↔ Extincteur manquant (cuisine)',
    a: { label: 'Contrôle des extincteurs', ctx: 'Maintenance et vérification du parc d’extincteurs.' },
    b: { label: 'Extincteur manquant en zone cuisine', ctx: 'Constat d’un extincteur absent à son emplacement.' },
    sohBefore: null, expectIdentity: false, human: 'RELATED/DISTINCT (parc ≠ anomalie ponctuelle)',
  },
  {
    key: 'objet↔document : Installations électriques ↔ Rapport de contrôle électrique',
    a: { label: 'Installations électriques', ctx: 'Équipement électrique du bâtiment.' },
    b: { label: 'Rapport de contrôle électrique Q18', ctx: 'Document de vérification périodique.' },
    sohBefore: null, expectIdentity: false, human: 'DISTINCT (équipement ≠ document)',
  },
  {
    key: 'objet↔contrôle : Éclairage de sécurité ↔ Contrôle de l’éclairage de sécurité',
    a: { label: 'Éclairage de sécurité', ctx: 'Équipement d’éclairage de sécurité.' },
    b: { label: 'Contrôle de l’éclairage de sécurité', ctx: 'Opération de vérification de l’éclairage.' },
    sohBefore: null, expectIdentity: false, human: 'SAME_PHYSICAL_OBJECT_BUT_DISTINCT_CONCERN (objet ≠ contrôle)',
  },
  {
    key: 'ÉVOLUTION : Nivellement hors tolérance ↔ Nivellement conforme (VISA)',
    a: { label: 'Reprise du nivellement – zone hors tolérance', ctx: 'Zone hors tolérance à reprendre.' },
    b: { label: 'Reprise du nivellement conforme suivant VISA 01.004', ctx: 'Reprise réalisée et conforme au VISA 01.004.' },
    sohBefore: null, expectIdentity: true, human: 'SAME_CANONICAL_SUBJECT (même opération : non conforme → conforme)',
  },
  {
    key: 'ÉVOLUTION : Extincteurs à contrôler ↔ Extincteurs contrôlés conformes',
    a: { label: 'Extincteurs à contrôler avant échéance', ctx: 'Contrôle périodique annuel des extincteurs à réaliser avant l’échéance ; même opération de contrôle récurrente.' },
    b: { label: 'Extincteurs contrôlés — conformes', ctx: 'Le contrôle périodique annuel des extincteurs a été réalisé : parc conforme. Même opération de contrôle, désormais effectuée.' },
    sohBefore: null, expectIdentity: true, human: 'SAME_CANONICAL_SUBJECT (à faire → réalisé)',
  },
  {
    key: 'ÉVOLUTION : Registre non renseigné ↔ Registre mis à jour',
    a: { label: 'Registre de sécurité non renseigné', ctx: 'Registre incomplet, à compléter.' },
    b: { label: 'Registre de sécurité mis à jour', ctx: 'Registre désormais renseigné et à jour.' },
    sohBefore: null, expectIdentity: true, human: 'SAME_CANONICAL_SUBJECT (même document : non renseigné → à jour)',
  },
]

function mk(label: string, ctx?: string): SubjectInput {
  return { id: label, label, aliases: [], occurrenceContext: ctx ?? null }
}

async function main() {
  const rows: string[] = []
  rows.push('| # | A | B | verdict | SOH avant | SOH après | identité proposée | humain | conforme ? |')
  rows.push('|---|---|---|---|---|---|---|---|---|')

  let i = 0
  let conformes = 0
  let evaluated = 0
  for (const c of CORPUS) {
    i++
    const tA = detectTypeHint(c.a.label)
    const tB = detectTypeHint(c.b.label)
    const block = fusionBlockReason(tA, tB)
    const warn = block ? null : fusionWarningReason(tA, tB)
    let verdict = 'ERR', sohAfter: boolean | null = null, identity = false, ok = '—'
    try {
      const r = await analyzeSubjectPair(mk(c.a.label, c.a.ctx), mk(c.b.label, c.b.ctx), null, {
        typeHintA: tA, typeHintB: tB, fusionBlockReason: block, fusionWarningReason: warn,
      })
      verdict = `${r.verdict}/${r.recommendation} ${r.score}%`
      sohAfter = r.same_object_hypothesis
      identity = r.recommendation === 'merge' || (r.verdict === 'related' && r.same_object_hypothesis)
      evaluated++
      const conforme = identity === c.expectIdentity
      if (conforme) conformes++
      ok = conforme ? '✅' : '❌'
    } catch (e) {
      verdict = 'BLOQUÉ (quota)'; ok = '⏳'
      console.error(`  [${i}] ${c.key} — ${e instanceof Error ? e.message.slice(0, 80) : e}`)
    }
    rows.push(`| ${i} | ${c.a.label} | ${c.b.label} | ${verdict} | ${c.sohBefore === null ? 'n/a' : c.sohBefore} | ${sohAfter === null ? '—' : sohAfter} | ${identity} | ${c.human} | ${ok} |`)
  }

  console.log('\n' + rows.join('\n'))
  console.log(`\nÉvalués (LLM) : ${evaluated}/${CORPUS.length} · conformes : ${conformes}/${evaluated || 0}`)
  console.log('Critère de validation : food court↔Mall = identité ; Largeur/Dégagement, Local tech/élec, Registre/Contrôle = pas de fusion ; évolutions reconnues.')
}

main().catch((e) => { console.error(e); process.exit(1) })
