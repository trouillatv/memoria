# Étude Niveau B — mémoire documentaire relationnelle (B0)

> **Statut : ÉTUDE. ZÉRO code.** Rapport structuré et critique demandé
> par Vincent 2026-05-20. Aucune ligne de code, aucune migration, aucune
> implémentation. Décisions à ratifier en fin de document avant ouverture
> de B1.

## 1. Architecture actuelle (état des lieux précis)

### 1.1 Deux stores d'embeddings parallèles (même dim 768, mais étanches)

| Store | Migration | Périmètre | RPC d'accès |
|---|---|---|---|
| `trace_embeddings` | 052 → 053 (768 Google) | **site-scopé** : `source_type ∈ {site_note, anomaly, photo_caption, …}`, indexé par `site_id` | `find_similar_to_source(source_id, target_type, limit)` (intra-store, par source) ; `find_similar_traces_for_tenant(tenant_id, embedding, types, limit, threshold)` (tenant-wide cross-source dans trace_embeddings) |
| `knowledge_chunks` | 060 | **tenant-scopé** : `source_domain ∈ {library, tender_history, document}`, `source_type`, `source_id` | `find_similar_knowledge_chunks(tenant_id, embedding, domains, limit, threshold)` (cosine, multi-domaine) |

**Limite n°1 — non-interopérables au niveau RPC.** Les deux stores sont
**768-dim, même modèle** (text-embedding-004) donc les vecteurs *sont*
comparables ; mais **aucune RPC ne ponte les deux** (find_similar_to_source
ne lit que trace_embeddings ; find_similar_knowledge_chunks ne lit que
knowledge_chunks). « Documents → site memory » est donc, aujourd'hui,
*structurellement impossible sans nouveau code*.

### 1.2 Couche pré-calculée (le pattern que B doit reproduire)

`site_reading_candidates` (055) — **modèle de référence** :
`tenant_id, site_id, reading_type ('resonance'|'persistence'), fragment,
source_ids jsonb, status, generated_at, expires_at, algorithm_version,
internal_score`. Alimenté par `lib/ai/refresh-site-readings.ts` (async,
event-driven), consommé en **SELECT pur** au render (zéro IA au load).
**C'est exactement le bon pattern à appliquer à B**.

### 1.3 Couche référentielle

| Table | Migration | Rôle |
|---|---|---|
| `document_links` | 073 | rattachement **polymorphe** doc → entité (contract\|site\|tender\|client\|intervention\|team\|tenant). Référence seule, pas de signal dérivé. |
| `tender_analyses.document_sources` | 074 (A6) | post-hoc : quels docs ont *soutenu* une analyse AO (réf seules, ré-ouvrables). |

**Limite n°2 — referential only.** `document_links` dit *un document est
rattaché*, jamais *ce que ça produit comme lecture*. `tender_analyses.
document_sources` trace un appui, mais ne réinjecte rien dans la mémoire
site/contrat.

### 1.4 Mémoire contrat et site — état post-V6.3 / Niveau A

- **Contrat** : `getContractMemory` (V6.3) = faits **templatés
  déterministes** (continuité, prestations documentées, échéance) + A5
  fait documentaire factuel. Pas d'IA générative. Pas de cross-store.
- **Site** : `getSiteReadings` + `site_reading_candidates` (pré-calculé,
  trace_embeddings only) + A4 liste docs liés (référence). Pas de pont
  doc↔trace.

### 1.5 Synthèse des limites

1. Pas de pont RPC cross-store.
2. `document_links` ne produit pas de lecture (référence seule).
3. `site_reading_candidates` n'observe que trace_embeddings — aveugle aux
   chunks documentaires.
4. Aucun équivalent pré-calculé pour le contrat (mémoire = templates
   factuels seulement).
5. Agents IA ne capitalisent pas leurs appuis documentaires d'une analyse
   à l'autre (A6 stocke single-shot dans tender_analyses, pas accumulé).

---

## 2. Le problème central

Faire **dialoguer cinq couches de mémoire** — terrain, documents, AO,
contrats, sites — **sans** :

- recall live coûteux (interdit par la discipline coût IA) ;
- lectures fabriquées (interdit V5.1.4 « IA révèle, jamais génère ») ;
- score documentaire (interdit V6.4) ;
- fiche personne (interdit V6.2/V6.8).

