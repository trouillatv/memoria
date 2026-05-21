# Sprint B1 & B2 — Mémoire documentaire relationnelle

> **Les documents doivent dialoguer avec la mémoire terrain — sans devenir un moteur d'hallucinations automatiques.**

**Date** : 2026-05-20 (étude B0), 2026-05-20 à 2026-05-21 (livraison B1 + B2 v2).
**Statut** : Production. Ratifiée et observée.

---

## Le problème adressé

Une entreprise accumule deux types de mémoire :

1. **Mémoire terrain** (`trace_embeddings`, site-scopé) : notes, photos, anomalies, signalements
2. **Mémoire documentaire** (`knowledge_chunks` → `documents`, tenant-scopé) : CCTP, plans d'accès, mémoires techniques, protocoles, fiches sécurité

Les deux mémoires sont **embeddées en 768-dim** mais **vivent dans des silos**. Un site qui accumule 50 interventions sur le nettoyage de blocs opératoires devrait *« reconnaître »* qu'un nouveau document AO de bio-nettoyage le concerne. Aujourd'hui, sans pont, l'information se perd.

Le sprint B construit le **pont sémantique** entre ces deux mémoires.

---

## Verrou produit central

Avant tout code, la doctrine est verrouillée :

> **Le verrou conceptuel central de B n'est pas la technique pgvector. C'est d'empêcher que « documents → mémoire du site » devienne un moteur d'hallucinations automatiques.**

MemorIA passe d'un système de stockage/retrieval/chat à un **système de mémoire opérationnelle contextualisée**. La frontière est dangereuse. **Les meilleurs systèmes de mémoire montrent très peu**.

Conséquences :
- Pas de cross-product live (LLM-driven) — uniquement du **pré-calcul async**
- Pas de génération automatique de lectures sans validation humaine
- Plafonds anti-bruit obligatoires (max 3 lectures/site, 2/contrat)
- Wording prudent (« pourrait », « à vérifier »)
- Visibility appliquée 2× (indexation ET render)

---

## L'arbitrage architectural (B0)

### Approche α — Lectures déterministes par lien-fort (B1)

**Principe** : pas de cosine, pas d'IA. On suit les **liens explicites** dans la base :
- `document_links` (un doc rattaché à un site / contrat)
- Couples `document_type ↔ target_type` autorisés (whitelist explicite)

Quand un nouveau document est rattaché à un site, on génère **déterministiquement** une lecture sur ce site (« nouveau plan d'accès », « nouvelle procédure »).

**Avantage** : 100% explicable, 0% hallucination, calculable en SQL.

### Approche β — Pont sémantique (B2, conditionnel à B1)

**Principe** : pré-calcul async d'un graphe `cross_store_resonances`. Pour chaque chunk de document, on cherche les traces (embeddings terrain) sémantiquement proches.

**Filtres AND obligatoires** (un seul manquant = pas de candidat) :
1. `document_links` (le doc doit être rattaché à l'entité cible)
2. `document_type` (couples autorisés, pas de croisement aléatoire)
3. `target_type` (cohérent : un doc site matche des traces site)
4. `source_domain` (un doc « accès » matche traces sécurité/badge/portail, jamais nettoyage)

Sans ces 4 filtres, β devient un moteur d'absurdités.

**Seuil cosine** : 0.65 par défaut, **ajustable** par `algorithm_version` — pas figé comme doctrine. Un cosine n'est pas un fait, c'est une mesure.

**Plafonds** : 3 lectures/site, 2/contrat. Au-delà, on tronque.

### Approche γ — Dupliquer chunks doc dans `trace_embeddings` (REJETÉE)

Mélanger les deux silos rend les filtres impossibles et brouille le contrôle d'accès. Rejet immédiat.

---

## Garde-fous Niveau B (binding)

Ces règles sont **non négociables** et gravées dans le code :

1. **Pas de lecture sans source vérifiable** — `[doc:id]` + `[trace:id]` obligatoires
2. **Pas de vérité automatique** — wording prudent, validation humaine avant exposition
3. **Pas de scoring exposé** — `internal_score` reste **interne** (tripwire CI : aucun import depuis `app/**`)
4. **Pas de fiche personne** — V6.2/V6.8 + plafonds k=4 V6.7 sur résonances nominatives
5. **Visibility appliquée 2 fois** — à l'indexation ET au render
6. **Pas de recalcul render** — la mémoire est pré-calculée, pas générée à l'affichage
7. **Pas d'IA générative dans la production de lectures** — embeddings + cosine OK, LLM non
8. **Plafonds anti-bruit obligatoires** — 3 lectures/site, 2/contrat
9. **Pas d'auto-exposition client** (V6.6) — tout sortie externe passe par validation

---

## Métriques B1 obligatoires

Pour gater B2 :

- Nombre de lectures générées
- Taux de clic
- Taux de dismiss
- Taux de validé
- **Faux positifs revus manuellement** (échantillon hebdo)

**Gate B2 deux fois** :
1. Couverture α démontrée insuffisante (le déterministe ne suffit pas pour la qualité visée)
2. Faux positifs B1 sous seuil défini par Vincent

Sans ces deux gates, B2 reste fermée.

---

## Documents juridiques (zone à risque)

Les types `litige`, `contrat`, `avenant`, `facture` sont des zones à risque d'interprétation sensible :

- **Visibility minimum** : `manager` (jamais `field`, jamais `client_portal`)
- **Audit obligatoire** sur chaque consultation
- **Wording prudent** : « pourrait », « à vérifier », jamais « confirme »
- **Validation humaine** avant exposition partagée (B3)
- **Tripwire structurel** sur `client_portal` — interdit pour ces types

**Litige spécifique** : exclu de TOUTE lecture/résonance/citation automatique. Cf. doctrine `litige-no-automatic-reading`. Même si la `visibility_level` passe.

---

## Livré v2 (2026-05-21)

**Tranches T1-T4 ratifiées** :

- Code : 6 fichiers, +441 lignes
  - `cross-store-matchers.ts` : `extractActionSnippet` + `buildB2FragmentV2` + bump `b2_doc_trace_v2`
  - `cross-store-resonances.ts` : snippet + dedup per-trace + skip si pas de snippet
  - 2 tests doctrine mis à jour, 17 nouveaux cas (88/88 verts)
  - 2 dev scripts : `embed-trace`, `diag-b2`

Observation v2 end-to-end validée — métriques sous seuil, déclenche le go pour intégration produit.

---

## Convergence `knowledge_items → documents`

Mémoire technique :
- `/library` (savoir curé `knowledge_items`) **reste intacte** — route directe + lien contextuel AO, hors menu principal
- `/documents` (expérience documentaire vivante) — entrée menu principale « Bibliothèque »
- Convergence `knowledge_items → document_type='knowledge'` du système générique — **plan tracé non exécuté** (spec `2026-05-19-knowledge-documents-convergence.md`)

Invariant : 2 sémantiques distinctes (curé vs vivant) préservées même après fusion.

---

## Liens

- [Doctrine mémoire](doctrine-memoire.md) — règles communes (sources, silence positif)
- [Roadmap AO](roadmap-ao.md) — les analyses AO consomment B1/B2
- [Continuité opérationnelle](continuite-operationnelle.md) — les briefs s'appuient sur la mémoire documentaire
- Specs : `specs/2026-05-20-niveau-b-documents-memoire-relationnelle.md`
- Spec convergence : `specs/2026-05-19-knowledge-documents-convergence.md`
