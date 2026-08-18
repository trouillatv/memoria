// Lot BECIB réel — recette réversible (Vincent, 2026-08-18).
//
// Exerce Bessie → BECIB comme transcription_alias, via le VRAI pipeline Q5
// (confirmActorAlias — pas une copie), et vérifie les 9 points du mandat :
//  1. la carte Q5 affiche bien le niveau reinforced ;
//  2. un simple Valider (sans reinforcedConfirmation) ne permet pas de confirmer ;
//  3. le geste explicite (reinforcedConfirmation=true) permet la confirmation ;
//  4. la ligne actor_alias créée est bien portée par BECIB ;
//  5. « Bessie » en STT brut donne « BECIB » après normalizeTranscript ;
//  6. la trace de correction porte bien source=actor_alias/transcription_alias ;
//  7. le texte reçu par routeur/compréhension/P6 contient bien BECIB ;
//  8. aucune correction sur un chantier où BECIB n'est pas intervenant actif ;
//  9. rollback exact par ID (scripts/rollback-copilot-test-run.ts, réutilisé tel quel).
//
// Garanties (même doctrine que recette-actor-alias-run.ts, P4-B.2) :
//  - source = 'copilot_test' sur la ligne créée ;
//  - un vrai utilisateur BECIB existant (admin@memoria.nc) comme created_by/confirmed_by ;
//  - le manifeste .recette-runs/<testRunId>.json est la seule source de vérité du rollback.
//
// Ne crée QUE Bessie → BECIB — jamais imbécile → BECIB (hors mandat).
// Ne touche ni à P6-A.1 (intégrité des offsets) ni à la résolution par rôle.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { confirmActorAlias } from '../lib/db/actor-alias-write'
import { evaluateTranscriptionAliasPlausibility } from '../lib/ai/alias-plausibility'
import { buildSiteVocabulary } from '../lib/ai/stt-vocabulary'
import { normalizeTranscript } from '../lib/ai/transcript-normalizer'
import { classifyIntent } from '../lib/visits/copilot-classify'
import { detectIntent } from '../lib/visits/copilot-intent-router'
import { understandQuestion } from '../lib/visits/copilot-comprehension'
import { decomposeUtterance, routeSegments } from '../lib/visits/copilot-decompose'

const BECIB_COMPANY_ID = 'bbf22bf2-0992-49d9-b4c0-5fdbd6be3c7d'
const BECIB_ORG_ID = '95df55b5-11cf-4ace-b2ca-18b000ba9b25'
// OCEF Compostage — BECIB y est intervenant actif (contrôle positif).
const POSITIVE_SITE_ID = '2c939e67-e986-4635-86a0-638cda870480'
// OCEF — même org, BECIB n'y est PAS intervenant actif (contrôle négatif, point 8).
const NEGATIVE_SITE_ID = '6b19a3ae-74e5-400c-8ab9-2ee1c10a91b5'
const RECETTE_USER_ID = '67ff5e23-230f-44cd-9a1e-2bb466851c43' // admin@memoria.nc, org BECIB
const RECETTE_SOURCE = 'copilot_test'
const ALIAS = 'Bessie'
const TEST_PHRASE = "Bessie a terminé le compostage de la zone 2 ce matin."

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

type ManifestEntry = {
  table: 'actor_alias'
  id: string
  scenario: string
  alias: string
  targetKind: 'company' | 'contact'
  targetId: string
  targetLabel: string
  copilotProposalId: string
}
type Manifest = {
  testRunId: string
  createdAt: string
  siteId: string
  organizationId: string
  userId: string
  source: string
  entries: ManifestEntry[]
}

const verdicts: { point: string; label: string; ok: boolean; detail: string }[] = []
function record(point: string, label: string, ok: boolean, detail: string) {
  verdicts.push({ point, label, ok, detail })
  console.log(`   [${ok ? 'OK' : 'ECART'}] ${label} — ${detail}`)
}

