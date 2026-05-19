# Plan — Le document comme SOURCE MÉMOIRE (pas seulement contexte de prompt)

> **Statut : PLAN. Aucun code.** Validation terrain Guillaume → on sort du
> MVP « bibliothèque consultable ». Le document devient une source mémoire
> au même titre qu'anomalie / note terrain / consigne site / voice note /
> AO / preuve. Câblage progressif et explicite, **discipline coût IA
> intacte**. Code seulement après validation Vincent.

## Contraintes non négociables (prisme de tout le plan)

Un document peut **alimenter** la mémoire, jamais devenir une **vérité
automatique**. Toujours : lien source conservé · document ré-ouvrable
(`/documents/[id]`) · `visibility_level` respecté **au recall** · recall
**borné** (jamais dump, jamais relecture live, context budget) · **aucun
scoring document** · **aucune fiche personne** depuis un document · pas de
lecture IA sans source vérifiable · **pas de recalcul IA au render**
(pré-calcul async, pattern `site_reading_candidates`).

## 1. Ce qui est DÉJÀ câblé

- Document → `knowledge_chunks` `source_domain='document'` (phase 2,
  `embedDocumentChunks`, métadonnée `visibility_level`/links).
- Document → **Atelier chat** : `buildDocumentContext` borné + filtre
  visibilité + context budget (phase 4b), **uniquement** dans
  `sendChatMessageAction`.
- Document **ré-ouvrable** : visionneuse `/documents/[id]` + download
  audités (phase 3).
- Document **visible comme source** : section « Documents » page **contrat**
  (4a, `listDocumentsForTarget('contract', id)`).
- `document_links` polymorphe (contract|site|tender|client|intervention|
  team|tenant) en place (073).

## 2. Ce qui MANQUE

- Atelier chat : les prompts agents **n'exploitent ni ne citent** les
  extraits `[doc:id]` injectés (injectés mais non instruits).
- **Analyse AO initiale** (`orchestrator`→`initial-analysis`) : **aucun**
  recall documentaire (seul `libraryContext` injecté).
- `matchAoToKnowledge` : `p_source_domains=['library','tender_history']` —
  **pas `'document'`**.
- Page **site** : pas de section Documents liés (contrairement au contrat).
- `getContractMemory` : n'intègre pas les documents liés (faits templatés).
- **Résonances / persistances** : tournent sur **`trace_embeddings`**
  (RPC `find_similar_to_source`, intra-store). Documents dans
  **`knowledge_chunks`** (RPC `find_similar_knowledge_chunks`). **Stores et
  RPC différents → AUCUN pont.** C'est le vrai chantier d'étude.
- Rapports / preuves : documents liés intervention non surfacés (exige
  `visibility_level` + validation, jamais auto-client).
- **Mémoire des agents IA** (`agent_analyses` / `upsertAgentAnalysis`) :
  les analyses persistées des agents ne tracent pas les sources
  documentaires qui les ont soutenues, et n'ont pas de recall documentaire.

## Note doctrine — « mémoire des agents » : deux lectures, une seule licite

Terme ambigu, à trancher avant tout code :

- ✅ **Lecture 1 — mémoire des AGENTS IA** (lecteur_ao, mémoire_technique,
  contradicteur… ; table `agent_analyses`). Légitime : un agent IA peut
  *se souvenir* de ses analyses et des **sources documentaires** qui les
  soutenaient (liens `[doc:id]` ré-ouvrables). C'est ce que ce plan
  intègre (A6 / B5).
- ❌ **Lecture 2 — mémoire SUR les agents (intervenants/personnes)** :
  « ce que connaît Joseph », historique d'un agent terrain. **Interdit
  structurel V6.2/V6.8** — un document ne crée jamais une fiche personne.
  Les verrous `v67-brief-reprise` / `forbidden-symbols` font échouer le
  build si on s'en approche. Aucune dérive possible via les documents.

La suite suppose la **Lecture 1**. Si l'intention était la Lecture 2 :
réponse = `V6.2`, rien à câbler.

## 3. Quick wins immédiats — NIVEAU A (bornés, faible risque, réutilise l'existant)

