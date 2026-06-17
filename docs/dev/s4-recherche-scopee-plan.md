# S4 — Recherche scopée : plan d'implémentation (prêt-à-exécuter)

> **Statut : GELÉ.** Ce plan ne s'exécute pas avant le **feu vert S3** (validation
> terrain, cf. `docs/testing/validation-s3-scopes.md` : douleur réelle + écran VRD
> ressenti comme réponse naturelle, ≥2 personnes). Il existe pour que, le jour du
> feu vert, S4 démarre en heures et pas en jours. Ne pas coder avant.

## Le but (rappel du nord magnétique)

S3 permet de **ranger** ; S4 permet de **retrouver**. Le premier vrai « wow » :

> **« Que sait-on sur le VRD du Médipôle ? »**
> → en quelques secondes : les actions, les anomalies, les notes et photos de ce
> sous-périmètre, regroupées et synthétisées — sans fouiller tout le chantier.

## La découverte qui rend S4 peu coûteux

Le moteur de retrieval **existe déjà** et est **déjà borné par `site_id`** :

- FTS : `searchMemory({ q, siteId, ... })` → RPC `search_memory` (mig 044/090).
- Sémantique : `findSimilarTraces({ siteId, queryEmbedding, ... })` → RPC
  `find_similar_traces` (mig 052).
- Orchestration + fusion + synthèse : `askSiteMemoryAction(siteId, question)`
  (`app/(dashboard)/sites/[id]/memory-query-actions.ts`).
- UI : `SiteMemoryQuery.tsx`, déjà branchée sur la page site.

