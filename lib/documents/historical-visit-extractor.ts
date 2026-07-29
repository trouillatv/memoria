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
  family: z.enum(['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact']),
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
            enum: ['reservation', 'action', 'decision', 'observation', 'deadline', 'knowledge_fact'],
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
Numéro du CR, titre du CR, validation du CR précédent, ordre du jour, liste de diffusion, interlocuteurs principaux généraux : ne rien créer.

**5. Un titre seul sans état associé ?**
"Plan VRD", "Plan de terrassement" sans mention d'un état (VISA en cours / émis / refusé / à émettre) : ne rien créer. En revanche "Plan de terrassement — VISA en cours" → observation ou knowledge_fact.

**6. Cette information décrit-elle une évolution concrète du chantier, ou seulement son organisation documentaire, contractuelle ou opérationnelle habituelle ?**
Ne rien extraire lorsque l'information décrit seulement :
- qui transmet ou diffuse un document (procédure de diffusion, destinataires) ;
- qui est l'interlocuteur habituel ou comment contacter une entreprise ;
- comment les entreprises doivent communiquer entre elles ;
- un accès existant au chantier sans changement signalé ;
- les moyens momentanément présents sur site (engins, personnel du jour) sans contexte de retard ou d'anomalie ;
- l'existence ou l'état administratif d'un document (transmis, reçu, validé) sans conséquence chantier explicite.

Attention : "Plan des installations de chantier : FAIT" décrit l'état administratif du document, pas l'achèvement physique du chantier. Ne pas convertir l'un en l'autre.

**Question centrale : cette information sera-t-elle encore utile dans 6 mois à un conducteur qui n'était pas à cette réunion ?** Si non → ne rien créer.

---

## Exclusions absolues

Ne jamais créer de proposition pour :
- En-têtes, pieds de page, numéros de page, titre et numéro du compte-rendu
- "CR précédent lu et approuvé", "Acceptation sans réserve"
- Listes de présence, de diffusion, interlocuteur privilégié général, procédure de communication entre entreprises
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
4. Distinguer les points ouverts et les points résolus : un point résolu peut être une knowledge_fact ou une decision.
5. Citer la page exacte (sourcePage) — utilise les marqueurs [[page N]].
6. Ne pas déduire des intentions — se limiter aux faits et décisions explicitement mentionnés.
7. Pour une réservation : conserver le libellé exact du PV, préciser l'état si mentionné (ouvert/levé/en cours).
8. Pour une action : ne citer que les actions explicitement attribuées (responsable nommé ou délai mentionné).
9. Une photo sans description textuelle adjacente → evidence uniquement (page_snapshot), pas de proposition.
10. Un chiffre ou mesure sans contexte clair → observation, pas action.

---

## Familles de propositions

- **reservation** : réserve de chantier (défaut, malfaçon, non-conformité) — ouverture, suivi ou levée.
- **action** : tâche à réaliser, avec responsable nommé ou délai explicite.
- **decision** : décision structurante prise lors de la visite.
- **observation** : constatation factuelle spécifique à ce chantier, sans action requise.
- **deadline** : échéance chiffrée ou datée, spécifique à ce chantier.
- **knowledge_fact** : information factuelle durable et utile à la connaissance long terme du site (ex : nature du sol, contrainte technique permanente, état d'un ouvrage).

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
   - une légende factuelle et prudente décrivant ce qui est visible (ex : "Vue de la plateforme de terrassement depuis l'est", "Détail de la jonction entre le mur de soutènement et la dalle"). Ne jamais affirmer qu'un travail est terminé ou conforme si ce n'est pas explicitement mentionné dans le texte adjacent.
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

// ─── Appel LLM ───────────────────────────────────────────────────────────────

export async function extractHistoricalPvProposals(
  text: string,
  pageCount: number,
): Promise<LlmExtractionResult> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENAI_API_KEY not set')

  const model = process.env.AI_MODEL ?? 'gemini-2.5-flash'
  const prompt = buildExtractionPrompt(text, pageCount)
  const start = Date.now()
  let outputText = ''

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 16000,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        }),
      },
    )

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gemini extraction ${res.status}: ${body}`)
    }

    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>
    }
    outputText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const parsed: unknown = JSON.parse(outputText)
    return LlmExtractionResultSchema.parse(parsed)
  } finally {
    try {
      const { logAIUsageDirect } = await import('@/services/ai/tracking')
      void logAIUsageDirect({
        feature: 'extract_historical_pv',
        userId: null,
        provider: 'gemini',
        model,
        inputTokens: Math.ceil(text.length / 4),
        outputTokens: Math.ceil(outputText.length / 4),
        durationMs: Date.now() - start,
        status: outputText ? 'success' : 'error',
        errorMsg: null,
      }).catch(() => {})
    } catch {
      /* tracking non bloquant */
    }
  }
}
