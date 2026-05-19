# Plan — Convergence `knowledge_items` → système documentaire générique

> **Statut : PLAN. NON exécuté.** Décision Vincent 2026-05-19 : converger
> **tôt** (fenêtre MVP, avant explosion des usages) mais **pas maintenant**
> (l'arc documents vient d'être livré, stable, testé — aucun gros refactor
> immédiat). Court terme (coexistence) déjà en place et validé.

## Constat

Deux sous-systèmes finissent au **même endpoint RAG** (`knowledge_chunks`),
`source_domain` distinct :

| | `/library` `knowledge_items` | `/documents` (073→4b) |
|---|---|---|
| Contenu | savoir **rédigé** (markdown curé) | fichiers **uploadés** (texte extrait) |
| Injection Atelier chat | snapshot **wholesale** permanent (`buildLibraryContext`) | recall **borné/par-question** (`buildDocumentContext`) |
| Analyse AO initiale + `matchAoToKnowledge` | ✅ | ❌ (non câblé) |
| RAG | `knowledge_chunks` `source_domain='library'` | idem `source_domain='document'` |

Deux systèmes pour la même finalité = **dette** : double pipeline embed,
double match, prompts dupliqués, deux modèles mentaux utilisateur, coûts.
Fenêtre idéale = **maintenant (quasi vides)** ; douloureux plus tard.

## Cible

Une seule **Bibliothèque = mémoire de l'entreprise** :
`Documents uploadés · Fiches savoir · Protocoles · Réponses AO ·
Références terrain · Procédures · Notes stratégiques`.

`knowledge_items` devient un **type** du système documentaire :
`document_type='knowledge'` (savoir curé) — avec **contenu rédigé**
(éditeur markdown) en plus du chemin upload+extraction.

## Invariant non négociable (à préserver à la convergence)

Un seul **magasin** ≠ une seule **politique d'injection**. La convergence
DOIT conserver **deux sémantiques de retrieval** :
- savoir curé (`type=knowledge`) → **snapshot permanent** pour l'Atelier
  (sémantique actuelle `buildLibraryContext`) ;
- documents source (uploadés) → **recall borné par question** (phase 4b,
  discipline coût IA — jamais wholesale d'un doc source).

C.-à-d. : la politique se décide par `document_type`, pas par le store.

## Déclencheur (opposable — converger AVANT)

Lancer la tranche dès le PREMIER atteint :
- `documents` **> ~50** OU `knowledge_items` **> ~30**, OU
- besoin d'un 2ᵉ chemin embed/match parallèle (ex. `matchAoToDocuments`),
- ou décision produit explicite Vincent.
Sinon : rester en coexistence (court terme ci-dessous).

## Court terme — DÉJÀ EN PLACE (commit 8b632fd, validé)

- Menu unique « Bibliothèque » → `/documents`. Pas d'entrée « Documents ».
- `/library` route intacte (savoir curé éditable en direct + lien
  contextuel AO `tenders/new`). Pipeline `knowledge_items` non touché.
- Aucune migration. Coexistence interne assumée.

## Moyen terme — tranche convergence (NON exécutée ; étapes prévues)

Discipline 071–073 (additif, non destructif, migration commitée + appliquée
sur feu vert) :

1. **Schéma** : `document_type += 'knowledge'` ; `documents.content_markdown
   text NULL` (savoir rédigé) ; éditeur markdown sur la surface documents
   (réemploi `KnowledgeItem*` si possible).
2. **Backfill non destructif** : `knowledge_items` → lignes `documents`
   (`type=knowledge`, `content_markdown` repris) + ré-embed `knowledge_chunks`.
   `knowledge_items` **laissé intact** jusqu'au cutover (rollback possible).
3. **`buildLibraryContext`** : lit le savoir curé depuis `documents`
   `type=knowledge` — **même sémantique snapshot** (cf. invariant).
4. **`matchAoToKnowledge`** : source `documents type=knowledge` (ou union),
   parité vérifiée.
5. **Cutover** : `/library` → redirect `/documents` ; éditeur knowledge =
   surface documents ; `knowledge_items` retiré **après** parité prouvée
   (tests de parité injection Atelier + match AO).

## Garde-fous convergence

- Zéro perte de corpus ; `knowledge_items` survit jusqu'à parité prouvée.
- Discipline coût IA intacte : `type=knowledge` = snapshot curé borné par
  nature ; jamais wholesale d'un document source uploadé.
- Tests de parité (injection Atelier identique avant/après ; match AO).
- Pas de big-bang : étapes 1→5 séparées, chacune commitée + gatée.

## Hors scope absolu de CE document

Aucune exécution. Pas de schéma, pas de migration, pas de refactor
`buildLibraryContext`/`matchAoToKnowledge` ici. Déclenché par le trigger
ci-dessus + feu vert explicite.
