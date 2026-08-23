import 'server-only'
import { z } from 'zod'

// ─── Classe sentinelle timeout LLM ───────────────────────────────────────────
// Exportée pour que extract-historical-pv.ts puisse la détecter dans le catch.
export class LlmTimeoutError extends Error {
  constructor(msg: string) { super(msg); this.name = 'LlmTimeoutError' }
}

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
    companyRole: z.string().nullish(),
    dueDate: z.string().nullish(),
    responsibleParty: z.string().nullish(),
    linkedActorTemporaryKey: z.string().nullish(),
    relevanceScore: z.enum(['strong', 'medium', 'weak']).nullish(),
    relevanceReason: z.string().nullish(),
    linkedCompanyName: z.string().nullish(),
    emailAddress: z.string().nullish(),
    phoneNumber: z.string().nullish(),
    thematic_category: z.enum(['progress', 'test_control', 'forecast', 'safety_environment', 'resources', 'administrative', 'weather', 'permanent_instruction', 'general_knowledge']).nullish(),
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
              companyRole: {
                type: 'string',
                enum: ['maître d\'ouvrage', 'AMO', 'maître d\'œuvre', 'entreprise titulaire', 'sous-traitant', 'partenaire', 'diffusion uniquement'],
              },
              dueDate: { type: 'string' },
              responsibleParty: { type: 'string' },
              linkedActorTemporaryKey: { type: 'string' },
              relevanceScore: { type: 'string', enum: ['strong', 'medium', 'weak'] },
              relevanceReason: { type: 'string' },
              linkedCompanyName: { type: 'string' },
              emailAddress: { type: 'string' },
              phoneNumber: { type: 'string' },
              thematic_category: {
                type: 'string',
                enum: ['progress', 'test_control', 'forecast', 'safety_environment', 'resources', 'administrative', 'weather', 'permanent_instruction', 'general_knowledge'],
              },
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