**Le verrou architectural** : deux stores d'embeddings étanches doivent
produire des lectures conjointes **pré-calculées**, citables (`[doc:id]`,
`[trace:id]`), bornées, expirables, validables, sans cross-product live.

---

## 3. Règles doctrine binding pour Niveau B

Confirmées et liées aux verrous existants :

1. **Pas de lecture sans source vérifiable** — chaque lecture visible cite
   ≥ 1 `[doc:id]` + ≥ 1 `[trace:id]`/`[engagement:id]`, **ré-ouvrable**.
2. **Pas de document = vérité automatique** — une lecture est un *signal
   à présenter*, pas une affirmation IA. Validable / dismissable.
3. **Pas de scoring documentaire** — V6.4. Aucun « tension », « risque »,
   « complétude % ». L'`internal_score` (cosine) reste **interne**, jamais
   exposé.
4. **Pas de fiche personne** — V6.2/V6.8. Verrou `v67-brief-reprise`
   continue de mordre. Documents nominatifs : déterministe-anonymisé ou
   skip (seuil k=4 V6.7 étendu si nécessaire).
5. **Visibility_level respecté DEUX fois** — au pré-calcul (n'indexer un
   candidat qu'à hauteur du niveau le plus bas de l'utilisateur cible) ET
   au render (canViewDocument). Défense en profondeur.
6. **Pas de recalcul au render** — discipline coût IA opposable.
   Pré-calcul async OBLIGATOIRE pour toute lecture visible.
7. **Pas d'IA générative dans la production de lectures** —
   embeddings/similarité OK ; LLM générateur INTERDIT.
8. **Lecture courte et factuelle, ignorable sans friction** (V6.4, V5.1.4).
9. **Plafond par surface** — anti-bruit : ex. ≤ 3 lectures/site, ≤ 2/contrat,
   dédup par paire de sources.
10. **Pas de notification client / pas d'auto-exposition** — V6.6 + spec
    doc-lifecycle G/J. Tout passage en client_portal exige validation.

---

## 4. Scénarios cibles (mis à l'épreuve du modèle)

| # | Scénario | Stores impliqués | Faisable ? Comment |
|---|---|---|---|
| 1 | Procédure « pas d'eau de javel » ↔ note terrain « eau de javel » | doc chunk ↔ trace_embeddings (site_note) | **OUI** — paire pré-calculée pour les sites où le document est rattaché (`document_links target=site`). Lecture : « Procédure rattachée mentionne « pas d'eau de javel » — note terrain du JJ/MM cite ce produit (sources : [doc:X], [trace:Y]). » Validable, expire à 30j. |
| 2 | Plan d'accès ↔ incident d'accès | doc chunk (`document_type=plan_acces`) ↔ `intervention_access_events`/anomaly | **OUI** — même modèle, scopé site. |
| 3 | Contrat fréquence ↔ absence d'exécution prolongée | `contracts.frequence`, `volume_horaire_mensuel` + prestations documentées | **Déjà partiellement couvert** par `getContractMemory` (V6.3/A5) — fait templaté déterministe. B peut enrichir avec un fait dérivé « N jours sans prestation documentée vs fréquence hebdo annoncée ». Aucun embedding requis. |
| 4 | Protocole hospitalier ↔ AO bionettoyage | doc chunk ↔ tender text | **Déjà couvert** A2 (`matchAoToKnowledge += 'document'`) + A3 (recall AO initiale). Rien à ajouter en B. |
| 5 | Mémoire technique antérieure ↔ nouvel AO | knowledge_chunks `domain=tender_history` ↔ AO | **Déjà couvert** : matchAoToKnowledge (préexistant). |

**Constat** : sur les 5 scénarios, **3 sont déjà couverts ou triviaux à
enrichir sans cross-store**. Les **2 vrais besoins** Niveau B sont 1 et 2
(doc ↔ trace site), qui exigent un pont.

---

## 5. Ce qu'il ne faut PAS faire (anti-patterns gravés)

1. **Cross-product live tous chunks × toutes traces** — explosion coût IA.
2. **Résumés LLM auto visibles sans validation** — V5.1.4.
3. **Une lecture par document** — bruit, pollution mémoire.
4. **Relier des personnes nommées** — V6.2/V6.8.
5. **« Document AI feed » continu** — coût + bruit.
6. **Re-embed massif périodique** — embeddings persistés une fois (déjà
   discipline coût IA).
