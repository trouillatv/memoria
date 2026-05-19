# Étude — Document Lifecycle (pré-requis tranche 4 V6.3)

> **Statut : RATIFIÉ A–K (Vincent 2026-05-19).** 073 débloquée. Phase 1 =
> migration 073 additive + code, appliquée sur feu vert explicite
> (discipline 071/072). La bibliothèque documentaire devient un **pilier
> central** du produit (couche mémoire opérationnelle).
> Demandée par Vincent 2026-05-19 : « la structure doit être pensée avant
> migration ». Objectif : un document de contrat n'est pas un PDF stocké —
> il peut devenir preuve, mémoire, source AO, procédure, contexte IA,
> historique, continuité. Si on se trompe de structure, on a « encore un
> drive » ou on duplique le RAG existant.

## Principe directeur

**Le document n'est pas un fichier attaché à un contrat. C'est un nœud du
graphe mémoire opérationnelle, rattachable à plusieurs entités, indexé dans
le substrat sémantique qui existe déjà.** MemorIA n'a pas besoin d'un
nouveau RAG — il en a un (`knowledge_chunks`, embeddings 768-dim Google,
RPC multi-domaine, extraction PDF/OCR). Le document s'y **branche**, il ne
le recrée pas (doctrine V6 : « agrégation d'existant, pas création »).

## Discipline coût IA — contrainte transverse OPPOSABLE (Vincent 2026-05-19)

> Prisme de lecture de toute cette spec. Le risque coût/perf de MemorIA
> n'est ni l'embedding ni le MVP Guillaume — c'est le « LLM live partout »,
> les agents permanents, la relecture documentaire massive, les prompts non
> bornés. L'IA doit rester discrète, ciblée, async, capitalisante, faible
> coût, forte utilité. **Pas un SaaS « full agent ».**

Architecture cible **toujours** : `écriture/analyse async → stockage →
pré-calcul → lecture SQL rapide`. **Jamais** : `ouverture page → recalcul
IA / prompts live / embeddings live / relecture documents`.

Appliqué au document :

- **Analysé UNE fois** à l'upload (extraction → chunks → embeddings
  stockés). Jamais re-extrait/re-embeddé à l'affichage ni au recall.
- **Recall borné** : une question agent → retrieval ciblé (k chunks
  pertinents via `find_similar_knowledge_chunks`) → réponse. **Interdit** :
  injecter un PDF entier, toute une collection, toute la biblio dans un
  prompt ; agents copilotes permanents ; « 7 agents × 20 docs × 10k tokens ».
- **Context budget explicite** : tout prompt agent a un plafond de chunks +
  tokens borné et mesuré (cf. décision I).
- La visionneuse « relire » (F) sert le **fichier stocké** (URL signée), pas
  une relecture/ré-analyse IA.

Cette section est opposable au même titre que les garde-fous doctrine :
une phase qui réintroduit du LLM-live non borné ne ship pas.

## Substrat réutilisable (NE PAS recréer)

| Brique existante | Fichier / migration | Réutilisation document |
|---|---|---|
| Stockage privé + RLS + upload service-role | `010_buckets.sql` | nouveau bucket `documents` (même pattern) |
| Table doc + texte extrait (modèle) | `tender_documents` (005) | `tender_documents` = cas particulier ; le générique s'en inspire |
| **Substrat RAG** : `knowledge_chunks(tenant_id, source_domain, source_type, source_id, chunk_index, chunk_text, embedding 768, metadata)` | `060_knowledge_chunks.sql` | **les chunks de documents y vont** (`source_domain='document'`) |
| RPC recherche multi-domaine | `find_similar_knowledge_chunks()` | réutilisée telle quelle |
| Pipeline embeddings (Google text-embedding-004, 768) | `lib/ai/embeddings.ts` | tel quel |
| Chunking + embed fire-and-forget | `lib/ai/embed-knowledge-chunks.ts` | copier → `embedDocumentChunks()` |
| Extraction PDF natif + OCR Gemini | `services/pdf/extract.ts` | tel quel |
| Injection contexte agents | `services/ai/library-context.ts` | pattern → `buildDocumentContext()` |
| Threading tenant | `sites.tenant_id`, `knowledge_chunks.tenant_id` | nouvelles tables portent `tenant_id` dès J1 |

**Vrais manques** : table document générique + liens polymorphes +
collections + typologie + visionneuse source (« relire ») + états de cycle
de vie. Aucun manque côté RAG/embeddings/extraction.

---

## Décisions à trancher AVANT migration 073

### A. Document générique polymorphe, pas `contract_documents`

