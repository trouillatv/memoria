# B2 — Étude du pont cross-store documents ↔ traces site

**Date :** 2026-05-20
**Statut :** ÉTUDE — zéro code. Ratification section par section requise avant tranche d'exécution.
**Position doctrinale :** B1 livré (commit `913a854`). Indicateurs B1 rétrogradés en consultatifs ; seul §1.7 (fuite visibilité) reste dur. Vincent autorise l'ouverture de B2 sans attendre les métriques.
**Cadrage Vincent (verbatim 2026-05-20) :**
- résonances **métier fortes**, pas liens « impressionnants techniquement »
- validation humaine systématique
- pré-calcul async, jamais live
- sources obligatoires
- coût borné
- visibilité stricte (recall ET render)
- pas de vérité automatique
- **utile au superviseur terrain**, pas démo IA

Référence : [[memoire-operationnelle-augmentee]], [[echo-juste-not-truth]], [[litige-no-automatic-reading]], [[ai-cost-discipline]], [[doctrine-openings-pay-cost]].

---

## 1. Hypothèse métier — qu'est-ce qu'on cherche ?

**User story cible (test ultime de pertinence B2) :**

> Un chef d'équipe rédige une note terrain sur site X : *« Hier soir le
> sol du couloir Nord était glissant après la pluie. »*
>
> Stocké en parallèle dans `/documents` du contrat : une procédure PDF
> *« Intervention en zone humide — chaussures antidérapantes
> obligatoires. »*
>
> Aujourd'hui un autre chef prend la relève sur site X. La page site
> affiche, en plus des résonances B1 :
>
> *« La procédure « Intervention en zone humide » est rattachée à ce
> site [doc:id] — la note terrain du 19 mai [trace:id] évoque un sol
> glissant après pluie. »*

**Pourquoi B1 ne capte pas ce cas :** B1 cherche des **bigrammes
partagés**. « sol glissant » et « zone humide » ne partagent aucun
bigramme — mais désignent un même réalité métier.

**Pourquoi B2 le capterait :** cosine cross-store entre l'embedding
d'un chunk doc et l'embedding d'une trace site, au-dessus d'un seuil.

**Test du « lien utile, pas impressionnant » (Vincent) :**
- ✅ « zone humide » ↔ « sol glissant » : **utile** (action correctrice
  évidente pour le superviseur).
- ❌ « document sécurité » ↔ « humidité » (cité par Vincent comme
  danger) : trop large, pas actionnable.
- ❌ « procédure ouverture » ↔ « porte fermée » : sémantiquement proche,
  pas actionnable.

**Critère métier proposé :** B2 ne devrait surfacer un lien que si le
**chunk doc cite explicitement une action ou une procédure**
applicable au type d'événement contenu dans la trace. Sinon c'est du
bruit sémantique. *(Décision à ratifier — cf. §6.)*

---

## 2. État courant — ce que B1 ne fait PAS

| Couverture B1 | Cas typique |
|---|---|
| ✅ Plan d'accès ↔ incident d'accès récent (≤30j, déterministe) | Note « le code badge ne marchait pas » + plan d'accès rattaché → résonance B1.access |
| ✅ Procédure ↔ note partageant un bigramme métier ≥ 2 mots (≤30j) | Note « PC sécurité HS » + procédure mentionnant « PC sécurité » → résonance B1.procedure |
| ❌ Procédure ↔ note métier sémantiquement proche sans lexique partagé | Note « sol glissant » + procédure « zone humide » → B1 manque |
| ❌ Référence ↔ trace si pas de bigramme | Doc référence « comportement chien client » + note « le chien a aboyé » → manque |
| ❌ Mémoire technique AO ↔ traces site (cross-tenant interdit) | Hors scope B2 (cross-tenant) |

**Lecture honnête :** B1 attrape les **liens lexicalement évidents**,
manque les **liens sémantiques sans lexique partagé**. B2 vise
spécifiquement ces derniers — mais c'est aussi le territoire des
faux-liens, d'où la prudence requise.

---

## 3. Architecture candidate

### 3.1 Substrat — réutilisation maximale

Deux stores existants déjà alimentés :

- **`knowledge_chunks`** — embeddings 768-dim (Gemini), tenant-scoped,
  `source_domain IN ('library', 'tender_history', 'document')`.
  Filtrable par `document_links` (cf. A2).
- **`trace_embeddings`** — embeddings 768-dim, site-scoped, lié aux
  notes/anomalies/access events via `trace_id`.

**Aucune nouvelle infra vectorielle.** Réutilisation des deux RPC
existantes : `find_similar_knowledge_chunks` + `find_similar_traces_for_tenant`.

### 3.2 Trigger — quand calculer

**Pré-calcul async OBLIGATOIRE** ([[ai-cost-discipline]]). Deux
déclencheurs :