7. **Dupliquer les chunks documentaires dans `trace_embeddings`** —
   approche γ ci-dessous, **rejetée** : duplication, sync churn,
   sémantique mélangée, visibilité difficile à maintenir.
8. **Notifications client auto** — toute exposition extérieure passe par
   validation humaine.
9. **Cron qui régénère tout** — préférer event-driven idempotent.
10. **Exposer `internal_score`** — interne, jamais en UI (V6.4).

---

## 6. Proposition de modèle (trois approches comparées)

### 6.1 Approche α — lectures dérivées déterministes lien-fort (zéro cross-store similarité)

**Idée** : un document rattaché à un site (`document_links`) **+** un
signal terrain factuellement relié (keyword/regex extrait du document
chunk présent dans une trace récente) → candidat de lecture. Aucune
similarité vectorielle cross-store ; uniquement présence du lien + match
factuel borné (extraction de termes-clés déterministe à l'indexation
chunk).

| ✅ | ❌ |
|---|---|
| Zéro IA additionnelle (réutilise embeddings existants seulement pour leur usage actuel) | Limité au matching factuel/keyword — manque les correspondances latentes/sémantiques |
| Coût quasi nul | Risque de faux négatifs (« eau de Javel » ≠ « javel » sans synonymes) |
| Déterministe → testable, ré-jouable | Maintenance d'une liste de termes-clés |
| Sécurité simple (lien-fort = bornage naturel) | Couverture partielle scénarios 1/2 |

### 6.2 Approche β — pont cross-store via similarité pré-calculée bornée

**Idée** : nouvelle table `cross_store_resonances(tenant_id, scope_type,
scope_id, doc_source_id, trace_source_ids jsonb, fragment templated,
internal_score, status, generated_at, expires_at, algorithm_version,
min_visibility_level)`. Job async **événementiel** (jamais cron massif) :

- Trigger A : `documents.analysis_status='ready'` → pour chaque entité
  rattachée (`document_links`), comparer les chunks de ce doc aux trace
  embeddings *scopés à cette entité* (filtre amont par `site_id` /
  `mission_id` via `document_links`). Plafond strict (ex. top-K chunks ×
  top-N traces par entité, ≥ seuil cosine).
- Trigger B : nouvelle trace_embedding pour un site → back-fill : pour
  chaque doc lié au site, comparer aux traces récentes.
- Idempotent (clé `(doc_source_id, trace_source_id, scope_id)`),
  `expires_at` 30j (re-validation), `status` pending/ready/failed.
- **Filtrage amont par `document_links`** → c'est ce qui rend la
  combinatoire bornée : on ne fait *jamais* docs × traces tenant-wide,
  seulement (docs liés à E) × (traces de E).

| ✅ | ❌ |
|---|---|
| Couvre les corrélations sémantiques (synonymes, paraphrases) | Migration + table + job — vraie tranche |
| Pré-calculé → SELECT pur au render (discipline coût IA) | Bug d'orchestration possible (idempotence, errors) |
| Bornage **structurel** par `document_links` (jamais global) | Pertinence à mesurer (seuil empirique, anti-bruit) |
| Réutilise les deux stores existants tels quels | `internal_score` doit rester strictement interne |

### 6.3 Approche γ — dupliquer les chunks documentaires dans trace_embeddings

**Rejetée d'emblée.** Duplication des données, churn de sync,
visibilité difficile à propager, sémantique muddy. Le manque de RPC
cross-store ne se résout pas par duplication. Documenté comme anti-pattern.

### 6.4 Recommandation : α d'abord (B1), β si nécessaire (B2)

