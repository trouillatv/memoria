# P1-C1a — Correctif Bug A (fait métier absorbé par acteur) + dry-run avant/après

Date : 2026-08-27. Bug A **uniquement**. P1-C2 (matching sémantique inter-années) reste **séparé**.
Aucune réparation des données existantes (occurrences/rattachements) — réservé à **P1-C1b** après
validation de ce dry-run. **HARD STOP** à la fin de ce rapport.

## Principe préservé

Sujet métier ≠ acteur cité dans le sujet. Un acteur mentionné dans un fait reste une **entité liée**
au sujet, jamais le sujet lui-même. Un acteur peut rester un sujet légitime quand la proposition est
elle-même de nature acteur (person/company) — ce chemin est inchangé.

## Correctif (mécanisme, générique)

1. **Marqueur de nature** — `canonical_subject.kind ∈ {actor, business_subject}` (migration 355,
   additive, réversible). Encode la NATURE du sujet, pas une propriété accidentelle ; nommé pour
   accueillir demain d'autres natures sans renommage.
2. **Fixé à la création depuis la PROVENANCE, jamais le label** :
   - `extract-historical-pv.ts` étape 12c (orphelin person/company) → `kind='actor'`.
   - `actor-auto-link.ts` `ensureActorCanonicalSubject` (identité acteur explicite) → `kind='actor'`.
   - créations métier (`reconcileHistoricalPvCanonicalSubjects` Phase 2, source-reconcile) →
     `business_subject` (défaut).
   - Backfill des lignes existantes par provenance : `company_id/contact_id` non nul, OU thread
     issu d'une proposition person/company. **Jamais** `label == nom d'entreprise`.
3. **Exclusion du pool pour les propositions MÉTIER** — `reconcileHistoricalPvCanonicalSubjects` ne
   traite que des familles métier (FAMILY_TO_KIND exclut person/company). Ses trois passes de
   résolution retirent désormais les sujets `kind='actor'` :
   - Phase 1 déterministe : `resolveCanonicalSubjectReference(…, { excludeActorSubjects: true })`.
   - Phase 1.5 (LLM liste fermée) et Phase 1.6 : `existingCs` filtré `kind <> 'actor'`.
   Le chemin acteur (person/company) et le resolver live/copilote (option par défaut à false) sont
   **inchangés**.

## Classification appliquée (Bella Napoli) — provenance, pas label

16 `actor` (8 organismes : Bureau Veritas, CAPSE NC, DSCGR, KFT, MIES, Velayoudon, VHZ, BELLA NAPOLI ;
8 personnes) / 18 `business_subject` (tous les sujets métier). **Aucun sujet métier mal classé.**

## Dry-run — que produirait le nouveau resolver sur 2024/2025 (READ-ONLY, aucune écriture)

| Fait (thread métier) | CS actuel (AVANT) | Résolution nouveau moteur (APRÈS) | Verdict |
|---|---|---|---|
| Appareils de cuisson … par Bureau Veritas | **Bureau Veritas** (acteur) | « Contrôle des appareils de cuisson… » (Jaccard) | **corrigé → métier** |
| Installations électriques … par Bureau Veritas | **Bureau Veritas** (acteur) | not_found → Phase 2 crée le sujet | **corrigé → Phase 2** |
| Extincteurs contrôlés par MIES | **MIES** (acteur) | not_found → Phase 2 crée le sujet | **corrigé → Phase 2** |
| Système extinction friteuse … par MIES | **MIES** (acteur) | « Contrôle système d'extinction auto (friteuse) » (ancre) | **corrigé → métier** |
| Nettoyage conduits … par KFT | **KFT** (acteur) | « Nettoyage conduits d'extraction… » (ancre) | **corrigé → métier** |
| Panneau + marquage (CAPSE) | **CAPSE NC** (acteur) | not_found → Phase 2 crée le sujet | **corrigé → Phase 2** |
| Validation issue Mall (DSCGR) | **DSCGR** (acteur) | not_found → Phase 2 crée le sujet | **corrigé → Phase 2** |
| Contrôles climatisation (VHZ) | **VHZ réfrigération** (acteur) | not_found → Phase 2 crée le sujet | **corrigé → Phase 2** |
| Récupération huiles (Velayoudon) | **Velayoudon** (acteur) | not_found → Phase 2 crée le sujet | **corrigé → Phase 2** |

### Compteurs

- absorptions acteur **AVANT** : **9** (threads métier sur un CS acteur).
- absorptions acteur **APRÈS** : **0** (acteurs hors pool — 0 par construction).
- faits corrigés → sujet métier existant (déterministe) : **3**.
- faits corrigés → not_found → **Phase 2 créera le sujet métier** : **6**.
- nouveaux ambigus / sur-fusions inattendues : **0**.

Un `not_found` supplémentaire est **préférable** à un faux match acteur : la Phase 2 créera un vrai
sujet métier durable. Aucune sur-fusion introduite.

### Artefact de simulation (non-régression)

La ligne « Largeur de passage des dégagements réduite → Largeur de passage de la distribution » du
dry-run brut est un **artefact du script** (il retire le CS propre du thread pour éviter l'auto-match).
Ces deux CS sont déjà séparés et `business_subject` : **inchangés** par le correctif (l'idempotence
`alreadyIdentified` saute les threads déjà identifiés). Aucun rapprochement réel n'est produit ici.

## Vérifications

| Vérification | Commande | Résultat |
|---|---|---|
| Tests ciblés (nouveau + non-régression) | `vitest run` (5 fichiers, 76 tests) | **PASS** (11 nouveaux) |
| Typecheck | `tsc --noEmit` | **PASS** (0) |
| Lint | `eslint` (5 fichiers du lot) | **PASS** (0 erreur ; 1 warning préexistant hors diff) |
| Dry-run 2024/2025 | `_p1c1-dryrun.ts` (READ-ONLY) | 9→0 absorptions, 0 sur-fusion |

## Ce qui N'A PAS été fait (réservé à P1-C1b, après GO)

- Aucun UPDATE des rattachements existants, aucune fusion, aucune suppression de CS, aucune
  recréation d'occurrence, aucune rematérialisation. Les 9 occurrences actuellement sur des acteurs
  **restent en l'état** jusqu'à P1-C1b.
- Migration 355 (colonne `kind` + classification par provenance) **appliquée** (additive, réversible) :
  nécessaire au runtime du correctif et au dry-run. N'affecte aucune occurrence.

## Suite

- **P1-C1b** : stratégie de réparation contrôlée des sujets pollués existants (déplacer les 9
  occurrences des acteurs vers les vrais sujets métier — créer ceux qui manquent), avec dry-run
  dédié + recette Bella Napoli. **HARD STOP** avant tout DELETE/recreate.
- Puis nouvel audit `spanning_both` → mesurer les faux négatifs restants (dont Mall vs food court).
- **P1-C2** (séparé) : matching sémantique inter-années, sans baisser le seuil Jaccard.

**HARD STOP.** J'attends validation du dry-run avant P1-C1b.