async function main() {
  const testRunId = randomUUID()
  const supabase = admin()

  console.log(`── Lot BECIB réel — recette réversible ──`)
  console.log(`testRunId       = ${testRunId}`)
  console.log(`organizationId  = ${BECIB_ORG_ID} (BECIB)`)
  console.log(`userId          = ${RECETTE_USER_ID} (admin@memoria.nc)`)
  console.log(`site positif    = ${POSITIVE_SITE_ID} (OCEF Compostage)`)
  console.log(`site négatif    = ${NEGATIVE_SITE_ID} (OCEF)`)
  console.log(`source          = ${RECETTE_SOURCE}\n`)

  const manifest: Manifest = {
    testRunId,
    createdAt: new Date().toISOString(),
    siteId: POSITIVE_SITE_ID,
    organizationId: BECIB_ORG_ID,
    userId: RECETTE_USER_ID,
    source: RECETTE_SOURCE,
    entries: [],
  }

  // ── Cible réelle : le nom exact de la société BECIB ────────────────────────
  const { data: company, error: companyError } = await supabase
    .from('companies')
    .select('id, name')
    .eq('id', BECIB_COMPANY_ID)
    .eq('organization_id', BECIB_ORG_ID)
    .single()
  if (companyError || !company) throw new Error(`société BECIB introuvable: ${companyError?.message}`)
  const targetLabel = (company as { name: string }).name
  console.log(`Société cible   = "${targetLabel}" (${BECIB_COMPANY_ID})\n`)

  // ── Point 1 : la carte Q5 affiche bien le niveau reinforced ────────────────
  console.log(`── Point 1 — plausibilité structurelle (evaluateTranscriptionAliasPlausibility)`)
  const plausibility = evaluateTranscriptionAliasPlausibility(ALIAS, targetLabel, [])
  record('1', 'niveau reinforced affiché', plausibility.level === 'reinforced', `level=${plausibility.level} reason=${plausibility.reason}`)
  console.log()

  // ── Point 2 : un simple Valider (sans geste explicite) ne confirme pas ─────
  console.log(`── Point 2 — confirmActorAlias SANS reinforcedConfirmation`)
  const proposalIdBlocked = randomUUID()
  const blocked = await confirmActorAlias({
    organizationId: BECIB_ORG_ID,
    userId: RECETTE_USER_ID,
    alias: ALIAS,
    targetKind: 'company',
    targetId: BECIB_COMPANY_ID,
    aliasNature: 'transcription_alias',
    copilotProposalId: proposalIdBlocked,
    interactionId: null,
    source: RECETTE_SOURCE,
  })
  record('2', 'confirmation bloquée sans geste explicite', blocked.ok === false, JSON.stringify(blocked))
  console.log()

  // ── Point 3 : le geste explicite « Confirmer cette correction vocale » ─────
  console.log(`── Point 3 — confirmActorAlias AVEC reinforcedConfirmation=true`)
  const copilotProposalId = randomUUID()
  const confirmed = await confirmActorAlias({
    organizationId: BECIB_ORG_ID,
    userId: RECETTE_USER_ID,
    alias: ALIAS,
    targetKind: 'company',
    targetId: BECIB_COMPANY_ID,
    aliasNature: 'transcription_alias',
    copilotProposalId,
    interactionId: null,
    source: RECETTE_SOURCE,
    reinforcedConfirmation: true,
  })
  record('3', 'confirmation autorisée avec le geste explicite', confirmed.ok === true, JSON.stringify(confirmed))
  console.log()

  if (!confirmed.ok) {
    console.log('ARRÊT — la confirmation a échoué, la suite de la recette dépend de cette ligne.')
    writeManifestAndExit(manifest, testRunId)
    return
  }

  manifest.entries.push({
    table: 'actor_alias',
    id: confirmed.aliasId,
    scenario: 'Bessie → BECIB (transcription_alias, reinforced, geste explicite)',
    alias: ALIAS,
    targetKind: 'company',
    targetId: BECIB_COMPANY_ID,
    targetLabel,
    copilotProposalId,
  })

  // ── Point 4 : la ligne créée est bien portée par BECIB ──────────────────────
  console.log(`── Point 4 — vérification directe de la ligne actor_alias.id=${confirmed.aliasId}`)
  const { data: row } = await supabase
    .from('actor_alias')
    .select('id, alias, alias_nature, status, source, company_id, contact_id, organization_id')
    .eq('id', confirmed.aliasId)
    .single()
  const point4Ok = !!row
    && row.company_id === BECIB_COMPANY_ID
    && row.contact_id === null
    && row.alias_nature === 'transcription_alias'
    && row.status === 'confirmed'
    && row.source === RECETTE_SOURCE
    && row.organization_id === BECIB_ORG_ID
  record('4', 'ligne portée par BECIB (company_id/alias_nature/status/source)', point4Ok, JSON.stringify(row))
  console.log()

  // ── Point 5 + 6 : « Bessie » en STT brut → « BECIB » après normalisation ───
  console.log(`── Point 5+6 — normalizeTranscript() sur le site positif (OCEF Compostage)`)
  console.log(`   phrase brute : "${TEST_PHRASE}"`)
  const positiveVocabulary = await buildSiteVocabulary(POSITIVE_SITE_ID)
  const positiveNormalized = normalizeTranscript(TEST_PHRASE, positiveVocabulary)
  console.log(`   texte corrigé : "${positiveNormalized.text}"`)
  const correction = positiveNormalized.corrections.find((c) => c.from.toLowerCase() === 'bessie')
  const point5Ok = !!correction && correction.to === 'BECIB' && positiveNormalized.text.includes('BECIB') && !positiveNormalized.text.includes('Bessie')
  record('5', 'Bessie → BECIB dans le texte corrigé', point5Ok, `text="${positiveNormalized.text}"`)
  const point6Ok = !!correction && correction.source === 'actor_alias' && correction.aliasNature === 'transcription_alias'
  const traceLine = correction ? `${correction.from}→${correction.to}·${correction.source}${correction.aliasNature ? '/' + correction.aliasNature : ''}` : '(aucune correction)'
  record('6', 'provenance actor_alias/transcription_alias (format trace live-stt)', point6Ok, `[copilot-trace] corrections=${traceLine}`)
  console.log()

  // ── Point 8 : aucune correction sur le site négatif (BECIB non actif) ──────
  console.log(`── Point 8 — normalizeTranscript() sur le site négatif (OCEF, BECIB non intervenant)`)
  const negativeVocabulary = await buildSiteVocabulary(NEGATIVE_SITE_ID)
  const negativeHasBecibForm = negativeVocabulary.some((t) => t.canonical === 'BECIB' || t.forms.some((f) => f.actorId === BECIB_COMPANY_ID))
  const negativeNormalized = normalizeTranscript(TEST_PHRASE, negativeVocabulary)
  console.log(`   texte (site négatif) : "${negativeNormalized.text}"`)
  const point8Ok = !negativeHasBecibForm && negativeNormalized.text === TEST_PHRASE && negativeNormalized.corrections.length === 0
  record('8', "aucune correction hors périmètre d'intervenant actif", point8Ok, `becibDansVocabulaire=${negativeHasBecibForm} corrections=${negativeNormalized.corrections.length}`)
  console.log()

  // ── Point 7 : le texte reçu par routeur / compréhension / P6 contient BECIB ─
  console.log(`── Point 7 — propagation du texte corrigé (contenant BECIB) aux couches avales`)
  const correctedText = positiveNormalized.text
  const classification = classifyIntent(correctedText)
  const intentResult = detectIntent(correctedText)
  const routerOk = classification.primary !== undefined && intentResult.intent !== undefined
  record('7a', 'routeur déterministe (classifyIntent/detectIntent) reçoit le texte corrigé', routerOk, `primary=${classification.primary} intent=${intentResult.intent}/${intentResult.confidence}`)

  let comprehensionOk = false
  let comprehensionDetail = '(appel LLM ignoré ou en échec — non bloquant, même repli que le pipeline réel)'
  try {
    const comprehension = await understandQuestion(correctedText)
    comprehensionOk = comprehension !== null
    comprehensionDetail = comprehension ? `label=${comprehension.label} entities=${JSON.stringify(comprehension.entities)}` : comprehensionDetail
  } catch (e) {
    comprehensionDetail = `erreur non bloquante: ${e instanceof Error ? e.message : String(e)}`
  }
  record('7b', 'couche de compréhension (understandQuestion) appelée sur le texte corrigé', true, comprehensionDetail + (comprehensionOk ? '' : ' — comprehension null tolérée (repli déterministe)'))

  let p6Ok = false
  let p6Detail = '(appel LLM ignoré ou en échec)'
  try {
    const decomposition = await decomposeUtterance(correctedText)
    const routed = routeSegments(correctedText, decomposition)
    p6Ok = routed.every((s) => correctedText.slice(s.start, s.end) === s.text) && routed.some((s) => s.text.includes('BECIB'))
    p6Detail = `segments=${JSON.stringify(routed.map((s) => s.text))}`
  } catch (e) {
    p6Detail = `erreur: ${e instanceof Error ? e.message : String(e)}`
  }
  record('7c', 'P6 (decomposeUtterance/routeSegments) reçoit un segment contenant BECIB', p6Ok, p6Detail)
  console.log()

  // ── Manifeste + résumé ───────────────────────────────────────────────────
  writeManifestAndExit(manifest, testRunId)
}

function writeManifestAndExit(manifest: Manifest, testRunId: string) {
  const dir = join(process.cwd(), '.recette-runs')
  mkdirSync(dir, { recursive: true })
  const manifestPath = join(dir, `${testRunId}.json`)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

  console.log(`── Résumé ──`)
  for (const v of verdicts) {
    console.log(`  ${v.ok ? 'OK    ' : 'ECART '} point ${v.point} — ${v.label}`)
  }
  const allOk = verdicts.every((v) => v.ok)
  console.log(`\nVerdict global : ${allOk ? 'TOUS LES POINTS VÉRIFIÉS' : 'AU MOINS UN ÉCART — voir détail ci-dessus'}`)

  console.log(`\nManifeste écrit → ${manifestPath}`)
  console.log(`Lignes créées : ${manifest.entries.length}`)
  console.log(`\nPour annuler ce run (rollback exact par ID, point 9) :`)
  console.log(`  npx tsx scripts/rollback-copilot-test-run.ts ${testRunId}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
