# P-UI-R1 — Audit READ-ONLY du workflow de rapprochement humain existant

Date : 2026-08-27. READ-ONLY, aucun code. Objet : tracer « Rapprochements IA » avant toute conception.

## Réponses aux 10 questions

**1. Où est-elle ?**
Deux surfaces, **même donnée** :
- **Après import** : page `/sites/[id]/visites/[visitId]/resultat-import` (`resultat-import/page.tsx` +
  `ImportResultSuggestions.tsx`). Cartes de rapprochement inline (« N rapprochements à examiner »).
- **Ligne de vie** : `/sites/[id]/historique` → `SubjectLifelineGrid.tsx` (matrice « Rapprochements IA »
  + DnD). Point de reprise « plus tard ». Desktop. (Pas de surface mobile dédiée.)

**2. Quelle donnée l'alimente ?**
Table **`canonical_subject_similarity_suggestion`** (mig 307) : paire normalisée (a<b, unique),
`score/verdict/recommendation/suggested_link_type/suggested_direction/suggested_label/reason/model`,
`status ∈ {pending, accepted_merge, accepted_link, rejected, obsolete}`. Lecture UI via
`getSiteSuggestions` (`minScore=50`, filtre `status='pending'`, marque obsolètes les paires dont un
sujet n'est plus actif). Le post-import lit un sous-ensemble scopé au run via `getMemoryBuildResult`.

**3. Quel moteur produit les candidats ?**
`analyzeSubjectPair` (Gemini) — **le même juge que P1-C2**. Verdict fermé
`same_subject|related|distinct|uncertain` + recommandation `merge|link|none`. Réutilisé partout (batch,
trigger, DnD). Pas de second moteur.

**4. Quand les candidats sont-ils calculés ?**
- **Après import** : `triggerIncrementalSimilarityAnalysis` (appelé par `runHistoricalMemoryBuildPipeline`
  après `ensureHistoricalPdfOccurrences`), scope **incrémental** (sujets touchés × actifs), paires
  rejetées exclues, persistance `pending`. Pas de recalcul complet du graphe.
- **Batch CLI** (`scripts/analyze-subject-similarities.ts`) et **DnD à la demande**
  (`getOrAnalyzeSubjectPairAction`).

**5. Que devient un `related(75)` ? — LE TROU**
`generateCandidates` → `heuristicScore` **exige au minimum Jaccard ≥ 0.2** (sinon retourne `null`).
Donc :
- si la paire est **lexicalement proche** (jac ≥ 0.2) → analysée → `related(75)` persisté (≥ minScore 50)
  → **apparaît** en Rapprochements IA (recommandation `link`), pending, en attente humaine ;
- si la paire est **lexicalement disjointe** (Mall ↔ food court, **jac 0**) → **jamais candidate →
  jamais analysée → `related(75)` N'EST JAMAIS PRODUIT → n'apparaît JAMAIS**.
C'est **exactement le même trou de préfiltre lexical que P1-C2** : la surface humaine existe, mais elle
n'est jamais alimentée pour les cas sémantiques (ceux qui ont le plus besoin d'arbitrage humain).

**6. Que fait « Accepter » ?**
- `merge` → `acceptSuggestionAsMergeAction` → **vraie fusion** (`mergeCanonicalSubjectsAction` :
  reroute occurrences/threads/proposals/links + **journal `canonical_subject_merge`**) → suggestion
  `accepted_merge` → auto-obsolète les autres pending du perdant.
- `link` → `acceptSuggestionAsLinkAction` → **crée `canonical_subject_links`** → `accepted_link`.
Rien d'improvisé ; chemins existants et journalisés.

**7. Que fait « Refuser » ?**
`rejectSuggestionAction` → `status='rejected'`. **Mémoire des refus : OUI, double.**
(a) `upsertSuggestion` **refuse d'écraser** une décision `rejected` (protégée) ; (b)
`triggerIncrementalSimilarityAnalysis` **charge les `rejectedPairs`** et les exclut de la génération de
candidats. → une paire refusée **n'est jamais re-proposée**.

**8. État `pending` ?**
**OUI**, natif (`status DEFAULT 'pending'`). L'architecture représente déjà « MemorIA propose A↔B,
humain n'a pas répondu ».

