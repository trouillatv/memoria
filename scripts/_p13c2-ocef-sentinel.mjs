/**
 * P1-3C.2 sentinel OCEF — vérifie que le correctif action status signal
 * (prompt doctrine + mapDocumentStatus guard) produit 0 faux resolved.
 *
 * Corpus : PV007, PV008, PV009 (documents OCEF les plus représentatifs
 * des cinq pièges identifiés par l'audit Opus).
 *
 * Exécution : node scripts/_p13c2-ocef-sentinel.mjs
 * Prérequis : GOOGLE_GENAI_API_KEY (ou dans .env.local)
 * AUCUN commit. Rapport brut uniquement.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env.local')
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
loadDotEnv()

// ─── Corpus OCEF ciblé ────────────────────────────────────────────────────────
const CORPUS = [
  { id: 'OCEF_PV007', pdf: 'docs/Becib/PV/PV 007 - OCEF Compostage - 2026 04 22.pdf' },
  { id: 'OCEF_PV008', pdf: 'docs/Becib/PV/PV 008 - OCEF Compostage - 2026 04 30.pdf' },
  { id: 'OCEF_PV009', pdf: 'docs/Becib/PV/PV 009 - OCEF Compostage - 2026 07 02.pdf' },
]

// ─── mapDocumentStatus (réplique déterministe — doit rester synchronisée) ────
// Ordre identique à lib/documents/subject-reconciliation.ts (P1-3C.2 fix inclus)
function mapDocumentStatus(statusAtDocumentDate, family) {
  if (family === 'person' || family === 'company') return null
  if (!statusAtDocumentDate) return null
  const s = statusAtDocumentDate.toLowerCase()
  if (/non conform|refus|hors tolérance/.test(s)) return 'non_compliant'
  if (/non démarr|non commenc|prévu|planif|programm/.test(s)) return 'planned'
  if (/en attente|attendu|visa|validation/.test(s)) return 'awaiting_validation'
  if (/annul|abandonn/.test(s)) return 'cancelled'
  if (/en cours|partiell|démarr/.test(s)) return 'in_progress'
  // Garde-fou P1-3C.2 : tâches non soldées → open, avant "réalis"/"exécut" (done)
  if (/à faire|à réaliser|à transmettre/.test(s)) return 'open'
  if (/réalis|termin|levé|exécut|accompl/.test(s) || s === 'fait') return 'done'
  if (/ouvert|signalé|constaté/.test(s)) return 'open'
  return 'informational'
}

// tri-state mapping (identique à subject-state.ts)
function documentStatusToPvState(docStatus) {
  if (!docStatus) return 'unknown'
  if (['done', 'cancelled', 'informational'].includes(docStatus)) return 'resolved'
  if (['open', 'in_progress', 'planned', 'non_compliant', 'awaiting_validation'].includes(docStatus)) return 'open'
  return 'unknown'
}

// ─── Schéma Gemini ────────────────────────────────────────────────────────────
const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          temporaryKey: { type: 'string' },
          family: { type: 'string', enum: ['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact', 'person', 'company'] },
          label: { type: 'string' },
          description: { type: 'string' },
          sourcePage: { type: 'integer' },
          sourceExcerpt: { type: 'string' },
          sourcePayload: {
            type: 'object',
            properties: {
              statusAtDocumentDate: { type: 'string' },
              companyRole: { type: 'string', enum: ["maître d'ouvrage", 'AMO', "maître d'œuvre", 'entreprise titulaire', 'sous-traitant', 'partenaire', 'diffusion uniquement'] },
              dueDate: { type: 'string' },
              responsibleParty: { type: 'string' },
              linkedActorTemporaryKey: { type: 'string' },
              relevanceScore: { type: 'string', enum: ['strong', 'medium', 'weak'] },
              relevanceReason: { type: 'string' },
              linkedCompanyName: { type: 'string' },
              emailAddress: { type: 'string' },
              phoneNumber: { type: 'string' },
              thematic_category: { type: 'string', enum: ['progress', 'test_control', 'forecast', 'safety_environment', 'resources', 'administrative', 'weather', 'permanent_instruction', 'general_knowledge'] },
            },
            required: ['relevanceScore'],
          },
          evidenceKeys: { type: 'array', items: { type: 'string' } },
        },
        required: ['temporaryKey', 'family', 'label', 'sourcePayload', 'evidenceKeys'],
      },
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          temporaryKey: { type: 'string' },
          evidenceType: { type: 'string', enum: ['text_excerpt', 'page_snapshot'] },
          sourcePage: { type: 'integer' },
          caption: { type: 'string' },
          nearbyText: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['temporaryKey', 'evidenceType', 'sourcePage'],
      },
    },
  },
  required: ['proposals', 'evidence'],
}

// ─── Extraction PDF ───────────────────────────────────────────────────────────
async function extractPdfText(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text: rawPages, totalPages } = await extractText(pdf, { mergePages: false })
  const pages = Array.isArray(rawPages) ? rawPages : [rawPages]
  const text = pages.map((t, i) => `[[page ${i + 1}]]\n${(t ?? '').trim()}`).join('\n\n').trim()
  const charCount = pages.reduce((n, t) => n + (t?.length ?? 0), 0)
  const pageCount = totalPages ?? pages.length
  const isLikelyScanned = charCount < 200 && pageCount >= 1
  return { text, pageCount, charCount, isLikelyScanned }
}

// ─── Prompt d'extraction (P1-3C.2 — doctrine action status incluse) ──────────
function buildExtractionPrompt(text, pageCount) {
  return `Tu es un assistant d'analyse de PV de visite technique pour un conducteur de travaux.

Ce document comporte ${pageCount} page(s). Le texte est balisé avec [[page N]] pour indiquer les changements de page.

---

## PREMIÈRE ÉTAPE — Doctrine de sélection (obligatoire avant tout)

Avant de créer une proposition, pose-toi ces questions dans l'ordre. Dès qu'une réponse est NON, n'extrais rien.

**1. Est-ce un fait spécifique à CE chantier ?**
Les règles de sécurité (EPI, PTAC, code de la route), les obligations légales, les procédures génériques s'appliquent à tous les chantiers. Ne rien créer.

**2. Cette information évolue-t-elle et mérite-t-elle un suivi ?**
Un contexte figé n'a pas de valeur en mémoire durable. Un état qui va changer (réserve à lever, travaux à terminer, décision à mettre en œuvre) en a. Si l'information ne changera jamais ou n'a plus d'utilité une fois la réunion passée : ne rien créer.

**3. Est-ce une règle ou procédure générique récurrente ?**
Si cet élément se retrouverait dans 80 % des PV d'autres chantiers : ne rien créer. L'importer 50 fois sur 50 PV rempliraient le chantier de bruit.

**4. Est-ce un contexte documentaire ?**
Numéro du CR, titre du CR, validation du CR précédent, ordre du jour, liste de diffusion, interlocuteurs généraux sans nom précis : ne rien créer. **Exception** : les personnes nommées (prénom + nom) et les entreprises avec rôle explicite sur ce chantier → extraire comme **person** ou **company**.

**5. Un titre seul sans état associé ?**
"Plan VRD", "Plan de terrassement" sans mention d'un état (VISA en cours / émis / refusé / à émettre) : ne rien créer. En revanche "Plan de terrassement — VISA en cours" → **knowledge_fact**.

**6. Cette information décrit-elle une évolution concrète du chantier, ou seulement son organisation documentaire, contractuelle ou opérationnelle habituelle ?**
Ne rien extraire lorsque l'information décrit seulement :
- qui transmet ou diffuse un document (procédure de diffusion, destinataires) ;
- qui est l'interlocuteur habituel ou comment contacter une entreprise ;
- comment les entreprises doivent communiquer entre elles ;
- un accès existant au chantier sans changement signalé ;
- les moyens momentanément présents sur site (engins, personnel du jour) sans contexte de retard ou d'anomalie — **exception** : si le PV comporte une section "MOYENS HUMAINS ET MATÉRIELS" ou similaire, extraire chaque item comme **knowledge_fact** avec thematic_category='resources' ;
- l'existence ou l'état administratif d'un document (transmis, reçu, validé) sans conséquence chantier explicite.

**Exception obligatoire** : si l'information administrative contient une **échéance chiffrée ou datée explicite** (ex : "avant le 25 du mois", "d'ici le 15 mars"), l'extraire comme **deadline** — même si elle porte sur une transmission ou une procédure. Une contrainte temporelle explicite a une valeur de suivi, quelle que soit sa nature.

Attention : "Plan des installations de chantier : FAIT" décrit l'état administratif du document, pas l'achèvement physique du chantier. Ne pas convertir l'un en l'autre.

**Question centrale : cette information sera-t-elle encore utile dans 6 mois à un conducteur qui n'était pas à cette réunion ?** Si non → ne rien créer.

---

## Exclusions absolues

Ne jamais créer de proposition pour :
- En-têtes, pieds de page, numéros de page, titre et numéro du compte-rendu
- "CR précédent lu et approuvé", "Acceptation sans réserve"
- Listes de diffusion, procédure de communication entre entreprises, mentions génériques d'interlocuteurs sans nom précis ("le maître d'ouvrage", "les entreprises"). **Exception** : les personnes nommées (prénom + nom) et les entreprises avec rôle explicite sur ce chantier → extraire comme **person** ou **company**.
- Règles de sécurité génériques applicables à tous les chantiers sans distinction : obligation de port d'EPI en général, harnais, PTAC, code de la route, balisage standard — aucune valeur de suivi spécifique. **Exception** : une anomalie de sécurité constatée sur CE chantier (zone non balisée malgré demande, incident, non-conformité particulière, risque propre au site) → extraire comme **knowledge_fact** avec thematic_category='safety_environment'.
- Règles environnementales génériques : tri des déchets, pollution, amiante (contexte générique), bruit
- Horaires de chantier standard (sauf anomalie documentée)
- Procédures de réunion : convocation, ordre du jour, tour de table, date de la prochaine réunion sauf si décision critique
- Titres de plans ou documents sans état

---

## DEUXIÈME ÉTAPE — Doctrine d'extraction

Pour chaque information retenue après la sélection :

1. Ne jamais inventer des données absentes du texte — extraction pure, zéro inférence.
2. Ne pas transformer une observation en action implicite : une constatation reste une observation.
3. Conserver les formulations incertaines (« à vérifier », « à confirmer », « semble ») dans le label ou la description.
3b. Lorsque le texte source semble corrompu ou ambigu (coquille, OCR dégradé, formulation incohérente), ne pas affirmer plus que ce que le document permet. Formuler avec prudence : "Accès plateforme — indiqué comme réalisé dans le PV" plutôt que "Accès plateforme réalisé".
4. Distinguer les points ouverts et les points résolus : un travail décrit au passé ou comme terminé (« déblais terminés », « purge exécutée ») → **knowledge_fact** avec statusAtDocumentDate='réalisé', jamais une action ou observation.
5. Citer la page exacte (sourcePage) — utilise les marqueurs [[page N]].
6. Ne pas déduire des intentions — se limiter aux faits et décisions explicitement mentionnés.
7. Pour une réservation : conserver le libellé exact du PV, préciser l'état si mentionné (ouvert/levé/en cours).
8. Pour une action : ne citer que les actions explicitement attribuées (responsable nommé ou délai mentionné).
9. Une photo sans description textuelle adjacente → evidence uniquement (page_snapshot), pas de proposition.
10. Un chiffre ou mesure sans contexte clair → observation, pas action.

---

## Familles de propositions

- **reservation** : réserve de chantier (défaut, malfaçon, non-conformité) — ouverture, suivi ou levée.
- **action** : tâche à réaliser. Créer une action UNIQUEMENT si un responsable est explicitement nommé (entreprise ou personne) OU si un délai précis est mentionné. Sans ces deux conditions → **observation**. Pour la famille action : renseigner sourcePayload.statusAtDocumentDate uniquement si l'état de la tâche est explicitement établi par le document. Utiliser le vocabulaire canonique : "en cours" pour une action déclarée en progression, "ouvert" pour une action non soldée. Ne jamais émettre "à faire" comme valeur. N'émettre un état terminal tel que "réalisé" que si la tâche est entièrement soldée, sans réserve, attente ou reprise associée. "réalisé … non conforme", "réalisé … reprise à faire" ou "réalisé … en attente" ne prouvent jamais la résolution — laisser absent. Un VISA ou visa de plan ne prouve jamais à lui seul l'achèvement de la tâche physique.
- **decision** : décision structurante prise lors de la visite — arbitrage, accord, validation, approbation, refus ou décision actée. Ne pas créer de decision pour une proposition, recommandation ou tâche future à réaliser.
- **observation** : constatation factuelle, alerte ou signal spécifique à ce chantier, sans responsable nommé ni délai explicite. Inclut obligatoirement les formulations du type "Attention à [X]", "Risque de [Y]", "Veiller à [Z]" sans attribution.
- **deadline** : échéance chiffrée ou datée, spécifique à ce chantier.
- **knowledge_fact** : information factuelle durable sur le site. Inclut : l'avancement constaté lors de la visite (travaux exécutés ou en cours) avec statusAtDocumentDate = "réalisé" / "en cours" / "non démarré" ; l'état de plans techniques.
- **person** : personne physique identifiable (prénom + nom). sourcePayload.statusAtDocumentDate = statut de présence.
- **company** : entreprise ou organisme cité avec un rôle sur ce chantier. sourcePayload.companyRole obligatoire.

---

## Score de pertinence (champ relevanceScore dans sourcePayload — obligatoire)

- **strong** : réserve ouverte ou levée, action nominative avec délai, décision structurante, avancement majeur.
- **medium** : observation pertinente mais secondaire, échéance de second rang, knowledge_fact stable et spécifique.
- **weak** : information peu durable ou de faible valeur métier.

---

## Idempotence

Chaque proposition et preuve reçoit un \`temporaryKey\` court et descriptif.
Lie chaque preuve à sa proposition via \`evidenceKeys\`.

---

## Texte du document

${text}`
}

// ─── Appel Gemini ─────────────────────────────────────────────────────────────
async function callGemini(text, pageCount, apiKey) {
  const model = process.env.AI_MODEL ?? 'gemini-2.5-flash'
  const prompt = buildExtractionPrompt(text, pageCount)
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(300000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 65536,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
    },
  )
  if (!res.ok) { const body = await res.text(); throw new Error(`Gemini HTTP ${res.status}: ${body}`) }
  const data = await res.json()
  const candidate = data.candidates?.[0]
  if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Gemini output truncated (MAX_TOKENS)')
  const outputText = candidate?.content?.parts?.[0]?.text ?? ''
  if (!outputText) throw new Error('Gemini returned empty output')
  return JSON.parse(outputText)
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) { console.error('GOOGLE_GENAI_API_KEY manquant'); process.exit(1) }

  console.log('=== P1-3C.2 sentinel OCEF — action status signal ===\n')
  console.log('Corpus:', CORPUS.map(c => c.id).join(', '))
  console.log('Modèle:', process.env.AI_MODEL ?? 'gemini-2.5-flash', '\n')

  const allActions = []
  let globalOk = true

  for (const doc of CORPUS) {
    const pdfPath = path.join(ROOT, doc.pdf)
    if (!fs.existsSync(pdfPath)) { console.error(`PDF manquant: ${doc.pdf}`); continue }

    console.log(`--- ${doc.id} ---`)
    const buffer = fs.readFileSync(pdfPath)
    const { text, pageCount, charCount, isLikelyScanned } = await extractPdfText(buffer)
    console.log(`  ${pageCount} pages, ${charCount} chars${isLikelyScanned ? ' [SCANNED]' : ''}`)

    const result = await callGemini(text, pageCount, apiKey)
    const proposals = result.proposals ?? []
    const actions = proposals.filter(p => p.family === 'action')

    console.log(`  Propositions totales: ${proposals.length} | Actions: ${actions.length}`)

    for (const a of actions) {
      const statusRaw = a.sourcePayload?.statusAtDocumentDate ?? null
      const docStatus = mapDocumentStatus(statusRaw, 'action')
      const triState = documentStatusToPvState(docStatus)
      const isFalseResolved = triState === 'resolved'

      allActions.push({ doc: doc.id, label: a.label, statusRaw, docStatus, triState, page: a.sourcePage })

      const marker = isFalseResolved ? '  ❌ FAUX RESOLVED' : triState === 'open' ? '  ✓ open' : '  · unknown'
      console.log(`  ${marker} | p${a.sourcePage ?? '?'} | ${a.label.slice(0, 70)}`)
      console.log(`           statusRaw="${statusRaw ?? 'null'}" → docStatus=${docStatus ?? 'null'} → triState=${triState}`)
      if (isFalseResolved) globalOk = false
    }
    console.log()
  }

  // ─── Rapport de synthèse ─────────────────────────────────────────────────────
  console.log('=== RAPPORT DE SYNTHÈSE ===\n')

  const counts = { total: allActions.length, open: 0, resolved: 0, unknown: 0, withStatus: 0 }
  for (const a of allActions) {
    counts[a.triState]++
    if (a.statusRaw !== null) counts.withStatus++
  }

  console.log(`Actions total   : ${counts.total}`)
  console.log(`  statusRaw non-null : ${counts.withStatus}`)
  console.log(`  → tri-state open   : ${counts.open}`)
  console.log(`  → tri-state resolved : ${counts.resolved}`)
  console.log(`  → tri-state unknown  : ${counts.unknown}`)

  const falseResolveds = allActions.filter(a => a.triState === 'resolved')
  if (falseResolveds.length > 0) {
    console.log('\n❌ FAUX RESOLVED détectés :')
    for (const a of falseResolveds) {
      console.log(`  [${a.doc}] p${a.page} "${a.label}" — statusRaw="${a.statusRaw}" → ${a.docStatus}`)
    }
  }

  const opens = allActions.filter(a => a.triState === 'open')
  if (opens.length > 0) {
    console.log('\n✓ Actions → open (recall vérifié) :')
    for (const a of opens) {
      console.log(`  [${a.doc}] p${a.page} "${a.label}" — statusRaw="${a.statusRaw}"`)
    }
  }

  console.log()
  if (globalOk && counts.open > 0) {
    console.log('VERDICT: P1_3C2_PASS — 0 faux resolved, recall open > 0')
  } else if (globalOk && counts.open === 0) {
    console.log('VERDICT: P1_3C2_PASS_PARTIAL — 0 faux resolved, mais aucune action n\'a émis un état open (recall = 0 sur ce corpus)')
    console.log('  → Vérifier si Gemini n\'a pas simplement omis statusAtDocumentDate pour les actions (comportement attendu si le prompt n\'est pas clair)')
  } else {
    console.log('VERDICT: P1_3C2_FAIL — faux resolved détectés')
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
