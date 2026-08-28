# #228 — Éligibilité opérationnelle sur le `kind` durable (plan)

**Statut : PLAN + simulation READ-ONLY validée. Aucun code moteur écrit.** HARD STOP avant implémentation.

## Diagnostic (voir #227-b, commit 67cd7b5f)

Deux `kind` coexistent. `canonical_subject.kind` STOCKÉ (mig 355, `actor|business_subject`) = nature durable
correcte. `NavigableSubjectSummary.kind` CALCULÉ (`lib/db/canonical-subject-life.ts:1495` =
`occs.find(o => o.family)?.family`) = famille de la 1re occurrence, **utilisé à tort** par `isOperationalSubject`
pour décider l'éligibilité opérationnelle. Corpus : 89/134 business_subject exclus à tort.

## Cible

1. `canonical_subject.kind` STOCKÉ pilote l'éligibilité opérationnelle : `business_subject`/`NULL` →
   opérationnel ; `actor` → non.
2. La famille calculée depuis les occurrences reste utile en INFO descriptive → renommée `dominantFamily`
   (ou `earliestFamily`), ne décide plus seule de l'opérationnel, de l'attention, de la stagnation, du bucket.
3. `OPERATIONAL_EXCLUDED_FAMILIES` (family-set-aware, Tension/Chronologie) : INCHANGÉE.
4. `STAGNATION_INELIGIBLE` : audit SÉPARÉ (2e lot), INCHANGÉE dans ce lot.

## Simulation de régression (READ-ONLY, `scripts/p227c-kind-fix-simulation.ts`)

AVANT = `isOperationalSubject(kind calculé)` · APRÈS = `kind stocké ≠ actor`. STAGNATION inchangée.

| Chantier | élig (op) | flip info→op | attn (SubjectCard) | stagnants | acteurs inclus à tort | flip avec vrai signal | knowledge purs calmes |
|---|---|---|---|---|---|---|---|
| BELLA | 3→8 | 5 | 1→3 | 0→0 | 0 | 2 | 1 |
| Lycée PETRO ATTITI | 15→15 | 0 | 3→3 | 0→0 | 0 | 0 | 0 |
| OCEF Recette B | 18→32 | 14 | 11→12 | 0→0 | 0 | 1 | 0 |
| OCEF Compostage (2c93) | 30→75 | **45** | 27→**29** | 2→2 | 0 | 2 | **34** |
| OCEF Compostage (06c6) | 10→19 | 10 | 9→14 | 4→4 | 0 | 6 | 3 |
| Ocef4 | 2→4 | 3 | 1→0 | 0→0 | 0 | 0 | 3 |

**Lecture décisive** : le « flip » est massif (45 sur OCEF Compostage) mais l'attention ne croît que des sujets
à VRAI signal (+2 seulement). 34 knowledge purs basculent navigables mais restent CALMES (0 raison). **0 acteur
inclus à tort** sur tous les sites. Stagnants inchangés (règle gelée). Ocef4 1→0 : un stocké=actor à famille
calculée opérationnelle est désormais correctement EXCLU (correction bidirectionnelle).

Bella témoins : A/C électrique/nettoyage `non→oui` + `[open_objects]` (objet ouvert) ; B/E cuisson/éclairage
`non→oui` mais attention `∅→∅` (open sans objet = navigable mais calme) ; D flux déjà `oui→oui`. Acteurs (Maeva
LOMBARDI, CAPSE NC, Bureau Veritas, MIES, KFT, Hugo CANEPA) `non→non`.

**Critère de sécurité PROUVÉ** : business_subject éligible ≠ business_subject mérite attention.

## Plan d'implémentation (non exécuté)

**Lot A — éligibilité opérationnelle sur le kind durable**
1. `getNavigableSubjectsForSite` (`lib/db/canonical-subject-life.ts`) : SELECT `canonical_subject.kind` (déjà
   lu ligne ~1479 via `csById` — vérifier qu'il porte `kind`) ; exposer `NavigableSubjectSummary.durableKind:
   'actor'|'business_subject'`. Renommer le champ calculé actuel `kind` → `dominantFamily` (ligne 1495), MAJ des
   consommateurs.
2. `lib/subjects/kind.ts` : `isOperationalSubject(durableKind)` = `durableKind !== 'actor'` (NULL → true). Garder
   `isActorKind`. Adapter la signature aux appelants.
3. Consommateurs à re-router sur `durableKind` :
   - `navSortPriority` (canonical-subject-life.ts:1138) ;
   - `computeAttentionSignals` (lib/subjects/attention.ts:43) — attention : la raison `reservation` lit
     `s.kind==='reservation'` = une FAMILLE, pas la nature → doit lire `dominantFamily`, pas `durableKind` ;
   - `SujetsList.tsx` bucketing client.
4. NE PAS toucher `STAGNATION_INELIGIBLE` ni `OPERATIONAL_EXCLUDED_FAMILIES`.

**Lot B (séparé, après simulation dédiée)** — réviser `STAGNATION_INELIGIBLE` : aujourd'hui exclut
`knowledge_fact` comme si = informatif ; hypothèse fausse en occurrence-first. Décider la base (nature durable /
familles présentes / tri-state+objets). Simulation stagnants AVANT/APRÈS obligatoire.

## Tests (corpus)

- 5 témoins Bella → `durableKind=business_subject`, opérationnels ; attention pilotée par objets (A/C
  `open_objects`, B/E calmes).
- Acteurs (Bureau Veritas/KFT/MIES/CAPSE/…) → `durableKind=actor`, non opérationnels, 0 signal.
- 1 knowledge pur business (familles ⊆ knowledge_fact, 0 objet) → navigable opérationnel MAIS 0 raison
  d'attention (calme).
- Non-régression : `attn APRÈS` ne croît que des sujets à vrai signal ; `acteurs inclus à tort = 0` (assertion).

## Risques

- Densité grille « en mouvement » ↑ (flip) — attendu et voulu (les sujets métier ouverts apparaissent).
- Attention quasi inchangée (gates aval) — le risque « 89 alertes » est écarté par la simulation.
- `dominantFamily` = famille de la 1re occurrence (instable, earliest≠dernier 37/134) : garder comme hint
  d'affichage seulement, envisager plus tard `dominantFamily` = famille majoritaire (hors périmètre).