**9. Réutilisable après import ?**
**DÉJÀ FAIT.** Le post-import (`resultat-import`) affiche « N sujets identifiés · N intégrés · N
rapprochements proposés » puis les cartes ; s'il n'y a aucun pending → « ✓ Mémoire à jour » sans étape.
Un seul moteur, une seule vérité.

**10. Où vit le backlog ?**
**Table unique** → visible (a) immédiatement en fin d'import (resultat-import), (b) plus tard en Ligne de
vie (SubjectLifelineGrid). Une décision prise depuis l'un `revalidatePath('/sites/[id]/historique')` +
retire la carte ; comme les deux surfaces lisent `pending`, la décision **disparaît des autres**. (À
vérifier : présence d'un compteur pending discret dans **Aperçu** — `site-attention-items` référence les
suggestions ; non confirmé ici.)

## AS-IS (diagramme)

```
Import PV → canonicalisation → triggerIncrementalSimilarityAnalysis
   → generateCandidates  [PRÉFILTRE LEXICAL : Jaccard ≥ 0.2]   ← trou
        → analyzeSubjectPair (Gemini, verdict fermé)
             → upsertSuggestion (pending)  [refuse d'écraser rejected/accepted]
   ┌─────────────── canonical_subject_similarity_suggestion ───────────────┐
   │  post-import (resultat-import)        Ligne de vie (SubjectLifelineGrid)│
   │        cartes merge/link/none                matrice + DnD              │
   └───────────────┬───────────────────────────────┬───────────────────────┘
        Accepter(merge)→fusion+journal   Accepter(link)→canonical_subject_links   Refuser→rejected(mémoire)
```

## TARGET minimal (réutiliser l'existant, PAS de nouvelle page)

```
Import PV → canonicalisation → phase sémantique (P1-C2b, déjà en place)
   → same_subject sûr → auto-attach (déjà)
   → related / uncertain / same_subject sous seuil auto → **upsertSuggestion(pending)**  ← RACCORD
        (au lieu d'être jeté)
   → alimente la MÊME table → MÊMES surfaces (resultat-import + Ligne de vie) inchangées
```
Le seul ajout structurel : **quand la phase sémantique produit un related/uncertain/borderline, le
persister comme suggestion** au lieu de le discarder. Aucune nouvelle UI, aucun second moteur, aucune
seconde vérité. Le générateur de candidats reste lexical pour l'auto-analyse large ; la voie sémantique
(bornée, coûteuse) n'alimente que les cas que le lexical rate.

## Gap analysis

| Élément | État |
|---|---|
| Table suggestions + statuts + pending | **EXISTE** (mig 307) |
| Accept merge (fusion + journal) / accept link / reject | **EXISTE** |
| Mémoire des refus (non ré-proposition) | **EXISTE** (upsert + rejectedPairs) |
| Surface post-import (cartes « à examiner ») | **EXISTE** (resultat-import) |
| Surface reprise « plus tard » (Ligne de vie) | **EXISTE** (SubjectLifelineGrid) |
| Backlog partagé, décision qui disparaît partout | **EXISTE** |
| Déclenchement automatique après import | **EXISTE** (trigger incrémental) |
| Juge sémantique fermé | **EXISTE** (analyzeSubjectPair) |
| **Alimentation en candidats SÉMANTIQUES (non lexicaux)** | **MANQUANT** — `generateCandidates` = lexical (Jaccard ≥ 0.2) |
| **Persistance des related/uncertain de la phase sémantique P1-C2b** | **À RACCORDER** (aujourd'hui jetés) |
| Compteur pending discret dans Aperçu | **À VÉRIFIER** (site-attention-items) |

## Conclusion

Il ne faut **rien reconstruire**. Le workflow humain (proposer → vérifier maintenant / plus tard →
accepter/refuser → mémoire des refus → backlog partagé) est **déjà en production**. Le manque est en
**amont** : le seul générateur de candidats est lexical, donc les cas sémantiques (le related(75)
Mall/food court, exactement ceux qui exigent l'humain) n'atteignent jamais la table. Le raccord naturel
est de faire **persister par la phase sémantique P1-C2b ses verdicts related/uncertain/borderline comme
suggestions** — ce qui les fait apparaître dans les surfaces existantes, sans nouvelle page.

**HARD STOP.** Audit seul. Aucun code, aucune migration, aucune maquette.
