import 'server-only'
import { z } from 'zod'

// ─── Schémas Zod (contrat de sortie LLM) ─────────────────────────────────────

export const LlmEvidenceSchema = z.object({
  temporaryKey: z.string(),
  evidenceType: z.enum(['text_excerpt', 'page_snapshot']),
  sourcePage: z.number().int(),
  caption: z.string().nullish(),
  nearbyText: z.string().nullish(),
  text: z.string().nullish(),
})

export const LlmProposalSchema = z.object({
  temporaryKey: z.string(),
  family: z.enum(['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact', 'person', 'company']),
  label: z.string().min(3),
  description: z.string().nullish(),
  sourcePage: z.number().int().nullish(),
  sourceExcerpt: z.string().nullish(),
  sourcePayload: z.object({
    statusAtDocumentDate: z.string().nullish(),
    dueDate: z.string().nullish(),
    responsibleParty: z.string().nullish(),
    relevanceScore: z.enum(['strong', 'medium', 'weak']).nullish(),
    relevanceReason: z.string().nullish(),
  }).nullish(),
  evidenceKeys: z.array(z.string()),
})

export const LlmExtractionResultSchema = z.object({
  proposals: z.array(LlmProposalSchema),
  evidence: z.array(LlmEvidenceSchema),
})

export type LlmProposal = z.infer<typeof LlmProposalSchema>
export type LlmEvidence = z.infer<typeof LlmEvidenceSchema>
export type LlmExtractionResult = z.infer<typeof LlmExtractionResultSchema>

// ─── Schema responseSchema Gemini (OpenAPI 3.0 subset) ────────────────────────

