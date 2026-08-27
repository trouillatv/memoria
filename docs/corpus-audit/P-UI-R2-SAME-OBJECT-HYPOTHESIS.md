# P-UI-R2 — Pièce moteur `same_object_hypothesis` + dry-run

Date : 2026-08-27. Objectif : rendre exploitable par l'humain l'incertitude du juge, en séparant
dans la bande `related` « même objet plausible (confiance insuffisante) » de « objets distincts liés ».
Aucun nouveau composant, page ou table. Raccord UI = étape suivante (HARD STOP avant).

## Constat de la sonde (préalable)

Le score seul ne discrimine PAS : Mall/food court `related(75)` (même objet, prudent) vs Registre/
Contrôle `related(85)` (distinct). `verdict + recommendation` séparent les cas nets, mais dans la bande
`related` les champs structurés sont identiques pour « même objet prudent » et « distinct lié ».

## Correctif (contrat du juge)

`analyzeSubjectPair` retourne désormais `same_object_hypothesis: boolean`, **significatif uniquement
quand `verdict='related'`** : « ces deux sujets pourraient-ils désigner le MÊME objet métier durable,
malgré une confiance insuffisante ? » (≠ « sont-ils liés ? »). Prompt : distinction explicite +
contre-exemples false (registre/rapport/réserve/document ≠ contrôle/équipement). Parse : normalisé à
`false` hors `related` et en cas de doute (favorise le faux négatif). **Aucun seuil `same_subject`
modifié.**

## Dry-run réel (juge Gemini) — la séparation est stable et INDÉPENDANTE du score

| Paire | verdict | score | same_object_hypothesis | Routage |
|---|---|---|---|---|
| local technique ↔ local électrique | related | **65** | **true** | **CARTE « Même sujet ? »** |
| réserve accès ↔ contrôle accès | related | **85** | **false** | aucune |
| Registre ↔ Contrôle électrique | related | 80 | false | aucune |
| Rapport SSI ↔ Contrôle SSI | related | 85 | false | aucune |
| Mall ↔ food court (contexte réel) | same_subject | 95 | — | auto-match |
| issue parking ↔ sortie extérieure | same_subject | 95 | — | auto-match |
| sprinkler ↔ extincteurs | distinct | 10 | false | aucune |
| labels nus « Contrôle » ↔ « Vérification » | same_subject | 95 | — | auto-match (⚠ voir limite) |

**Preuve clé** : la réserve/accès (score 85) → false/rien, tandis que le local technique/électrique
(score 65) → true/carte. Le score aurait présenté la mauvaise question ; `same_object_hypothesis`
présente la bonne. Anti-bruit tenu même à score élevé (Registre 80, rapport SSI 85, réserve 85 → tous
false).

## Routage cible (raccord à venir)

- `same_subject` (≥ seuil auto, unique) → auto-match (déjà).
- `related` + `same_object_hypothesis=true` → **suggestion pending, recommandation = merge** → carte
  « Même sujet ? » dans les surfaces existantes (resultat-import + Ligne de vie).
- `related` + `same_object_hypothesis=false` → **rien** (relation éventuelle = hors périmètre).
- `distinct` / `uncertain` → rien.

## Vérifications

| | Résultat |
|---|---|
| Tests contrat (6 : contenu prompt + champ typé) | PASS |
| Dry-run réel (témoins + génériques + borderline) | séparation stable, discriminante |
| Typecheck / Lint | 0 / 0 |

## Limites connues

- Labels **nus** (« Contrôle » ↔ « Vérification », sans contexte) → le juge sur-match en
  `same_subject`. Risque théorique : en production les sujets ont toujours un contexte d'occurrence ;
  et « Contrôle » seul n'est jamais un libellé canonique réel. À surveiller, non introduit par ce lot.
- Le champ n'est pas encore **persisté** : le raccord (upsertSuggestion depuis la phase sémantique,
  mémoire des refus + idempotence + cap + exclusion acteur) est l'étape suivante.

## Suite

**Raccord P-UI-R2b** (après validation) : à l'import, quand la phase sémantique (P1-C2b) produit
`related + same_object_hypothesis=true` sur une paire non rejetée / non résolue, `upsertSuggestion`
(recommandation forcée à `merge`) → apparaît dans l'UI existante. Idempotence (paire normalisée),
mémoire des refus (`rejectedPairs` + upsert protégé), cap P1-C2 respecté, acteurs exclus. Dry-run du
NOMBRE de suggestions créées sur Bella Napoli avant tout backfill.

**HARD STOP** après cette pièce moteur + dry-run. Pas de raccord ni de persistance avant validation.