function buildExtractionPrompt(text: string, pageCount: number, siteContext?: string): string {
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

- **reservation** : réserve de chantier (défaut, malfaçon, non-conformité) — ouverture, suivi ou levée. Lorsque l'entreprise chargée de lever la réserve est explicitement nommée et correspond à une proposition 'company' du même document, renseigner sourcePayload.linkedActorTemporaryKey avec la temporaryKey exacte de cette proposition. Utiliser uniquement une temporaryKey réelle produite dans ce même run. Ne jamais inventer une clé, ne jamais relier par proximité de page ou de nom.
- **action** : tâche à réaliser. Créer une action UNIQUEMENT si un responsable est explicitement nommé (entreprise ou personne) OU si un délai précis est mentionné. Sans ces deux conditions → **observation**. Lorsque le responsable nommé correspond à une proposition 'person' ou 'company' du même document, renseigner sourcePayload.linkedActorTemporaryKey avec la temporaryKey exacte de cette proposition. Utiliser uniquement une temporaryKey réelle produite dans ce même run. Ne jamais inventer une clé, ne jamais relier par proximité de page ou de nom : soit la clé existe dans les propositions du run, soit le champ est absent. Pour la famille action : renseigner sourcePayload.statusAtDocumentDate uniquement si l'état de la tâche est explicitement établi par le document. Utiliser le vocabulaire canonique : "en cours" pour une action déclarée en progression, "ouvert" pour une action non soldée. Ne jamais émettre "à faire" comme valeur. N'émettre un état terminal tel que "réalisé" que si la tâche est entièrement soldée, sans réserve, attente ou reprise associée. "réalisé … non conforme", "réalisé … reprise à faire" ou "réalisé … en attente" ne prouvent jamais la résolution — laisser absent. Un VISA ou visa de plan ne prouve jamais à lui seul l'achèvement de la tâche physique.
- **decision** : décision structurante prise lors de la visite. Lorsque le décisionnaire nommé correspond à une proposition 'person' ou 'company' du même document, renseigner sourcePayload.linkedActorTemporaryKey avec la temporaryKey exacte de cette proposition. Utiliser uniquement une temporaryKey réelle produite dans ce même run. Ne jamais inventer une clé, ne jamais relier par proximité de page ou de nom : soit la clé existe dans les propositions du run, soit le champ est absent.
- **observation** : constatation factuelle, alerte ou signal spécifique à ce chantier, sans responsable nommé ni délai explicite. Inclut obligatoirement les formulations du type "Attention à [X]", "Risque de [Y]", "Veiller à [Z]" sans attribution.
- **deadline** : échéance chiffrée ou datée, spécifique à ce chantier — y compris un jalon de planning (« semaine X », date de reprise, date de prochaine réunion) même situé dans une section "PRÉVISIONS" ou "PROGRAMME" : toute date ou échéance précise l'emporte toujours sur un classement en knowledge_fact.forecast. Lorsque le responsable de cette échéance correspond à une proposition 'person' ou 'company' du même document, renseigner sourcePayload.linkedActorTemporaryKey avec la temporaryKey exacte de cette proposition. Utiliser uniquement une temporaryKey réelle produite dans ce même run. Ne jamais inventer une clé, ne jamais relier par proximité de page ou de nom.
- **knowledge_fact** : information factuelle durable sur le site. Inclut : l'avancement constaté lors de la visite (travaux exécutés ou en cours) avec statusAtDocumentDate = "réalisé" / "en cours" / "non démarré" ; l'état de plans techniques (VISA émis / en cours / refusé / à émettre) ; une contrainte technique permanente (nature du sol, cote NGF) ; l'état d'un ouvrage ou d'un matériau. Pour chaque knowledge_fact, renseigner **sourcePayload.thematic_category** avec la catégorie thématique correspondante :
  - "progress" — avancement des travaux constatés (réalisés ou en cours) : terrassement, maçonnerie, finitions, installations
  - "test_control" — essais, contrôles, conformité, visas de plans, non-conformités constatées
  - "forecast" — travaux, contrôles, coordinations, livrables ou étapes planifiées pour la prochaine période (ex : "récolement en prévision", "coordination LOT02", "essais complémentaires à réaliser"). **Règle prioritaire** : toute section intitulée "PRÉVISIONS", "PROGRAMME", "TRAVAUX PRÉVUS", "PROCHAINE PÉRIODE", "SUITE À DONNER" ou similaire dans le PV → extraire **chaque item** comme **knowledge_fact** avec thematic_category='forecast', même sans responsable ni date explicite. Ne jamais classer un item d'une section PRÉVISIONS comme observation ou action s'il s'agit d'une étape planifiée. Distinguer de deadline : si une date précise est mentionnée pour un item → créer un **deadline** pour cette échéance ET conserver les autres items sans date comme knowledge_fact.forecast.
  - "safety_environment" — anomalies et constats de sécurité **spécifiques à ce chantier** (risque identifié sur ce site, zone non protégée, incident, accident, non-conformité de sécurité particulière, consigne propre à ce chantier) et impacts environnementaux propres au chantier. Exclure les règles génériques applicables à tous les chantiers → voir 'permanent_instruction'.
  - "resources" — moyens humains et matériels effectivement présents sur site
  - "administrative" — coordination documentaire, plans transmis/reçus, DICT, contractuel
  - "weather" — météo, intempéries, arrêts pour cause climatique
  - "permanent_instruction" — consigne répétée dans chaque CR (port EPI, tri déchets, balisage standard) — à distinguer d'une anomalie active
  - "general_knowledge" — autre information factuelle ne rentrant dans aucune catégorie ci-dessus

  **Consolidation des tableaux et listes répétitifs** : Lorsqu'un tableau ou une liste contient plusieurs lignes partageant (a) le même verdict/état, (b) le même type d'objet métier, (c) la même localisation, et dont aucune ne porte d'anomalie, de mesure signifiante, d'acteur, de date, d'échéance ou de conséquence propre → produire **un seul knowledge_fact de synthèse** (label : résumé du constat commun + nombre de lignes) et préserver toutes les lignes sources dans sourceExcerpt (verbatim, séparées par " · "). **Ne jamais consolider** des lignes qui diffèrent par : verdict ou polarité (une ligne anomalie/NC/hors-seuil n'est jamais fusionnée avec des lignes RAS/conforme), objet métier distinct, localisation métier structurante, acteur/responsable, date/échéance, valeur ou mesure porteuse de sens, ou conséquence/action associée. En cas de verdict commun mais localisations ou raisons distinctes → regrouper **par localisation ou par raison** (N knowledge_facts, N étant nettement inférieur au nombre de lignes). La simple répétition de "RAS / conforme / non examiné" ou d'un numéro de repère technique ne justifie jamais N knowledge_facts distincts.