- **Déclencheur primaire — document analysé** (status='ready', cf. B1
  hook). On itère les sites liés au doc, pour chaque chunk doc on
  cherche les top-K traces site les plus proches (K petit, cf. §3.4).
- **Déclencheur secondaire — trace ajoutée sur site.** Coûteux si on
  recalcule pour chaque note. **Proposition : ignorer ce déclencheur
  en β.** Les traces sont nombreuses, les docs rares. Le delta utile
  vient de la rare apparition d'un nouveau doc, pas de la note
  quotidienne. *(Décision à ratifier — cf. §6.)*

**Pas de calcul live au render.** Toute lecture site reste un SELECT
pur depuis `site_reading_candidates`.

### 3.3 Coût — borné par construction

Pour un doc analysé :
- N_chunks = nombre de chunks doc (typiquement 5–30 par PDF)
- M_sites = sites liés au doc (typiquement 1–5)
- Top-K traces matchées par chunk (K=1, cf. §3.4)
- Total RPC calls = N_chunks × M_sites × 1 RPC pgvector indexed
- Ordre de grandeur : ~50 RPC max par document, **une seule fois** à
  l'analyse, **jamais live**.

Comparaison cosine pgvector indexed = O(log N) avec ivfflat. Coût négligeable.

### 3.4 Seuils et plafonds — paramètres internes, pas doctrine

(Pour rappel : « seuils non figés comme valeur doctrinale, mesurables/
internes via `algorithm_version` » — Vincent.)

