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

export function buildExtractionPrompt(text: string, pageCount: number, siteContext?: string): string {
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

**Exception — clause normative de contexte** : une clause réglementaire ou chiffrée générique (distance maximale, largeur ERP, valeur RVRAT…) directement nécessaire pour comprendre un constat ou une prescription retenue peut être **conservée dans le sourceExcerpt de cette proposition**, comme preuve contextuelle. Elle ne devient JAMAIS un objet métier autonome (pas de knowledge_fact/observation séparé pour la règle elle-même), et ne justifie pas de fusionner deux sujets métier distincts qui se trouvent proches de cette clause dans le texte. **INVARIANT — la norme ne remplace jamais le concret** : lorsqu'une clause normative est citée EN MÊME TEMPS qu'un constat ou une action opérationnelle appliqués à ce chantier (ex. « la norme impose 2 m ; l'espace mesuré est de 1,20 m, reprendre le passage »), le constat/l'action concret reste **obligatoirement** extrait comme **observation**/**action**/**reservation** selon sa nature — la clause ne fait qu'enrichir son sourceExcerpt ou sa description. Ne transforme JAMAIS un tel passage en un knowledge_fact isolé portant uniquement la règle générique : si un knowledge_fact est créé pour capter la règle comme connaissance utile, il s'ajoute au constat/à l'action concrets, il ne s'y substitue jamais. Seule une clause normative citée SANS aucune application ou constat concret à ce chantier reste soumise au filtrage habituel (Exclusions absolues ci-dessus).

---

## DEUXIÈME ÉTAPE — Doctrine d'extraction

Pour chaque information retenue après la sélection :

1. Ne jamais inventer des données absentes du texte — extraction pure, zéro inférence.
2. La FAMILLE se décide sur la NATURE de l'énoncé, JAMAIS sur la présence d'un responsable ou d'une date : un ÉTAT constaté → **observation** ; une CHOSE À FAIRE explicitement demandée (prescription, consigne, préconisation, verbe d'action à réaliser : vérifier, transmettre, mettre en place, reprendre, organiser, modifier, récupérer, installer, déplacer, évacuer, sécuriser, former…) → **action**, même sans responsable ni date. Ne jamais fabriquer une action à partir d'un simple constat, ni ranger une prescription explicite en observation.
3. Conserver les formulations incertaines (« à vérifier », « à confirmer », « semble ») dans le label ou la description.
3c. Une prescription assortie d'une CONDITION ou d'une MODALITÉ explicite (« si… », « non obligatoire », « le cas échéant », « à envisager », « option », « recommandé sans obligation », « décision à prendre ») doit conserver cette nuance jusque dans le **label** lui-même, pas seulement dans la description — ne jamais reformuler une prescription conditionnelle ou optionnelle en obligation ferme (ex. ne pas transformer « Prévoir un désenfumage naturel si la DM n'excède pas 30 m (non obligatoire) » en « Prévoir un désenfumage naturel » sans la réserve). Si le document présente explicitement un choix ou une décision à prendre plutôt qu'une prescription déjà tranchée → utiliser la famille **decision** existante plutôt qu'une action ferme ; ne jamais créer de nouvelle famille pour cela.
3b. Lorsque le texte source semble corrompu ou ambigu (coquille, OCR dégradé, formulation incohérente), ne pas affirmer plus que ce que le document permet. Formuler avec prudence : "Accès plateforme — indiqué comme réalisé dans le PV" plutôt que "Accès plateforme réalisé".
4. Distinguer les points ouverts et les points résolus : un travail décrit au passé ou comme terminé (« déblais terminés », « purge exécutée ») → **knowledge_fact** avec statusAtDocumentDate='réalisé', jamais une action ou observation.
4b. Une valeur lue dans une colonne intitulée « Levées », « Suite à donner », « État » ou similaire ne prouve JAMAIS à elle seule la clôture d'une réserve ou d'une action — raisonne sur le SENS de la cellule, jamais sur le nom de la colonne. Une cellule de la colonne « Levées » peut tout aussi bien indiquer qu'une réserve reste À LEVER, est partiellement levée, ou reste ouverte : dans ce cas, la réserve/action reste ouverte et ne devient pas "réalisé"/"levé".
4c. Un thème de tableau au statut **« Non vérifié »** (ou équivalent : non contrôlé, non examiné, non testé) DONT LA CELLULE PRÉCONISATION EST VIDE ne produit JAMAIS d'action synthétique du type « Vérifier <thème> ». L'absence de contrôle documentée est un état, pas une prescription — conserve-la en observation ou knowledge_fact si elle a une valeur de suivi, mais ne fabrique jamais une obligation « à vérifier » à partir du seul statut. Ne crée une action pour ce thème que si le document formule EXPLICITEMENT une consigne de vérification (texte présent dans la cellule préconisation ou ailleurs, appliqué à ce thème précis) — ne la déduis jamais du statut seul.
5. Citer la page exacte (sourcePage) — utilise les marqueurs [[page N]].
6. Ne pas déduire des intentions — se limiter aux faits et décisions explicitement mentionnés.
7. Pour une réservation : conserver le libellé exact du PV, préciser l'état si mentionné (ouvert/levé/en cours).
8. Pour une action : le responsable (responsibleParty) et la date (dueDate) sont des ENRICHISSEMENTS facultatifs — renseigne-les s'ils sont explicites dans le texte, laisse-les absents sinon. Leur absence NE transforme JAMAIS une prescription en observation. Ne jamais inventer un responsable ni une date.
9. Une photo sans description textuelle adjacente → evidence uniquement (page_snapshot), pas de proposition.
10. Un chiffre ou mesure sans contexte clair → observation, pas action.

---

## Atomicité — une proposition = un sujet métier durable

INVARIANT : chaque proposition doit se rattacher SANS PERTE à UNE SEULE identité métier durable — un
sujet dont on pourra suivre l'évolution dans le temps. Cela ne veut PAS dire « un équipement », ni « un
nom », ni « un élément d'une liste ».

**Éclatement — quand une phrase source affirme un MÊME état sur PLUSIEURS sujets qui pourront ensuite
évoluer INDÉPENDAMMENT, produis PLUSIEURS propositions**, une par sujet suivi. Exemple :
« Contrôle électrique + éclairage + appareils de cuisson : à refaire » →
- « Contrôle des installations électriques — à refaire »
- « Contrôle de l'éclairage de sécurité — à refaire »
- « Contrôle des appareils de cuisson — à refaire »
Les propositions issues d'une même phrase partagent la MÊME page (sourcePage), le MÊME extrait
(sourceExcerpt) et les MÊMES preuves (evidenceKeys identiques), la même date, la même priorité si
justifiée, et le même acteur (linkedActorTemporaryKey) UNIQUEMENT si le texte l'attribue réellement à
chacun. **Ne jamais inventer une preuve, un extrait ou une page différents pour justifier l'éclatement.**

**Contre-test OBLIGATOIRE avant d'éclater — les DEUX questions doivent être OUI :**
1. Ces éléments peuvent-ils réellement prendre des ÉTATS FUTURS INDÉPENDANTS dans le suivi métier ?
   (ex. électrique réalisé / éclairage encore à refaire / cuisson non applicable)
2. Serais-tu capable de RETROUVER chacun de ces sujets INDIVIDUELLEMENT dans un prochain CR ?
Si l'une des réponses est NON, ou en cas de DOUTE → **UNE SEULE proposition**. L'atomicité sert la
mémoire longitudinale, pas la granularité maximale : ne fabrique pas de micro-sujets artificiels.

**Ne JAMAIS éclater par simple présence de « et », « / », « + », de virgules ou d'une liste.** Conserver
en UNE proposition (composants, attributs, relation, ou énumération d'un seul sujet) — cas obligatoires :
- conduits d'extraction d'air vicié / de buée / de graisse → UN système de conduits suivi ;
- tableau + câblage d'une installation électrique → UNE installation électrique ;
- portes CF d'un niveau → UN sujet collectif si aucune porte n'est identifiée/suivie individuellement ;
- SSI avec CMSI / détecteurs / diffuseurs → UN sujet SSI si le document ne les traite pas en sujets
  indépendants ;
- coordination entre LOT01 et LOT02 → UNE proposition (la coordination entre les lots EST le sujet).

En cas d'hésitation, **conserve la proposition composite** : un sous-découpage est récupérable plus tard,
un sur-découpage fragmente la mémoire de façon irréversible.

---

## Constat + action dans un même passage

Un même passage peut contenir À LA FOIS un état constaté ET une prescription. Dans ce cas,
produis DEUX propositions — une **observation** (l'état) et une **action** (la chose à faire) —
partageant le MÊME sujet, la MÊME page (sourcePage) et les MÊMES preuves (evidenceKeys). Ne
jamais écraser l'une dans l'autre : ce sont deux natures différentes du même sujet. Exemples :
- « Coupure d'arrêt d'urgence non présente + personnel non formé. Vérifier les arrêts d'urgence
  et former le personnel. » → **observation** (absence constatée) + **action** (vérifier / former).
- « Extincteur manquant près des caisses » seul → **observation** ; si le texte ajoute « à
  compléter / à installer » → ajouter l'**action** correspondante.
Ne produis l'action que si la prescription est RÉELLEMENT présente dans le texte — ne jamais
l'inventer à partir d'un simple constat.

---

## Consolidation intra-document — un sujet répété = UNE proposition à preuves multiples

Un même sujet métier est souvent mentionné PLUSIEURS FOIS dans le document : dans un tableau de
détail, puis dans une section « Prioriser les actions » / « Préconisations », parfois une
troisième fois dans la conclusion ou la synthèse. Ce ne sont PAS plusieurs objets. Produis
**UNE SEULE proposition** par sujet, et rattache-lui **TOUTES** ses preuves : cumule les
\`evidenceKeys\` de chaque mention et concatène les extraits dans \`sourceExcerpt\` (séparés par
" · "), en citant la page de chaque mention. S'applique à TOUTES les familles (action,
observation, reservation, deadline, knowledge_fact, decision), pas seulement aux tableaux.

**Une phrase de synthèse ou de conclusion qui REPREND des sujets DÉJÀ détectés** (ex. « Urgence :
vérifier les arrêts d'urgence + mettre en place un SSIAP 2 + tester le SSI » alors que ces trois
sujets existent déjà) ne crée AUCUN nouvel objet — et surtout aucun objet COMPOSITE agrégeant
plusieurs sujets. Elle sert de **preuve supplémentaire** et, si elle exprime une urgence/priorité,
relève le relevanceScore des sujets concernés.

**Distinguer consolidation et éclatement** : l'éclatement sépare une phrase portant sur PLUSIEURS
sujets à évolution indépendante ; la consolidation regroupe PLUSIEURS mentions d'UN MÊME sujet.
Les deux coexistent sans se contredire.

**Rester CONSERVATEUR** : ne fusionne que si c'est le MÊME sujet métier suivable. Deux sujets
proches mais réellement distincts (localisations différentes, objets métier différents, verdicts
opposés conforme / non conforme) restent DEUX propositions. En cas de DOUTE, **ne pas fusionner** :
conserver deux candidats incertains est récupérable, fusionner deux vrais sujets distincts est
irréversible.

**État terminal intra-document** : si le MÊME sujet métier apparaît d'abord comme ouvert (constat,
action à faire, réserve) PUIS, plus loin dans le MÊME document, comme explicitement résolu (réalisé,
fait, OK, RAS, abandonné, non-retenu) — l'état terminal l'emporte pour la proposition consolidée :
statusAtDocumentDate reflète la résolution, avec les preuves des deux mentions. Cette consolidation
reste CONSERVATRICE : ne l'applique que si les deux mentions désignent sans ambiguïté le même sujet
suivable ; ne fusionne jamais deux sous-items différents au seul motif qu'ils partagent la même
cellule de tableau ou le même thème.

---

## Familles de propositions

- **reservation** : réserve de chantier (défaut, malfaçon, non-conformité) — ouverture, suivi ou levée. Une proposition relève de **reservation** uniquement si le document l'identifie EXPLICITEMENT comme telle : le mot « réserve »/« réservation » est employé, OU l'élément provient d'un rapport de contrôle/organisme agréé (contrôle technique, vérification réglementaire), OU le texte la qualifie explicitement « à lever »/« levée ». **La répétition d'une même non-conformité sur plusieurs visites n'est JAMAIS, à elle seule, un critère de classement en reservation** : un rappel qui revient (« rappel 1 », « rappel 2 »…) sans être qualifié de réserve reste une **observation** (le constat qui persiste) ou une **action** (la prescription reformulée), selon sa nature — la récurrence renforce éventuellement relevanceScore, elle ne change jamais la famille. Lorsque l'entreprise chargée de lever la réserve est explicitement nommée et correspond à une proposition 'company' du même document, renseigner sourcePayload.linkedActorTemporaryKey avec la temporaryKey exacte de cette proposition. Utiliser uniquement une temporaryKey réelle produite dans ce même run. Ne jamais inventer une clé, ne jamais relier par proximité de page ou de nom.
- **action** : une CHOSE À FAIRE explicitement demandée par le document — prescription, consigne, préconisation, item d'une liste « actions à réaliser / à prioriser », verbe d'action à l'infinitif ou à l'impératif (vérifier, transmettre, mettre en place, reprendre, organiser, modifier, récupérer, installer, déplacer, évacuer, sécuriser, former…). Une action reste une action **même sans responsable ni date**, et **quelle que soit la colonne ou la section** où elle figure (« Préconisations », « Remarques », « Conclusions », ou une phrase descriptive). Le responsable et la date sont des enrichissements facultatifs (cf. doctrine §8), jamais une condition d'existence. Lorsque le responsable nommé correspond à une proposition 'person' ou 'company' du même document, renseigner sourcePayload.linkedActorTemporaryKey avec la temporaryKey exacte de cette proposition. Utiliser uniquement une temporaryKey réelle produite dans ce même run. Ne jamais inventer une clé, ne jamais relier par proximité de page ou de nom : soit la clé existe dans les propositions du run, soit le champ est absent. Pour la famille action : renseigner sourcePayload.statusAtDocumentDate uniquement si l'état de la tâche est explicitement établi par le document. Utiliser le vocabulaire canonique : "en cours" pour une action déclarée en progression, "ouvert" pour une action non soldée. Ne jamais émettre "à faire" comme valeur. N'émettre un état terminal tel que "réalisé" que si la tâche est entièrement soldée, sans réserve, attente ou reprise associée. "réalisé … non conforme", "réalisé … reprise à faire" ou "réalisé … en attente" ne prouvent jamais la résolution — laisser absent. Un VISA ou visa de plan ne prouve jamais à lui seul l'achèvement de la tâche physique.
- **decision** : décision structurante prise lors de la visite. Lorsque le décisionnaire nommé correspond à une proposition 'person' ou 'company' du même document, renseigner sourcePayload.linkedActorTemporaryKey avec la temporaryKey exacte de cette proposition. Utiliser uniquement une temporaryKey réelle produite dans ce même run. Ne jamais inventer une clé, ne jamais relier par proximité de page ou de nom : soit la clé existe dans les propositions du run, soit le champ est absent.
- **observation** : un ÉTAT constaté, une alerte ou un signal spécifique à ce chantier — ce que le document DÉCRIT, pas ce qu'il demande de faire. Ex. « CTA non relié au SSI », « Extincteur manquant », « Ventilation non testée », « Porte CF bloquée ouverte ». Inclut les formulations d'alerte « Attention à [X] », « Risque de [Y] » sans prescription associée. Si le passage DEMANDE en outre quelque chose (« … à vérifier », « reprendre … »), produire EN PLUS une proposition **action** (cf. « Constat + action dans un même passage ») — ne jamais ranger la prescription en observation.
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

  **Ne jamais perdre un verdict documentaire structuré** : une ligne de tableau qui associe un **thème métier identifiable** (ex. "SSI", "Sprinkler", "Désenfumage", un repère technique nommé) à un **verdict** (C / NC / conforme / non conforme / RAS…) est une information réelle, même sans commentaire additionnel — sa brièveté ou son caractère générique en apparence ne justifie JAMAIS de l'omettre purement et simplement. Pour chaque ligne thème+verdict distincte : (1) si un autre objet du **même sujet** (même thème métier, même localisation) existe déjà parmi les propositions de ce document — observation, action, reservation ou knowledge_fact — n'en recrée pas un second : rattache la ligne comme evidenceKey supplémentaire ou intègre le verdict dans sa description/sourceExcerpt ; (2) sinon, crée une proposition dédiée (observation si l'état est simplement constaté, reservation si le document la qualifie explicitement de réserve) portant ce thème et ce verdict. **Distinction avec un libellé de colonne isolé** : un en-tête de colonne seul ("NC", "État", "C") sans thème métier associé n'est pas une information et ne devient jamais une proposition ni une evidenceKey — seule la paire thème+verdict compte comme constat.

- **person** : personne physique identifiable (prénom + nom) mentionnée dans le cartouche ou la liste de présence. Renseigner dans description : "Fonction — Entreprise [— email / tel]". Dans sourcePayload, renseigner statusAtDocumentDate avec le statut de présence — **doctrine PREUVE-FIRST : la présence ne s'INFÈRE JAMAIS d'une simple mention, d'un rôle (RUS, MOE, AMO, maître d'ouvrage, titulaire), d'un statut d'« interlocuteur », de « contact », de « client », d'une appartenance à une entreprise ni d'une présence au cartouche/en-tête.** N'émettre "présent" que sur PREUVE EXPLICITE (cf. section « Statut de présence »). À défaut de preuve → "inconnu". Valeurs autorisées : "présent" / "invité" / "absent excusé" / "absent non excusé" / "diffusion uniquement" / "inconnu".
- **company** : entreprise ou organisme cité avec un rôle sur ce chantier. Renseigner dans description : "Rôle chantier [— contact nommé]". Dans sourcePayload, renseigner **companyRole** (champ obligatoire) avec le rôle exact de l'entreprise. Une entreprise uniquement destinataire d'un document → "diffusion uniquement".

---

## Extraction des intervenants (cartouche et liste de présence)

Le cartouche du PV, la liste des signataires et la liste de présence contiennent souvent les intervenants clés du chantier.

**Règle de priorité** : le caractère générique ou méthodologique du reste du document ne suspend pas l'extraction des personnes et entreprises nommées lorsqu'elles apparaissent dans un cartouche identifiable (liste de présence, liste de membres, liste de signataires, liste des auteurs, liste d'approbation). L'extraction des familles **person** et **company** obéit à ses propres règles, indépendamment du contenu thématique du document — un guide professionnel, une note méthodologique ou un gabarit contenant une liste nommée de membres ou de signataires doit produire des propositions person/company exactement comme un CR de chantier classique.

Pour chaque **personne physique identifiable** (prénom + nom) mentionnée dans le cartouche, comme signataire ou dans la liste de présence :
- créer une proposition **person** ;
- label = "Prénom NOM" ;
- description = "Fonction — Entreprise [— email / téléphone]" selon disponibilité ;
- sourcePayload.statusAtDocumentDate = statut de présence (cf. section « Statut de présence — PREUVE-FIRST » ci-dessous) ;
- sourcePayload.linkedCompanyName = nom exact de l'entreprise à laquelle appartient cette personne, si identifiable dans le document (ex : "BatiSud") ;
- sourcePayload.emailAddress = adresse email de la personne si présente dans le document ;
- sourcePayload.phoneNumber = numéro de téléphone (mobile ou fixe) de la personne si présent dans le document.

Créer une **company distincte** pour l'entreprise de cette personne si elle n'a pas déjà de proposition company.

### Cartouche aplati — labels et valeurs séparés par l'extraction PDF

Certains PV utilisent un cartouche d'identité en tableau (Client / Interlocuteur / Etablissement /
Adresse / Type-Catégorie / RUS / Interlocuteur / Date de la visite / Type de visite / Dernière
visite) dont l'extraction texte du PDF sépare les LIBELLÉS (regroupés en bloc, généralement en tout
début de document, chacun suivi de « : » sans valeur sur la même ligne) des VALEURS correspondantes
(regroupées ailleurs dans le document, souvent en fin de texte juste avant les sections
« Documentaires »/« Organisationnelles »/« Techniques », ou près du titre du CR). Quand tu détectes
ce schéma (un bloc de libellés sans valeur adjacente), retrouve le bloc de valeurs et associe
CHAQUE libellé à sa valeur par la NATURE du contenu, jamais par la simple position dans la liste —
**l'ordre des valeurs n'est PAS garanti identique à l'ordre des libellés** :

- **Client** et **RUS** : noms d'entreprise/organisme (raison sociale courte, sigle ou nom de
  société — ex. « SACD (GBH) », « CAPSE NC »). Client et RUS sont deux entreprises DISTINCTES dans
  ce type de cartouche — ne jamais leur assigner la même valeur, et ne jamais permuter laquelle est
  Client et laquelle est RUS sans indice textuel direct.
- **Etablissement** : désignation du site/bâtiment (ex. « Centre commercial Dumbéa Mall »),
  généralement suivie d'une ligne d'adresse postale.
- **Interlocuteur (du Client)** et **Interlocuteur (du RUS)** : chacun un nom de personne au format
  « Prénom NOM », parfois deux personnes reliées par « & » ou « et ». Vérifie la cohérence avec
  toute mention « [Nom], RUS » ou « RUS : [Nom] » ailleurs dans le document avant de trancher lequel
  est l'interlocuteur du Client et lequel est l'interlocuteur du RUS (cf. section suivante, PREUVE
  DIRECTE).
- **Date de la visite** et **Dernière visite** : valeurs de type date (jj/mm/aaaa, éventuellement
  « jj et jj/mm/aaaa » pour une visite sur deux jours) — la date de la visite en cours est celle
  cohérente avec le titre/nom du document ou sa conclusion, la dernière visite est antérieure.

**Exemple vérifié (calibration, ne pas réutiliser pour un autre document)** — cartouche du
27/03/2025 : bloc de labels (Client / Interlocuteur / Etablissement / Adresse / Type-Catégorie /
RUS / Interlocuteur / Date de la visite / Type de visite / Dernière visite) puis, plus loin dans le
texte, un bloc de valeurs dans un ordre non strictement identique à celui des labels : « SSN
(Hyper) » (Client), « Charlie BELLANGER » (Interlocuteur Client), « Centre commercial Dumbéa Mall »
(Etablissement), l'adresse, « CAPSE NC » (RUS), « David BOUVIER & Catherine DELORME » (Interlocuteur
RUS), « 27 et 31/03/2025 » (Date de la visite), « 29/01/2025 » (Dernière visite). Ce cas illustre la
logique de pairage par nature de contenu, pas une valeur à réutiliser ailleurs.

**Filet de sécurité obligatoire** : si, après application de cette logique, tu ne peux pas
distinguer avec certitude laquelle des deux entreprises identifiées est le Client et laquelle est
le RUS (ou laquelle des deux personnes est l'interlocuteur de qui), NE TRANCHE PAS au hasard : crée
les propositions **company**/**person** avec les noms retrouvés, mais laisse companyRole ou la
fonction (description) sur une valeur générique non tranchée plutôt que d'assigner un rôle
RUS/Client précis à la mauvaise entité. Un rôle non assigné est récupérable ; un rôle inversé sur un
champ réglementaire (RUS) ne l'est pas.

### Fonction/rôle nommé (RUS, MOE, AMO, titulaire…) — PREUVE DIRECTE

**INVARIANT** : un rôle explicite (RUS, MOE, AMO, maître d'ouvrage, titulaire, coordonnateur SPS…) ne peut
apparaître dans la description ("Fonction") d'une personne que si la source relie **directement** ce
rôle à **cette identité précise** — même ligne de tableau, même bloc de signature, ou une formulation
explicite du type « [Nom], RUS » / « RUS : [Nom] ». Le nom, la présence au cartouche et la mention du
rôle **ailleurs** dans le document (dans une autre ligne, un autre paragraphe, une autre visite) ne
suffisent JAMAIS à attribuer ce rôle à cette personne.

- **Jamais par déduction de liste** : si un document nomme plusieurs interlocuteurs et mentionne un rôle
  une seule fois (ex. « RUS » cité une fois dans l'en-tête), n'attribue ce rôle qu'à la personne
  explicitement associée dans la structure du document — ne le duplique jamais sur plusieurs personnes
  au seul motif qu'elles apparaissent dans la même liste ou le même cartouche.
- **Jamais par récurrence inter-documents** : le rôle tenu par une personne dans un document antérieur
  ne se reporte pas automatiquement dans ce document si le lien n'y est pas explicite.
- **En cas de doute ou de lien non direct** : soit conserve une fonction plus générique réellement
  démontrée par le texte (ex. « Intervenant », « Représentant [Entreprise] »), soit laisse la fonction
  absente — ne force jamais un rôle non prouvé. La personne reste créée (nom + entreprise si connus) ;
  seule l'étiquette de rôle est omise.
- Ceci est indépendant du statut de présence : un rôle mal attribué n'est PAS un problème de présence
  (cf. section suivante, qui reste inchangée) — une personne peut avoir un rôle indéterminé tout en
  ayant un statut de présence "présent" prouvé par ailleurs, et inversement.

### Statut de présence — PREUVE-FIRST

Un compte-rendu qui affirme « Présent » engage la vérité du document. On ne fabrique donc JAMAIS une présence : statusAtDocumentDate se déduit d'une PREUVE documentaire explicite de participation à CE rendez-vous, jamais d'un rôle ou d'une mention.

**"présent" — UNIQUEMENT sur preuve explicite :**
- une case cochée (X, ✓, •) dans une colonne « Présent » d'un tableau d'intervenants / d'émargement (les PV français ont souvent des colonnes de statut du type « I P AE AN D » = Invité · Présent · Absent excusé · Absent non-excusé · Diffusion) ;
- OU une rubrique « Présents : … » / « Étaient présents : … » qui nomme la personne ;
- OU la mention explicite « présent(e) » à côté de son nom.

**Sinon → "inconnu". Ne jamais émettre "présent" pour :**
- un « Interlocuteur », « Contact », « Client », « Responsable … », « RUS », un rôle (MOE, AMO, maître d'ouvrage, titulaire, sous-traitant) ;
- une personne seulement nommée au cartouche / en-tête / liste de contacts ;
- une appartenance à une entreprise ou un simple e-mail/téléphone.
Ces éléments identifient la personne (on la crée en **person**), mais ne prouvent PAS sa présence.

**Autres statuts, sur preuve du même type :**
- case « Absent excusé » (AE) cochée, ou « excusé(e) » → "absent excusé" ;
- case « Absent non excusé » (AN) cochée, ou « absent » → "absent non excusé" ;
- case « Invité/Convoqué » (I) cochée SANS « Présent » → "invité" ;
- colonne/rubrique « Diffusion » (D), « Destinataire », « Pour diffusion » → "diffusion uniquement".

En cas de doute sur la colonne cochée ou d'ambiguïté → "inconnu". L'absence de preuve n'est jamais une présence.

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

### Ancrage documentaire obligatoire (company)

**INVARIANT** : aucune proposition **company** ne peut être créée à partir d'une connaissance générale
ou d'une inférence libre du modèle (ex. « ce type de chantier fait généralement intervenir tel
organisme de contrôle », ou compléter un nom d'entreprise partiel par un nom connu du monde réel). Le
nom retenu doit être **retrouvable explicitement dans le document** — soit littéralement, soit via une
normalisation sûre et non ambiguë (casse, apostrophe/accent, espace, sigle explicité une fois dans le
même document, ex. « UXELLO » = « Uxello »). N'applique **jamais** de rapprochement approximatif
(fuzzy matching) entre un nom source imparfait et un nom d'entreprise que le modèle « sait » exister —
si le texte source est tronqué, mal océrisé ou ambigu au point de ne pas identifier un nom précis, ne
crée pas de proposition company plutôt que de deviner. Ceci s'applique à **chaque** document
individuellement : ne réutilise jamais un nom d'entreprise vu dans un autre document ou une autre
visite pour compléter un nom incomplet de celui-ci.

**Preuve de rôle d'acteur obligatoire** : une chaîne de caractères retrouvée littéralement dans le
texte ne suffit PAS à elle seule à créer une proposition **company** — il faut en plus un contexte
explicite d'ACTEUR/ORGANISATION l'entourant dans le document : rôle nommé (Client, RUS, maître
d'ouvrage, entreprise titulaire, sous-traitant…), verbe d'action l'associant à une tâche (« … à
relancer », « réalisé par … », « rapport de … », « … à transmettre à … »), ou une mention explicite
« entreprise X » / « société X ». Un mot en majuscules isolé au milieu d'une phrase, sans aucun de
ces marqueurs de rôle, est très probablement un artefact d'OCR/extraction (mot mal reconnu, casse
erronée) et ne devient jamais une proposition company — même s'il ressemble à un sigle ou un nom
propre plausible. Ce filtre s'ajoute à l'exigence d'ancrage documentaire ci-dessus, il ne
l'assouplit pas : les entreprises réellement nommées avec un rôle explicite (ex. « MIES », «
UXELLO », « ARES ») restent extraites normalement.

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

## Rattachement des preuves — invariant obligatoire

**INVARIANT** : toute preuve (evidenceKey ou sourceExcerpt) attachée à une proposition doit, **prise
isolément**, **supporter directement cette proposition précise**. Ce n'est PAS un test lexical
(présence d'un mot commun) : c'est un test de support sémantique direct — un lecteur qui ne verrait
QUE cette preuve doit pouvoir reconnaître le sujet de la proposition.

- **Jamais par position** : ne rattache jamais une preuve à une proposition parce qu'elle occupe le
  même rang dans une liste numérotée ou un tableau — vérifie que le contenu de la preuve correspond
  réellement au sujet, pas seulement son emplacement.
- **Jamais hors-sujet** : une preuve qui ne mentionne ni le sujet ni son contexte immédiat n'est
  rattachée à aucune proposition — laisse-la orpheline plutôt que de forcer un lien.
- **Formule de clôture réutilisée** : une phrase récurrente de fin de visite ou de synthèse générale
  (ex. « Merci de traiter ces points rapidement », rappel de procédure standard) ne devient une
  evidenceKey d'une proposition précise que si son texte **cite explicitement le sujet** de cette
  proposition — sinon elle n'est preuve d'aucune proposition individuelle.
- **Citation complète et autonome** : un sourceExcerpt ou un text_excerpt doit rester compréhensible
  seul, sans troncature qui lui ferait perdre l'information qui justifie la proposition — préfère une
  citation légèrement plus longue mais complète à une coupure qui rend le sens ambigu. **Interdit** :
  un extrait qui commence ou se termine par un renvoi non résolu (« voir ci-dessus », « cf. supra »,
  « idem »), un connecteur orphelin (« + », « => », « et… »), ou un fragment coupé en milieu de phrase
  qui ne se comprend pas hors contexte. N'invente rien et ne paraphrase pas : si le passage source est
  elliptique, **étends la citation** aux mots qui précèdent ou suivent dans le document jusqu'à ce
  qu'elle soit compréhensible seule, plutôt que de citer le fragment tel quel.
- **Assertion atomique plutôt que paragraphe entier** : cite la ou les phrases qui portent
  spécifiquement le sujet de la proposition, pas un paragraphe entier englobant plusieurs sujets —
  un rattachement trop large dilue le support direct exigé par l'invariant ci-dessus.
- **Fragments de tableau** : lorsque tu cites une ligne de tableau, n'inclus pas les libellés de
  colonnes (« Thème : », « État : »…) dans le texte cité — cite le contenu de la cellule, pas son
  en-tête.
- **Une preuve peut soutenir plusieurs propositions** : ce n'est PAS interdit. Une même phrase peut
  légitimement contenir à la fois un constat et une action corrective, et donc être une evidenceKey
  valide pour une proposition \`observation\` ET une proposition \`action\` distinctes. La seule règle
  est celle de l'invariant ci-dessus : le rattachement multiple n'est permis que si la preuve, prise
  isolément, supporte réellement **chacune** des propositions auxquelles elle est liée — jamais par
  commodité ou parce que les deux propositions se trouvent au même endroit du document.
- **Provenance textuelle des familles decision / deadline / knowledge_fact** : lorsque le document
  contient un passage textuel qui motive ces propositions (et pas seulement une photo ou un
  page_snapshot), rattache au moins un **text_excerpt** en evidenceKey — la restriction du point
  « Traitement des pages photographiques » ne concerne que les preuves visuelles (page_snapshot),
  jamais les extraits de texte disponibles.

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