- **person** : personne physique identifiable (prénom + nom) mentionnée dans le cartouche ou la liste de présence. Renseigner dans description : "Fonction — Entreprise [— email / tel]". Dans sourcePayload, renseigner statusAtDocumentDate avec le statut de présence ("présent" / "invité" / "absent excusé" / "absent non excusé" / "diffusion uniquement" / "inconnu").
- **company** : entreprise ou organisme cité avec un rôle sur ce chantier. Renseigner dans description : "Rôle chantier [— contact nommé]". Dans sourcePayload, renseigner **companyRole** (champ obligatoire) avec le rôle exact de l'entreprise. Une entreprise uniquement destinataire d'un document → "diffusion uniquement".

---

## Extraction des intervenants (cartouche et liste de présence)

Le cartouche du PV, la liste des signataires et la liste de présence contiennent souvent les intervenants clés du chantier.

**Règle de priorité** : le caractère générique ou méthodologique du reste du document ne suspend pas l'extraction des personnes et entreprises nommées lorsqu'elles apparaissent dans un cartouche identifiable (liste de présence, liste de membres, liste de signataires, liste des auteurs, liste d'approbation). L'extraction des familles **person** et **company** obéit à ses propres règles, indépendamment du contenu thématique du document — un guide professionnel, une note méthodologique ou un gabarit contenant une liste nommée de membres ou de signataires doit produire des propositions person/company exactement comme un CR de chantier classique.

Pour chaque **personne physique identifiable** (prénom + nom) mentionnée dans le cartouche, comme signataire ou dans la liste de présence :
- créer une proposition **person** ;
- label = "Prénom NOM" ;
- description = "Fonction — Entreprise [— email / téléphone]" selon disponibilité ;
- sourcePayload.statusAtDocumentDate = statut de présence parmi : "présent", "invité", "absent excusé", "absent non excusé", "diffusion uniquement", "inconnu" ;
- sourcePayload.linkedCompanyName = nom exact de l'entreprise à laquelle appartient cette personne, si identifiable dans le document (ex : "BatiSud") ;
- sourcePayload.emailAddress = adresse email de la personne si présente dans le document ;
- sourcePayload.phoneNumber = numéro de téléphone (mobile ou fixe) de la personne si présent dans le document.

Créer une **company distincte** pour l'entreprise de cette personne si elle n'a pas déjà de proposition company.

Pour chaque **entreprise ou organisme** identifiable avec un rôle sur ce chantier :
- créer une proposition **company** ;
- label = "Nom de l'entreprise" ;
- description = "Rôle chantier [— contact nommé]" ;
- sourcePayload.**companyRole** = rôle OBLIGATOIRE — ne jamais laisser vide pour une entreprise présente sur le chantier.

Correspondances habituelles dans les PV français :
MO / Maître d'ouvrage / Propriétaire → "maître d'ouvrage"
MOE / Maître d'œuvre / Architecte / BET / Bureau d'études → "maître d'œuvre"
AMO / Assistant à maîtrise d'ouvrage → "AMO"
Titulaire / Entreprise / Marché / Adjudicataire → "entreprise titulaire"
Sous-traitant / ST / Co-traitant → "sous-traitant"
Autre intervenant présent sans contrat direct → "partenaire"
Destinataire d'un document uniquement, sans présence → "diffusion uniquement"

**Règle critique** : une entreprise apparaissant uniquement comme destinataire d'un document (diffusion) sans intervenant nommé sur ce chantier → ne pas créer de proposition company.

Ne pas extraire : rôles génériques sans nom ("le maître d'ouvrage"), initiales seules, noms de famille sans prénom.

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

2. Si cette page montre **visuellement et spécifiquement** une réserve, une anomalie ou un avancement physique décrit dans une proposition de famille \`reservation\`, \`observation\` ou \`action\` :
   - inclus la clé de cette preuve dans les \`evidenceKeys\` de cette proposition.
   - **N'ajoute jamais** de \`evidenceKeys\` à une proposition de famille \`knowledge_fact\`, \`deadline\`, \`decision\`, \`person\` ou \`company\` : une photo générale ne constitue pas une preuve de mémoire, d'échéance ou de décision.
   - Si la photo est générale (vue de chantier, engins, terrain) sans lien direct et spécifique à une proposition précise, ne l'associe à aucune proposition.

3. Si aucune proposition existante ne correspond clairement à cette photo, crée la preuve seule (sans proposition liée). Ne crée pas de proposition pour décrire la photo.

---

## Idempotence

Chaque proposition et preuve reçoit un \`temporaryKey\` court et descriptif
(ex : "res-infiltration-p7", "act-joint-p8", "ev-text-p7-1", "ev-snap-p12").
Lie chaque preuve à sa proposition via \`evidenceKeys\`.

---

${siteContext
  ? `## Contexte connu du chantier\n\nLes éléments ci-dessous sont des connaissances déjà structurées de ce chantier : sujets suivis, acteurs connus et formulations alternatives déjà validées.\n\nUtilise ce contexte pour reconnaître les noms propres, acronymes, acteurs et termes métier du document. Extrais le contenu **fidèlement à la source** : ne remplace pas la formulation du document par un label canonique. La résolution d'identité vers un sujet canonique est effectuée séparément, après extraction.\n\n${siteContext}\n\n---\n\n`
  : ''}## Texte du document