Proposition initiale :
- **Cosine threshold** : 0.80 (haut — on cherche du lien fort, pas de
  l'approximation). Si rien ne sort, on baisse à 0.75 en B2.1.
- **Top-K par (chunk, site)** : 1 (un seul match, le meilleur).
- **Plafond résonances B2 actives par site** : **2** (en plus des
  3 B1 max — total ≤5/site).
- **`algorithm_version`** : `b2_doc_trace_v1` (mesure/dismiss/évolution
  via cette clé).
- **`expires_at`** : 30 jours (cohérent B1).

*(Toutes ces valeurs sont à ratifier — cf. §6.)*

### 3.5 Stockage — réutilisation `site_reading_candidates`

Mêmes contraintes que B1 :
- `reading_type='resonance'` (existant, zéro migration)
- `algorithm_version='b2_doc_trace_*'`
- `source_ids` = `[{type:'document', id:doc_id}, {type:'trace', id:trace_id}]`
- `status` : active / stale / dismissed
- `expires_at` : NOW() + 30 jours

**Aucune migration.** Aucune nouvelle table.

---

## 4. Garde-fous — un par risque identifié

| Risque | Garde-fou structurel | Vérifiable comment |
|---|---|---|
| Faux lien sémantique | seuil cosine ≥ 0.80 + plafond /2 par site + 2 sources + dismiss humain | métriques § Observation B2 |
| Cross-tenant leak | RPC tenant-scoped (knowledge_chunks) + jointure `sites.tenant_id` côté trace | tripwire test : aucune source d'un autre tenant |
| Litige fuite | filtre `document_type NOT IN ('litige','contrat','avenant','facture')` à l'indexation | tripwire test pareil que B1 ; mémoire [[litige-no-automatic-reading]] |
| admin_only/manager fuite | filtre `visibility_level IN ('operations','field')` à l'indexation **et** au render | §1.7 du protocole B1 réutilisé ; couvre B1+B2 |
| Score visible | `internal_score` interne uniquement, fragment ne cite jamais de % | tripwire test : `internal_score`, `confidence`, `%`, `score` interdits dans fragment B2 |
| Lien trop intelligent (« doc sécurité ↔ humidité ») | critère métier §1 : chunk doc doit citer une **action/procédure**, pas un sujet large | jugement humain « écho juste » §1.6 du protocole B1 |
| Coût latent | déclencheur unique (doc analysé), pas par trace | mesurable via temps d'analyse moyen |
| Embeddings dérivés/biais | aucun ré-embedding nouveau, on réutilise les embeddings existants Gemini | n/a |

---

## 5. Ce qu'on ne fait PAS en B2

- Pas de LLM (déterministe + pgvector indexed).
- Pas de réécriture du fragment (template fixe, comme B1).
- Pas de score visible UI.
- Pas de surface UI dédiée (rendu via `SiteReadingsList` existant comme B1).
- Pas de modification de B1 (B2 est strictement additif).
- Pas de touche aux documents juridiques.
- Pas de cross-tenant.
- Pas de déclencheur live au render.
- Pas de personnalisation par utilisateur (visibility par rôle, pas par identité).

---

## 6. Décisions à ratifier — questions ouvertes

À chaque question, je ne code rien sans ta réponse explicite.

### Q1 — Critère métier du « lien utile »

**Proposition :** B2 ne surfacer un lien que si le **chunk doc cite
explicitement une action ou une procédure** (verbe à l'infinitif,
impératif, ou substantif d'action type « intervention », « procédure »,
« nettoyage », « contrôle ») applicable au type d'événement contenu
dans la trace.

**Alternative plus laxiste :** tout chunk doc proche en cosine sort un
lien, sans contrainte de forme.

**Recommandation :** la première (contrainte de forme) — plus alignée
sur « utile au terrain, pas impressionnant ». Acceptes-tu ?

### Q2 — Déclencheur trace ajoutée

**Proposition :** Ignorer le déclencheur « trace ajoutée » en B2 β.
Seul l'événement « document analysé » déclenche un recalcul. Les
nouvelles traces ne re-matchent rien tant qu'un doc n'est pas
réanalysé.

**Alternative :** déclencher aussi à l'ajout d'une trace, débounce 1h,
limité aux 30 derniers jours d'historique doc.

**Recommandation :** la première (mono-déclencheur) — coût minimal,
comportement simple à expliquer. Acceptes-tu ?

### Q3 — Seuil cosine initial

**Proposition :** 0.80 (haut).

**Alternative :** 0.75.

**Recommandation :** 0.80 d'abord. Si on observe peu de matches après
2 semaines, on baisse à 0.75 en bumpant `algorithm_version` à `_v2`.
Acceptes-tu ?

### Q4 — Plafond B2 par site

**Proposition :** 2 résonances B2 actives par site (total avec B1 ≤ 5).

**Alternative :** mutualiser ≤ 3 total (B1 + B2 confondus). Risque : B2
écrase B1 si plus de matches.

**Recommandation :** la première (compteurs séparés). Acceptes-tu ?

### Q5 — Stockage

**Proposition :** réutiliser `site_reading_candidates` avec
`algorithm_version='b2_doc_trace_*'`. Zéro migration.

**Alternative :** table dédiée `cross_store_resonances` (séparation
forte B1 / B2, query plus simple, audit dédié).

**Recommandation :** la première (réutilisation). La séparation par
`algorithm_version` suffit en β ; si B2 explose en volume on
extraira plus tard. Acceptes-tu ?

### Q6 — Dismiss path

**Proposition :** réutiliser `dismissResonanceAction` (action existante
B1, agnostique à l'algorithme).

**Alternative :** action dédiée `dismissCrossStoreResonance` (audit
différencié, pas de mélange B1/B2 dans les logs).

**Recommandation :** la première (action partagée). L'audit log
contient déjà `algorithm_version` en metadata, donc on peut
différencier en analyse. Acceptes-tu ?

### Q7 — Validation humaine — pré-affichage ou post-affichage ?

**Proposition (post-affichage, alignée B1) :** B2 affiche la résonance
directement, l'utilisateur peut dismisser. Identique B1.

**Alternative (pré-affichage, plus strict) :** B2 calcule mais
n'affiche pas tant qu'un humain (manager+) n'a pas validé chaque
résonance via un panneau dédié.

**Recommandation :** la première en β (cohérent B1, moins de friction).
**Si le bruit B2 dépasse 30 % dismissed, on bascule en pré-affichage.**
Acceptes-tu ?

---

## 7. Plan d'exécution — uniquement après ratification §6

Indicatif. Aucune ligne de code n'est écrite avant que les 7 questions
soient tranchées.

| Tranche | Périmètre | Tests |
|---|---|---|
| **T1** — helpers purs | `lib/documents/cross-store-matchers.ts` : filtres action/procédure du Q1, normalisations, constantes B2. Pas d'I/O. | unit tests purs |
| **T2** — orchestrateur server-only | `lib/documents/cross-store-resonances.ts` : iter sites liés au doc, RPC pgvector cosine, filtre Q1, upsert `site_reading_candidates` `b2_doc_trace_v1`. | tripwires structurels |
| **T3** — hook fire-and-forget | dans `analyze.ts` après B1, import dynamique pattern A3. | extension du tripwire B1 |
| **T4** — guard tests | structural tripwires (visibility recall+render, litige exclu, no LLM/orchestrator/embedding nouveau, plafond, sources obligatoires) | full vitest |
| **T5** — observation | extension du protocole §1 pour `b2_doc_trace_%` (mêmes 7 requêtes adaptées) | n/a |

**Aucune migration.** **Aucun nouvel embedding.** **Aucun LLM.** Total
estimé : 1 séance.

---

## 8. Ce qui rend cette étude finalisable

Le jour où tu réponds aux 7 questions §6 :
- Soit toutes ratifiées « OK » → je code T1 dans la foulée, tranche par tranche, commit séparé par tranche.
- Soit certaines modifiées → je ré-édite ce doc avec tes choix, puis je code.
- Soit étude rejetée → on garde le doc comme trace de la réflexion, on n'écrit pas une ligne.

**Cette étude ne se transforme pas en code sans ton « go »** sur chaque question §6 ou sur un go global explicite.