Un seul `documents` + table de liens `document_links(document_id,
target_type, target_id)`. `target_type ∈ {contract, site, tender, client,
intervention, team, tenant}`. Un même document (ex. plan d'accès) se
rattache à un **site ET** un **contrat**. `tender_documents` reste en place
(legacy, pipeline AO branché) ; backfill éventuel plus tard, hors scope.

*Alternative écartée* : `contract_documents` seul → recrée le drive
par-entité (anti-pattern explicitement refusé). Coût assumé : le générique
est une plus grosse migration qu'une table contrat-only, mais c'est le
choix qui évite le « drive » et sert toute la suite produit.

### B. Typologie documentaire (enum + tags)

`document_type` enum : `contrat, avenant, procedure, protocole, plan_acces,
securite, ao, memoire_technique, reference, litige, facture, preuve,
autre`. Plus `tags text[]` libre. La typologie **pilote le filtrage de
recall agent** (un agent conformité cherche dans `procedure|protocole|
securite`, pas dans `facture`). Sans typologie : RAG indifférencié, bruit.

### C. Collections / dossiers — OBLIGATOIRE

`document_collections(id, tenant_id, name, scope_type, scope_id)` +
`documents.collection_id` **NOT NULL — collection OBLIGATOIRE à l'upload**
(arbitrage Vincent : sinon les gens dumpent tout → bibliothèque morte). 1
collection/doc pour démarrer ; M2M si besoin avéré plus tard. Une collection
« Non classés » par défaut est acceptable mais le choix reste explicite à
l'upload. Doctrine : organisationnel — **aucun score, aucun classement**.

### D. Cycle de vie (le « vivant », pas le « drive »)

`status ∈ {active, superseded, expired, archived}` ;
`supersedes_document_id` (un avenant remplace l'original, lien explicite) ;
`effective_date`, `expires_date`. L'expiration **dérive un fait** (réutilise
le déterminisme de `computeContractExpiry` : factuel, jamais rouge, jamais
« risque »). Un document n'est jamais supprimé dur (`deleted_at`).

### E. Pipeline IA documentaire — 100 % réutilisé

```
upload (Server Action, service-role)
  → bucket privé `documents`
  → services/pdf/extract.ts  (natif ; OCR Gemini si scanné)
  → documents.extracted_text + extraction_source
  → embedDocumentChunks(documentId)  [copie de embed-knowledge-chunks.ts]
      → chunking phrases (50–900 char)
      → embeddings 768 (lib/ai/embeddings.ts)
      → upsert knowledge_chunks
         source_domain='document', source_type='document',
         source_id=documentId,
         metadata={ document_type, collection_id, links[], page, section }
  → recherche via find_similar_knowledge_chunks() (RPC existante)
  → injection agents via buildDocumentContext()
```

Zéro nouvelle infra RAG. `knowledge_chunks.source_domain` : étendre l'enum
(+`'document'`) — seule modification du substrat existant.

### F. Relire la source — OBLIGATOIRE

Chaque chunk / citation / fait mémoire / réponse agent porte déjà
`source_id`. On ajoute la **brique manquante** : route lecture seule
`/documents/[id]` (URL signée vers le fichier stocké + saut page/section
depuis `metadata`). Ouvrable depuis : AO, chunk, mémoire contrat, réponse
agent, dossier de preuve. Aujourd'hui `source_ref` est metadata sans UI —
c'est *le* trou de confiance que Vincent pointe.

### G. Garde-fous doctrine (gravés dans la spec)

- **Jamais sujet-personne** : un document n'est pas indexé *par personne*,
  pas de route `/documents?agent=`. Un litige nommant un agent reste un
  artefact de contrat/litige, pas une fiche agent (cohérent V6.2/V6.8).
- **Accès par `visibility_level`, jamais admin-only rigide** (nuance Vincent
  2026-05-19) : interdire « les documents nommant des personnes » est
  impossible (litiges, contrats, courriers en contiennent). Le garde-fou
  n'est PAS l'absence, c'est **accès gradué + audit + non-indexation
  personne-centric**. Voir décision **J** (`visibility_level`).
- **Audit OBLIGATOIRE, sans exception** : toute ouverture/téléchargement
  → `logAuditEvent('document', 'opened'|'downloaded')`. L'audit — pas
  l'absence — est la dissuasion (cohérent verrou V6.7 #audit).
- **Embeddings = détection sémantique, jamais génération** (V5.1.4). Pas de
  résumé LLM du document affiché comme vérité.
- **Aucun score documentaire** : pas de « complétude dossier 78 % », pas de
  « contrat à risque car doc manquant ». Faits : « 3 documents, dernier
  avenant le 12/03 » (V6.4).
- **Multi-tenant dès J1** sur les nouvelles tables (`tenant_id`), même si le
  pilote est mono-tenant.

### H. V6.3 tranche 4 redéfinie

« Documents contrat » **n'est plus** un upload contrat-only. C'est : le
contrat = un `target_type` du système documentaire générique. La section
Documents de la page contrat devient un **consommateur mince** (liste les
documents dont un `document_links` pointe le contrat). Cela répond
exactement au refus Vincent du « simple upload / encore un drive ».

### I. Document analysé une fois + context budget borné (discipline coût IA)

Conséquence directe de la *Discipline coût IA*. À cadrer dès la structure,
pas après :

- **`analysis_status` — états explicites** (Vincent : sinon debug
  impossible, UX confuse, pipeline opaque) :
  `pending → ocr? → extracting → chunking → ready | failed`
  (+ `failed_reason text`). `ocr` n'est traversé que si PDF scanné. Lu en
  SQL ; **jamais** de ré-analyse déclenchée par l'affichage.
- **Relance analyse = bouton « Réanalyser » explicite** (OBLIGATOIRE),
  admin, idempotent, tracé (audit). Jamais automatique au render.
- **`chunk metadata` riche dès l'indexation** (`document_type`,
  `collection_id`, `links[]`, `page`, `section`, `effective_date`,
  `visibility_level`) — permet le retrieval **filtré donc borné** (et le
  filtrage d'accès au recall, cf. J).
- **Chunk explorer** : structure prévue dès J1 (pas d'UI complète
  maintenant) — un document expose `n chunks / n embeddings / n liens
  mémoire`. Vue admin lecture seule, SELECT pur, zéro IA.
- **Preview** = rendu du fichier stocké (URL signée), jamais une
  re-extraction.
- **Context budget agent** : constantes opposables (`MAX_RETRIEVED_CHUNKS`,
  `MAX_CONTEXT_TOKENS`) + test garde-fou qui échoue si un builder de prompt
  agent peut injecter un document entier ou une collection complète.

### J. Visibility level (nuance G — accès gradué, pas admin-only rigide)

Arbitrage Vincent 2026-05-19 : certaines procédures/documents sont utiles
**terrain**. Un `admin/manager only` absolu est trop rigide à long terme.

`documents.visibility_level` enum :
`admin_only | manager | operations | field | client_portal`.

- L'accès (visionneuse F, recall agent, listings) filtre sur
  `visibility_level` croisé au rôle de l'appelant (RLS + filtre applicatif).
- `visibility_level` est **propagé dans le chunk metadata** → un agent ne
  peut pas restituer en recall un extrait au-dessus du niveau de
  l'appelant (le garde-fou vaut aussi côté RAG, pas seulement UI).
- **Audit obligatoire à tout niveau** (J ne relâche pas l'audit de G).
- Doctrine : `visibility_level` est une propriété **du document**, jamais
  une donnée sur la personne ; ne crée aucune surface sujet-personne.

### K. Bulk import + déduplication (roadmap explicite, non implémenté J1)

- **Bulk import** : prévu explicitement (sinon migration des archives
  existantes impossible). Structure compatible dès J1 (upload unitaire ET
  lot ; même pipeline async, même `analysis_status`). UI/commande = phase
  ultérieure, mais le modèle ne doit pas l'empêcher.
- **Déduplication** : un `content_hash` (sha256 du binaire) sur `documents`
  dès J1 (colonne, pas de logique) pour rendre la dédup possible plus tard
  (« même PDF uploadé 4 fois »). Détection/merge = roadmap.

---

## Phasage proposé (073 minimale et sûre)

| Phase | Contenu | Migration |
|---|---|---|
| **0** | Cette étude — **ratifiée A–K** (2026-05-19) ✅ | aucune |
| **1** | `documents`, `document_links`, `document_collections`, bucket `documents`, RLS rôle, enum `source_domain += 'document'` | **073** (additive, gatée) |
| **2** | `lib/db/documents.ts` + upload Server Action + extract + `embedDocumentChunks` (réutilise extract.ts + copie embed-knowledge-chunks) | aucune |
| **3** | Visionneuse `/documents/[id]` (URL signée, audit) + liens « ouvrir la source » depuis AO/engagement/mémoire/agent/preuve | aucune |
| **4** | `buildDocumentContext()` (injection agents) + collections UI + section Documents page contrat (consommateur mince) | aucune |

A–K **ratifiées 2026-05-19** → 073 débloquée. Discipline 071/072
maintenue : migration écrite + commitée **avec** son code, **appliquée en
base sur feu vert explicite** (jamais par moi unilatéralement).

## Roadmap différée — explicite (ne pas implémenter maintenant)

**Observabilité coût IA** : coût par tenant / par feature / OCR / voice /
Atelier ; tokens ; embeddings générés ; documents analysés. Décision
Vincent 2026-05-19 : **pas maintenant** si ça ralentit, mais gardé
explicitement sur la roadmap. Le MVP Guillaume reste peu coûteux
(embeddings faibles, OCR rare, voice rentable, Atelier ponctuel) ; ce
chantier devient prioritaire quand le multi-tenant ou l'usage Atelier
montent. À cadrer comme une feature `ai_usage`-centric (la table existe
déjà : `008_ai_usage.sql`).

## Pourquoi cette structure (synthèse)

Elle transforme « stockage de fichiers contrat » en **architecture
documentaire vivante** : un document est saisi une fois, rattaché à
plusieurs entités, indexé dans la mémoire sémantique existante, citable et
**ré-ouvrable** depuis n'importe quel point du produit, soumis au cycle de
vie (avenant/expiration), sans jamais devenir un drive mort ni un vecteur
de surveillance. Le coût (générique vs contrat-only) est payé une fois et
sert tout le produit — cohérent avec la trajectoire « système de mémoire
opérationnelle structuré », pas « empilement de features ».