${text}`
}

// ─── Préfixage des clés temporaires (chunk merge) ────────────────────────────

export function prefixChunkResult(result: LlmExtractionResult, chunkIndex: number): LlmExtractionResult {
  const prefix = chunkIndex > 0 ? `c${chunkIndex}-` : ''
  if (!prefix) return result
  return {
    proposals: result.proposals.map((p) => ({
      ...p,
      temporaryKey: prefix + p.temporaryKey,
      evidenceKeys: p.evidenceKeys.map((k) => prefix + k),
      sourcePayload: p.sourcePayload?.linkedActorTemporaryKey
        ? { ...p.sourcePayload, linkedActorTemporaryKey: prefix + p.sourcePayload.linkedActorTemporaryKey }
        : p.sourcePayload,
    })),
    evidence: result.evidence.map((e) => ({ ...e, temporaryKey: prefix + e.temporaryKey })),
  }
}

// ─── Découpage par pages ──────────────────────────────────────────────────────

const PAGES_PER_CHUNK = 10

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
  siteContext?: string,
): Promise<{ result: LlmExtractionResult; outputText: string }> {
  const prompt = buildExtractionPrompt(chunkText, totalPageCount, siteContext)

  let res: Response
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(220000),
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
  } catch (fetchErr) {
    // AbortSignal.timeout() produit un DOMException { name: 'TimeoutError' }
    const isTimeout = fetchErr instanceof Error &&
      (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError')
    if (isTimeout) {
      throw new LlmTimeoutError(`Gemini extraction timeout on chunk ${chunkIndex}`)
    }
    throw fetchErr
  }

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

  return { outputText, result: prefixChunkResult(result, chunkIndex) }
}

// ─── Point d'entrée public ────────────────────────────────────────────────────

export async function extractHistoricalPvProposals(
  text: string,
  pageCount: number,
  siteContext?: string,
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
      const { result, outputText } = await callGeminiChunk(chunks[i], pageCount, apiKey, model, i, siteContext)
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