**S4 = ajouter un filtre `scope_id` optionnel à cette chaîne.** Pas un nouveau
moteur. Le différenciateur (l'adressage) est déterministe et gratuit : il s'applique
*avant* le LLM, conforme à `ai-cost-discipline`.

## Décision d'architecture : V0 lean d'abord, V1 propagation ensuite

`scope_id` n'existe aujourd'hui que sur **`site_actions`** (mig 117) et
**`intervention_anomalies`** (mig 118). Les autres sources indexées
(`site_notes`, `interventions.notes`, `intervention_photos`, et l'index sémantique
`trace_embeddings`) **n'ont pas** `scope_id`.

Deux chemins :

- **V1 « complet »** — propager `scope_id` partout + ré-embedder/backfill l'index
  sémantique. = 4 migrations, un backfill de `trace_embeddings`, du re-embedding.
  Lourd, et on paierait **avant** de savoir si les gens veulent la recherche scopée.
- **V0 « lean » (RETENU pour le premier coup)** — scoper **uniquement ce qui porte
  déjà `scope_id`** (actions + anomalies) + une synthèse déterministe. Zéro
  migration, zéro re-embedding. Suffisant pour produire le wow sur le démo Médipôle
  (les anomalies VRD/infiltration y sont déjà rattachées) et pour **tester si le
  moment "retrouver" convainc**. Précision >> rappel (cf. `lien-utile-aide-a-agir`) :
  mieux vaut 4 résultats exacts et scopés que 40 vaguement liés.

> Règle de décision : on ne paie la migration lourde (V1) que **si V0 montre que les
> gens reviennent poser des questions scopées**. Le signal d'abord, le coût ensuite.

---

## Plan V0 (lean) — ~½ journée, zéro migration

But : sur la page d'un scope, une boîte « Interroger ce sous-périmètre » qui répond
à partir du contenu **déjà rattaché** (actions + anomalies du scope), avec une
courte synthèse.

| # | Fichier | Action |
|---|---|---|
| 1 | `lib/db/memory-scopes.ts` | Une fonction `getScopeMemory(scopeId)` qui agrège ce qui existe déjà (`listScopeActions` + `listScopeAnomalies`) → un objet « ce qu'on sait sur ce scope » (compteurs + items triés). Déterministe, pas d'IA. |
| 2 | `app/(dashboard)/sites/[id]/scopes/[scopeId]/scope-memory-action.ts` (CRÉER) | `askScopeMemoryAction(scopeId, siteId, question)` : filtre les items rattachés par mots-clés (FTS léger en mémoire ou `ilike`), puis **synthèse courte** réutilisant le synthétiseur déjà écrit dans `memory-query-actions.ts` (même garde-fous d'honnêteté RAG : confiance lexicale, « exact vs proche »). Coût borné, 1 appel max. |
| 3 | `app/(dashboard)/sites/[id]/scopes/[scopeId]/ScopeMemoryQuery.tsx` (CRÉER) | Input « Que sait-on sur {label} ? » + rendu des hits typés (action/anomalie). Calque visuel de `SiteMemoryQuery.tsx`. |
| 4 | `…/scopes/[scopeId]/page.tsx` | Monter `<ScopeMemoryQuery>` en tête (au-dessus de la liste « Mémoire rattachée »). |

V0 ne touche **ni** `search_memory` **ni** `trace_embeddings` : il interroge le
contenu rattaché au scope, qui est déjà borné et déjà visible sur la page.

## Plan V1 (complet) — gated par le signal de V0

Si V0 valide l'appétit (les gens posent des questions, demandent « et les notes ? les
photos ? »), on étend le rappel au reste de la mémoire du site, filtré par scope :

1. **Mig A** — `scope_id` sur `site_notes`, `interventions`, `intervention_photos`
   (nullable, `on delete set null`, index partiel — calque exact de mig 117/118).
2. **Mig B** — `scope_id` sur `trace_embeddings` + param `p_scope_id` à
   `find_similar_traces` ; et `p_scope_id` à `search_memory` (FTS). Tous `default
   null` (rétrocompat).
3. **Backfill** — propager `scope_id` dans `trace_embeddings` depuis la source au
   moment de l'upsert (`embedAndStoreTrace`, `lib/ai/embed-trace.ts`) + script de
   backfill ponctuel pour l'existant.
4. **Couche app** — param `scopeId?` à `searchMemory()` et `findSimilarTraces()`,
   passé jusqu'aux RPC ; `askScopeMemoryAction` bascule sur la vraie recherche
   scopée (FTS + sémantique) au lieu du filtre en mémoire de V0.

## Garde-fous (non négociables, déjà doctrine)

- **Sujet = le lieu / le sous-périmètre, jamais la personne.** Une recherche scopée
  ne produit jamais un état/score par personne. (cf. `surfaces-memoire`,
  `refus-erp-rh`.)
- **Honnêteté RAG** déjà livrée à réutiliser telle quelle : confiance lexicale,
  « exact vs proche », pas d'invention. (cf. `decouverte-guidee-sujets`.)
- **Coût IA borné** : retrieval déterministe scopé d'abord, 1 synthèse LLM courte
  max, affichage du coût en XPF en tooltip (cf. `cout-ia-affichage-xpf`). Pas de
  « LLM live partout ».
- **Litige jamais source automatique** d'une lecture/résonance. (cf.
  `litige-no-automatic-reading`.)

## Ordre aval

S3.5 (alimentation assistée des scopes) a été inséré AVANT S4 et **livré** le
2026-06-17 (mig 119 + moteur de suggestions déterministe + panneau « À
rattacher »). Raison : sans corpus bien alimenté, S4 donnerait une fausse
impression (bon sur le seed, pauvre en réel). S3.5 propage `scope_id` aux photos
et rattache le contenu terrain au bon sous-périmètre, IA propose / humain valide.

```
[feu vert S3] → S3.5 alimentation (FAIT) → S4 V0 (lean) → [signal ?] → S4 V1 → Photos → S5
```

Conséquence pour S4 V1 : `scope_id` sur `intervention_photos` est **déjà fait**
(mig 119) — V1 n'aura plus qu'à l'ajouter à `site_notes`, `interventions` et
`trace_embeddings`.