const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          temporaryKey: { type: 'string' },
          family: {
            type: 'string',
            enum: ['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact', 'person', 'company'],
          },
          label: { type: 'string' },
          description: { type: 'string' },
          sourcePage: { type: 'integer' },
          sourceExcerpt: { type: 'string' },
          sourcePayload: {
            type: 'object',
            properties: {
              statusAtDocumentDate: { type: 'string' },
              dueDate: { type: 'string' },
              responsibleParty: { type: 'string' },
              relevanceScore: { type: 'string', enum: ['strong', 'medium', 'weak'] },
              relevanceReason: { type: 'string' },
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
} as const

// ─── Prompt système ───────────────────────────────────────────────────────────

function buildExtractionPrompt(text: string, pageCount: number): string {
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
- les moyens momentanément présents sur site (engins, personnel du jour) sans contexte de retard ou d'anomalie ;
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
- Règles de sécurité standard : EPI, harnais, PTAC, code de la route, balisage
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
- **action** : tâche à réaliser. Créer une action UNIQUEMENT si un responsable est explicitement nommé (entreprise ou personne) OU si un délai précis est mentionné. Sans ces deux conditions → **observation**.
- **decision** : décision structurante prise lors de la visite.
- **observation** : constatation factuelle, alerte ou signal spécifique à ce chantier, sans responsable nommé ni délai explicite. Inclut obligatoirement les formulations du type "Attention à [X]", "Risque de [Y]", "Veiller à [Z]" sans attribution.
- **deadline** : échéance chiffrée ou datée, spécifique à ce chantier.
- **knowledge_fact** : information factuelle durable sur le site. Inclut : l'avancement constaté lors de la visite (travaux exécutés ou en cours) avec statusAtDocumentDate = "réalisé" / "en cours" / "non démarré" ; l'état de plans techniques (VISA émis / en cours / refusé / à émettre) ; une contrainte technique permanente (nature du sol, cote NGF) ; l'état d'un ouvrage ou d'un matériau.
- **person** : personne physique identifiable (prénom + nom) présente ou signataire sur ce chantier. Renseigner dans description : sa fonction, son entreprise, son email ou téléphone si mentionnés.
- **company** : entreprise ou organisme avec rôle explicite sur ce chantier. Renseigner dans description : le rôle (MOE, gros-œuvre, bureau de contrôle…) et le contact nommé si disponible.

---

## Extraction des intervenants (cartouche et liste de présence)

Le cartouche du PV, la liste des signataires et la liste de présence contiennent souvent les intervenants clés du chantier.

Pour chaque **personne physique identifiable** (prénom + nom) mentionnée comme présente, signataire ou interlocuteur nommé :
- créer une proposition **person** ;
- label = "Prénom NOM" ;
- description = "Fonction — Entreprise [— email / téléphone]" selon disponibilité.

Pour chaque **entreprise ou organisme** cité avec un rôle précis sur ce chantier (pas seulement comme destinataire d'un document) :
- créer une proposition **company** ;
- label = "Nom de l'entreprise" ;
- description = "Rôle sur le chantier [— contact nommé]".

Ne pas extraire : mentions génériques sans nom ("le conducteur de travaux", "les entreprises"), noms de famille seuls sans prénom, listes de diffusion.

---

## Score de pertinence (champ relevanceScore dans sourcePayload — obligatoire)

Chaque proposition reçoit un score :

- **strong** : réserve ouverte ou levée, action nominative avec délai, décision structurante, avancement majeur (travaux terminés / démarrés / en retard), constat critique unique à ce chantier. → affiché en priorité.

- **medium** : observation pertinente mais secondaire, échéance de second rang, knowledge_fact stable et spécifique. → affiché.

- **weak** : information peu durable ou de faible valeur métier (prochaine réunion sans précision critique, constat mineur sans suivi, information facilement retrouvable dans le document source). → masqué par défaut dans l'interface.

Ajoute également un court \`relevanceReason\` (10 mots max) expliquant le score.

---

## Types de preuves

- **text_excerpt** : extrait de texte citant un passage clé (renseigne le champ \`text\`).
- **page_snapshot** : page contenant une photo ou un schéma.

### Traitement des pages photographiques

Pour chaque page comportant une ou plusieurs photos :

1. Crée une preuve de type **page_snapshot** avec :
   - une légende factuelle et descriptive de ce qui est **visuellement visible** sur la page : type de terrain, activité en cours, équipements présents, état apparent de la plateforme ou de l'ouvrage (ex : "Vue de la plateforme terrassée avec zones nivelées visibles", "Engins de terrassement en activité sur la plateforme", "Fossé GDE et busage provisoire posé"). Ne jamais affirmer qu'un travail est terminé ou conforme sur la seule base de la photo, sans confirmation dans le texte adjacent.
   - \`sourcePage\` : le numéro de la page.
   - \`nearbyText\` : le texte immédiatement adjacent à la photo dans le document, s'il existe.

2. Si cette page est associée à une ou plusieurs propositions textuelles (une réserve photographiée, un avancement visible mentionné dans le texte) :
   - inclus la clé de cette preuve dans les \`evidenceKeys\` de la proposition concernée.

3. Si aucune proposition existante ne correspond clairement à cette photo, crée la preuve seule (sans proposition liée). Ne crée pas de proposition pour décrire la photo.

---

## Idempotence

Chaque proposition et preuve reçoit un \`temporaryKey\` court et descriptif
(ex : "res-infiltration-p7", "act-joint-p8", "ev-text-p7-1", "ev-snap-p12").
Lie chaque preuve à sa proposition via \`evidenceKeys\`.

---

## Texte du document

${text}`
}

// ─── Découpage par pages ──────────────────────────────────────────────────────

const PAGES_PER_CHUNK = 20

function splitTextIntoChunks(text: string): string[] {
  const parts = text.split(/(?=\[\[page \d+\]\])/g).filter((s) => s.trim())
  if (parts.length === 0) return [text]
  const chunks: string[] = []
  for (let i = 0; i < parts.length; i += PAGES_PER_CHUNK) {
    chunks.push(parts.slice(i, i + PAGES_PER_CHUNK).join(''))
  }
  return chunks
}

// ─── Appel LLM (chunk unique) ─────────────────────────────────────────────────

async function callGeminiChunk(
  chunkText: string,
  totalPageCount: number,
  apiKey: string,
  model: string,
  chunkIndex: number,
): Promise<{ result: LlmExtractionResult; outputText: string }> {
  const prompt = buildExtractionPrompt(chunkText, totalPageCount)

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini extraction chunk ${chunkIndex} — HTTP ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    candidates: Array<{
      content: { parts: Array<{ text: string }> }
      finishReason?: string
    }>
  }
  const candidate = data.candidates?.[0]
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error(`Gemini output truncated (MAX_TOKENS) on chunk ${chunkIndex} — réponse JSON incomplète`)
  }
  const outputText = candidate?.content?.parts?.[0]?.text ?? ''
  if (!outputText) throw new Error(`Gemini returned empty output on chunk ${chunkIndex}`)

  const parsed: unknown = JSON.parse(outputText)
  const result = LlmExtractionResultSchema.parse(parsed)

  // Préfixer les clés temporaires pour garantir l'unicité lors de la fusion
  const prefix = chunkIndex > 0 ? `c${chunkIndex}-` : ''
  return {
    outputText,
    result: {
      proposals: result.proposals.map((p) => ({
        ...p,
        temporaryKey: prefix + p.temporaryKey,
        evidenceKeys: p.evidenceKeys.map((k) => prefix + k),
      })),
      evidence: result.evidence.map((e) => ({
        ...e,
        temporaryKey: prefix + e.temporaryKey,
      })),
    },
  }
}

// ─── Point d'entrée public ────────────────────────────────────────────────────

export async function extractHistoricalPvProposals(
  text: string,
  pageCount: number,
): Promise<LlmExtractionResult> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not set')

  const model = process.env.AI_MODEL ?? 'gemini-2.5-flash'
  const start = Date.now()
  let totalOutputText = ''

  const chunks = splitTextIntoChunks(text)
  const proposals: LlmProposal[] = []
  const evidence: LlmEvidence[] = []

  try {
    for (let i = 0; i < chunks.length; i++) {
      const { result, outputText } = await callGeminiChunk(chunks[i], pageCount, apiKey, model, i)
      totalOutputText += outputText
      proposals.push(...result.proposals)
      evidence.push(...result.evidence)
    }
    return { proposals, evidence }
  } finally {
    try {
      const { logAIUsageDirect } = await import('@/services/ai/tracking')
      void logAIUsageDirect({
        feature: 'extract_historical_pv',
        userId: null,
        provider: 'gemini',
        model,
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: Math.ceil(totalOutputText.length / 4),
        durationMs: Date.now() - start,
        status: totalOutputText ? 'success' : 'error',
        errorMsg: null,
      }).catch(() => {})
    } catch {
      /* tracking non bloquant */
    }
  }
}