α est cheap, déterministe, **testable hors flake Cloud**, et règle déjà
le scénario 2 (plan d'accès ↔ incident — termes-clés stables). On
**mesure le bruit et la couverture** sur 1-2 scénarios, puis on décide
si β est nécessaire pour combler les latences sémantiques (scénario 1
plus subtil). Ne pas faire β si α suffit.

### 6.5 Tables / jobs / seuils / refresh / expiration / statut / sources / UI / coûts

#### Tables (option β si retenue)

```
cross_store_resonances (
  id uuid pk,
  tenant_id uuid,
  scope_type text check ('site' | 'contract'),
  scope_id uuid,
  doc_source_id uuid,         -- documents.id
  trace_source_ids jsonb,     -- [{type, id}] traces appuyantes
  fragment text,              -- texte court templaté (déterministe)
  algorithm_version text,
  internal_score numeric,     -- INTERNE, jamais exposé UI
  min_visibility_level text,  -- niveau le plus bas autorisé
  status text check ('pending'|'ready'|'failed'|'dismissed'),
  generated_at timestamptz,
  expires_at timestamptz,
  dismissed_by uuid null,
  unique (scope_type, scope_id, doc_source_id, trace_source_ids → hash)
)
```

Index : `(scope_type, scope_id, status, expires_at)` pour SELECT pur au
render ; `(doc_source_id)` pour back-fill / invalidation.

#### Jobs (event-driven, jamais cron massif)

- `onDocumentAnalysisReady(documentId)` → enqueue computation pour chaque
  scope rattaché.
- `onTraceEmbeddingInserted(traceId, siteId)` → enqueue back-fill (docs
  liés à siteId).
- `dismissResonance(id)` → idempotent, audité.
- `refresh expirés` → re-calcul borné (event-driven via expires_at, pas
  un balayage périodique).

#### Seuils — JAMAIS figés comme valeur doctrinale (raffinement Vincent 2026-05-20)

> Un seuil cosine n'est **pas** un fait gravé. Il dépend du type de
> chunk, de la longueur, de la langue, de la qualité OCR et du bruit
> métier. **Ne PAS coder en dur 0.65 comme constante opposable.**

- Cosine initial **proposé 0.65** (vs 0.55 pour `find_similar_knowledge_chunks`)
  — **mesurable, interne, ajustable** par algorithm_version. Stocké en
  config ou en colonne par lecture (`algorithm_version`), jamais figé.
- Top-K chunks documents par paire : **3** (paramétrable interne).
- Top-N traces par paire : **5** (paramétrable interne).
- k-anonymisation : si la combinaison nomme < 4 personnes distinctes,
  généralisation (V6.7 verrou).
- Plafond UI : ≤ **3** lectures de résonance / surface site, ≤ **2** /
  surface contrat. Tri par `internal_score` desc, mais **le score reste
  invisible** (interne, verrou CI : aucun import depuis `app/**`).

#### Filtres critiques (anti faux liens sémantiques — non négociables)

Le verrou produit le plus important après « pas de vérité automatique » :
« accès » matche *sécurité / badge / informatique / portail / parking /
login*. **Sans filtres amont, β devient un moteur d'absurdités.** Tout
candidat de résonance DOIT passer les 4 filtres :

1. **`document_links`** — bornage **structurel** par l'attachement
   explicite à l'entité scopée (jamais docs × traces tenant-wide).
2. **`document_type`** — la résonance accepte/refuse selon le couple de
   types (ex. `procedure` ↔ `site_note` OK ; `facture` ↔ `site_note`
   refusé). Table de couples autorisés, explicite.
3. **`target_type`** — un doc lié *contrat* ne génère pas de lecture
   *site* tant qu'il n'est pas aussi lié au site (et inversement).
4. **`source_domain`** — restreindre la similarité aux paires
   (`document` ↔ trace site-scopée), jamais library/tender_history vers
   un site.

Ces 4 filtres sont **AND**, jamais OR. Un seul manquant = pas de candidat.

#### Documents juridiques — prudence ultra-stricte (raffinement Vincent 2026-05-20)

`document_type ∈ {litige, contrat, avenant, facture}` = **zone à
risque d'interprétation sensible**. Règles renforcées :

- `visibility_level` minimum imposé : `manager` (jamais `field` /
  `client_portal`) pour les résonances issues de ces types.
- Audit obligatoire à toute génération + à toute ouverture de la lecture.
- Wording de la lecture **explicitement prudent** (« pourrait
  concerner », « à vérifier humainement »), JAMAIS affirmatif.
- Validation humaine **avant** affichage dans toute surface partagée
  (preuves/rapports B3 : zéro auto-exposition).
- Tripwire structurel : aucune lecture issue de `litige` ne traverse
  client_portal sans dismiss/validation explicite.

#### Refresh / expiration / statut

- Lecture créée avec `expires_at = +30j`. Au-delà : `status='expired'`,
  re-calcul potentiel sur prochain événement.
- `dismissed` par un humain (admin/manager) : persistant, jamais
  ressurgit (sauf algorithm_version change).
- `algorithm_version` permet de relancer un sous-ensemble proprement.

#### Sources

Chaque lecture **DOIT** porter au moins : `doc_source_id` (1) + 1+
`trace_source_id` ou équivalent. UI = puces cliquables → `/documents/[id]`
et lien vers la trace site. Sans 2 sources, pas de lecture (refus).

#### UI minimale

Réutiliser `SiteReadingsList` existant (V5.1.4) — ajouter un *kind*
`cross_store_resonance`. Pour le contrat : créer un `ContractReadings`
équivalent (mince ; spec doc-lifecycle Pilier V6.3 « factuelle, jamais
narrée »). Aucune nouvelle surface UI majeure.

#### Coûts IA — estimation

- α : **0 IA additionnelle**. Réutilise embeddings existants.
- β : **0 embedding nouveau** (réutilise knowledge_chunks +
  trace_embeddings persistés). Le calcul = **cosine côté DB** (pgvector
  `<=>`), pas un appel LLM. Coût marginal : O(linked_docs_per_entity ×
  linked_traces_per_entity), borné par `document_links`. En pilote AGP :
  marginal (dizaines de pairs par site au max).
- Pas de re-embed. Pas de LLM. Pas de cron massif.

Si la discipline coût IA n'est pas tenue (cross-product, LLM
résumés, cron) → la phase ne ship pas (cf. règle gouvernance V6).