| # | Action | Coût archi |
|---|---|---|
| **A1** | Prompts chat agents : instruction explicite « exploite/cite les `[doc:id]` fournis ; n'affirme rien que le doc ne soutient pas ; source ré-ouvrable `/documents/<id>` » | retouche prompts, zéro archi |
| **A2** | `matchAoToKnowledge` : `p_source_domains += 'document'` (ou renommer `matchAoToEnterpriseKnowledge`). Même RPC, même `p_limit` borné | ~1 ligne |
| **A3** | Analyse AO initiale : `orchestrator` calcule `buildDocumentContext` (sur texte AO, borné, **1× par analyse**) → passe `documentContext?` aux agents `initial-analysis` (miroir du chat, même discipline) | moyen, borné |
| **A4** | Page **site** : section « Documents » liés = copie mince de la section contrat 4a (`listDocumentsForTarget('site', id)`) + lien visionneuse | UI mince, 0 IA |
| **A5** | `getContractMemory` : +1 fait **templaté** « N documents rattachés (types…) » — déterministe, 0 LLM | trivial, 0 IA |
| **A6** | **Mémoire agent IA (Lecture 1)** : persister dans `agent_analyses` les **sources `[doc:id]`** utilisées par l'agent (déjà recallées en A3) → l'agent « se souvient » de ses appuis documentaires, ré-ouvrables. Pas de nouveau recall | mince, 0 IA en plus |

## 4. Points dangereux

- **Cross-store résonances** (`knowledge_chunks` ≠ `trace_embeddings`) :
  tentation d'un gros pont live → coût IA + bruit. **Ne pas bricoler.**
- **Sur-interprétation** : un chunk doc ≠ vérité ; risque de « lecture »
  fabriquée non soutenue par le terrain.
- **Bruit mémoire** : tout document devenant une lecture visible → pollution.
- **Client-facing** (preuves/rapports) : exposer un doc sans
  `visibility_level`/validation = fuite.
- **Explosion coût IA** : multiplier les recall (initial-analysis × agents,
  résonances au render) sans centralisation/borne.

## 5. Ordre de build recommandé

**Niveau A (après validation, dans l'ordre)** : A1 → A2 → A4 → A5 → A3 → A6.
(trivial/sûr d'abord ; A3 = embedding+RPC borné 1×/analyse ; A6 juste après
A3 car réutilise ses sources, 0 IA en plus.)

**Niveau B — ÉTUDE avant tout code** :
- **B1** modèle de pont documents ↔ résonances (cross-store). Options à
  trancher : (a) dupliquer les chunks doc *à lien fort* dans
  `trace_embeddings` rattachés à site/contrat ; (b) nouvelle RPC
  cross-domain bornée ; (c) lectures dérivées **déterministes** lien-fort
  uniquement (pas de similarité libre). Recommandation provisoire : (c)
  d'abord (le moins coûteux/bruyant), (a) si besoin avéré.
- **B2** règles de seuil / anti-bruit (lien entité clair + source explicite
  + signal terrain réel relié + seuil de confiance + lecture courte
  vérifiable).
- **B3** lectures site/contrat documentaires (pré-calculées async, pattern
  `site_reading_candidates` — jamais au render).
- **B4** preuves/rapports : annexe/source consultable, jamais auto-client
  sans `visibility_level`+validation.
- **B5** mémoire agent IA accumulée (Lecture 1, au-delà de A6) : un agent
  qui *capitalise* ses appuis documentaires entre analyses → étude
  anti-bruit + coût (pas de ré-injection croissante non bornée ; reste
  recall borné par requête, pas un historique gonflant le prompt).

## 6. Tests / garde-fous nécessaires

- A2/A3 : recall reste borné — réutiliser `MAX_RETRIEVED_CHUNKS`/budget ;
  tripwire « tout recall doc passe par `buildDocumentContext` centralisé,
  jamais un doc entier injecté » étendu aux nouveaux points.
- A1 : le prompt contient l'instruction « ne pas affirmer sans `[doc:id]` »
  (tripwire structurel sur les fichiers prompt).
- Doctrine (étendre les suites existantes) : aucun scoring doc ;
  `visibility_level` filtré au recall sur **tous** les points (pas que chat) ;
  document jamais une fiche personne ; pas de recalcul au render.
- B : test « une lecture documentaire exige lien entité + source + signal
  terrain + seuil » (à la construction de B3).

## 7. Impact coût IA

| Étape | Coût |
|---|---|
| A1 | **nul** (texte de prompt) |
| A2 | **~nul** (même RPC/`p_limit`, +1 domaine, requête déjà faite) |
| A3 | +1 embedding + 1 RPC **par analyse AO initiale**, calculé **1× dans l'orchestrator** (pas par agent) — borné, comparable au chat |
| A4 / A5 | **0 IA** (SQL pur / fait templaté) |
| **B (résonances)** | **risque principal** — tout pont DOIT être **pré-calculé async** (jamais render), borné, lien-fort. C'est là que la discipline coût IA est décisive → étude obligatoire avant code |

## Sortie / next

Niveau A = câblage rapide qui rend `/documents` réellement utile sans
risque archi. Niveau B = mémoire documentaire relationnelle, **étude
avant code**. **Aucune ligne de code tant que ce plan n'est pas validé**
(et B reste gaté même après validation de A).