---

## 7. Roadmap B0 → B4

### B0 — **étude (ce livrable)**
- Décisions α/β/γ, seuils, tables, jobs, anti-patterns gravés.
- **Aucune ligne de code, aucune migration.**
- Ratification Vincent avant B1.

### B1 — preuve de concept **sûre** (approche α uniquement)
- Implémenter les **lectures dérivées déterministes lien-fort** pour 1-2
  scénarios (validés Vincent 2026-05-20) : « plan d'accès ↔ incident »
  et « procédure ↔ note terrain » via extraction de termes-clés
  déterministe (faible ambiguïté, forte valeur, peu de bruit).
- Réutiliser `site_reading_candidates` ou table parallèle minime.
- Job event-driven idempotent.
- UI : extension `SiteReadingsList` (kind nouveau).
- **Garde-fous** : ≤ 3 lectures/site, 2 sources obligatoires, expires 30j,
  dismiss admin, audit, visibilité au render, **zéro LLM**.
- **Métriques internes OBLIGATOIRES** (gate B2 — raffinement Vincent
  2026-05-20) : nombre de lectures générées · taux de clic · taux de
  suppression / ignoré · taux de validé · estimation de bruit / faux
  positifs (revue humaine d'un échantillon). Stockées en base (table
  d'événements ou compteurs), consultables par admin. **Sans ces
  métriques, B2 ne s'ouvre pas.**

### B2 — pré-calcul cross-store (approche β, gated DEUX FOIS)
- **Gated** sur (a) résultats B1 *positifs* (couverture insuffisante en α
  démontrée) **et** (b) métriques B1 collectées (faux positifs mesurés <
  un seuil acceptable défini par Vincent avant ouverture).
- **Migration** `cross_store_resonances` (additive) + jobs event-driven.
- Seuils empiriques **non figés** (cf. §6.5) — `algorithm_version` permet
  de varier.
- Filtres critiques (cf. §6.5) AND : `document_links` + `document_type`
  (couples autorisés) + `target_type` + `source_domain`.
- Bornage strict par `document_links` (jamais cross-product live).
- Tests : pas de cross-product live, pas de score exposé (verrou CI),
  k=4 anti-ré-id, prudence renforcée juridiques, visibilité
  défense-en-profondeur, mock = no real recall.
- **Si α suffit en B1, sauter B2.**

### B3 — preuves / rapports (consommation, jamais production)
- Documents rattachés à une intervention apparaissent dans le dossier de
  preuves **uniquement si visibility_level autorise** + **validation
  humaine** avant exposition au client.
- Réutilise A4/A5/A6 — pas de nouveau pré-calcul.
- Aucun document client_portal auto-exposé.

### B4 — mémoire accumulée des agents IA (Lecture 1, prudente)
- Agent capitalise ses appuis `[doc:id]` entre analyses (au-delà de
  A6 single-shot dans tender_analyses).
- Étude anti-bruit + contexte budget : un agent ne réinjecte JAMAIS un
  historique gonflant le prompt ; toujours **recall borné par requête**
  (A3) — l'accumulation sert à *citer* / *suggérer*, pas à *injecter en
  bloc*.
- **Doctrine** : Lecture 1 stricte, jamais « ce que connaît Joseph »
  (V6.2/V6.8 ; verrou existant continue de mordre).

### Hors scope Niveau B (à laisser dehors explicitement)

- Reset/seed propre de la base Cloud partagée (infra, hors code produit).
- Observabilité coût IA (parquée, roadmap).
- Bulk import documentaire (K, roadmap).
- Convergence `knowledge_items` → documents (spec dédiée, déclencheur
  Vincent).

---

## Critique honnête et points dangereux

1. **Tentation γ (dupliquer chunks doc dans trace_embeddings)** : facile
   à coder, dette qui s'amplifie. Refus gravé.
2. **Sur-pré-calcul** : si β recompose tout sur chaque événement, on
   crée un cron déguisé. Idempotence et bornage par `document_links`
   **non négociables**.
3. **Faux positifs sémantiques** : un seuil trop bas → bruit ; trop haut
   → couverture nulle. La calibration est un risque produit ; mesure
   manuelle obligatoire avant ouverture publique des résonances.
4. **Documents nominatifs** (litiges) : la lecture ne doit jamais devenir
   un canal d'extraction de noms. k=4 + déterministe-anonymisé ou skip.
5. **`internal_score` qui dérive** : un dev pressé pourrait l'afficher
   en UI. Tripwire CI : aucun import de la colonne dans `app/**`.
6. **Cascade d'événements** : `onDocumentReady` → `onTraceInserted` →
   re-calcul → bouclage. Garde-fou : tags d'origine, idempotence stricte,
   pas de re-déclenchement sur soi-même.
7. **Effet « bibliothèque morte »** côté résonances : si on n'expose pas
   un minimum, l'investissement β devient invisible et donc inutile.
   B1 mesure cela explicitement avant B2.

---

## État des ratifications (Vincent 2026-05-20)

| # | Décision | Statut |
|---|---|---|
| 1 | **α d'abord, β conditionnel** à mesure de bruit/couverture | ✅ ratifiée |
| 2 | **Scénarios B1** : « plan d'accès ↔ incident » + « procédure ↔ note terrain » (termes-clés déterministes) | ✅ ratifiée |
| 3 | **Plafonds UI** ≤ 3 résonances/site, ≤ 2/contrat | ✅ ratifiée |
| 4 | Seuil cosine | ⚠️ **raffiné — NE PAS figer à 0.65** ; mesurable, interne, `algorithm_version` (cf. §6.5) |
| 5 | **k=4** sur résonances documentaires nominatives | ✅ ratifiée (déjà verrou doctrinal) |
| 6 | Réutiliser `site_reading_candidates` étendu vs nouvelle table `cross_store_resonances` | ⏳ ouvert (à trancher SI B2 ouvert) |
| 7 | **B3/B4** gatées indépendamment | ✅ ratifiée |
| **NEW** | **Métriques internes B1 obligatoires** avant ouverture B2 (#lectures, clic, dismiss, validé, faux positifs revus) | ✅ ratifié, ajouté §B1 |
| **NEW** | **Documents juridiques** (`litige/contrat/avenant/facture`) : prudence ultra-stricte — `visibility ≥ manager`, audit, wording « pourrait », validation humaine avant exposition, tripwire client_portal | ✅ ratifié, ajouté §6.5 |
| **NEW** | **Filtres critiques AND** : `document_links` + `document_type` (couples autorisés) + `target_type` + `source_domain` — non négociables anti faux liens sémantiques | ✅ ratifié, ajouté §6.5 |

**Seul point encore ouvert** : #6 (table dédiée vs extension de
`site_reading_candidates`) — décision repoussée à l'ouverture de B2, si
les métriques B1 le justifient. **B1 peut démarrer** sur les autres
ratifications.

Aucun code, aucune migration tant que B1 n'est pas explicitement lancé.
