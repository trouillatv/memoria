# P1 — Audit READ-ONLY de la continuité 2024→2025 (Bella Napoli)

Date : 2026-08-27. Aucune écriture, aucune fusion, aucun rematching. Repart des données
(occurrences / canonical_subject / propositions), pas de l'UI. Sources :
`_audit-p1-bella-continuite.ts`, `_audit-p1-lists.ts`.

## Constat central : ZÉRO continuité

`spanning_both = 0` : **aucun** canonical_subject ne porte à la fois une occurrence 2024-07-19
et une occurrence 2025-08-05. 6 sujets « 2024 » + 16 sujets « 2025 » = **22 sujets totalement
séparés**. CBO Bella Napoli = **vide**. MemorIA ne voit pas une histoire annuelle, il voit 22 faits
isolés. C'est l'échec du cœur de valeur (transformer 2 CR en histoire métier).

## Cause racine (MÉCANISME, pas donnée locale)

**Défaut 1 — faits métier canonicalisés sur des ACTEURS.** En 2024, 5 faits sur 6 sont rattachés au
canonical_subject de l'ORGANISME cité, pas à un sujet métier durable :

| Occurrence 2024 (fait) | CS obtenu (faux) | CS métier attendu |
|---|---|---|
| Appareils de cuisson contrôlés par **Bureau Veritas** le 25/03/2022 | « Bureau Veritas » | Appareils de cuisson |
| Nettoyage conduits réalisé par **KFT** en 11/2022 | « KFT » | Nettoyage conduits d'extraction |
| Système extinction friteuse par **MIES** en 11/2022 | « MIES » | Extinction automatique friteuse |
| Validation issue Mall (décision **DSCGR**) | « DSCGR » | Dégagement / issue Mall |
| Panneau + marquage (proposé par **CAPSE NC**) | « CAPSE NC » | Séparation flux public/personnel |
| Dégagement extérieur du Mall encombré | « Dégagement extérieur du Mall » ✓ | (correct) |

Conséquence : **il n'existe aucun sujet métier 2024** pour électrique / extincteurs / nettoyage /
friteuse / cuisson. Les vrais sujets métier n'apparaissent qu'en 2025 → ils n'ont aucun ancêtre 2024
à rejoindre → tout 2025 est « nouveau ». La rupture de continuité est donc en grande partie
**produite** par le défaut 1.

Le même défaut réapparaît en 2025 : « Récupération des huiles usagées » → CS « **Velayoudon** » ;
« Contrôles climatisation réalisés » → CS « **VHZ réfrigération** ». Faits sur acteurs.

**Défaut 2 — conflation registre ↔ contrôle (électrique).** Le CS « Registre de sécurité installations
électriques non renseigné » porte l'occurrence « **Contrôles électriques, éclairage et cuisson à
refaire** ». Deux réalités distinctes (tenue documentaire du registre vs contrôle technique à refaire)
sont fondues sur un même sujet mal étiqueté.

## Matrice (chaînes métier critiques)

| Sujet 2024 | Sujet 2025 | CS actuel | Verdict | Problème | Local/Méca |
|---|---|---|---|---|---|
| (fait cuisson sur acteur B.V.) | Contrôle appareils cuisson (0 occ) | séparés | MISSING_MATCH | pas de sujet métier 2024 | Mécanisme |
| (fait extincteurs — absent en métier) | Contrôle des extincteurs | séparés | MISSING_MATCH | idem | Mécanisme |
| (fait friteuse sur acteur MIES) | Contrôle extinction auto friteuse | séparés | MISSING_MATCH | idem | Mécanisme |
| (fait nettoyage sur acteur KFT) | Nettoyage conduits d'extraction | séparés | MISSING_MATCH | idem | Mécanisme |
| (fait électrique — absent) | Registre élec. non renseigné (occ=contrôles à refaire) | — | WRONG_MERGE | conflation registre/contrôle | Mécanisme |
| Dégagement extérieur du Mall | Issue de Secours du food court | séparés | MISSING_MATCH | même sujet Mall non rapproché | Mécanisme |
| DSCGR (décision sur acteur) | — | « DSCGR » | WRONG_MERGE | décision rattachée à l'acteur | Mécanisme |
| CAPSE NC (action panneau sur acteur) | — | « CAPSE NC » | WRONG_MERGE | action rattachée à l'acteur | Mécanisme |
| — | Récupération huiles → « Velayoudon » | — | WRONG_MERGE | fait sur acteur | Mécanisme |
| — | Climatisation → « VHZ réfrigération » | — | WRONG_MERGE | fait sur acteur | Mécanisme |

## Compteurs

- **SAME_SUBJECT_CORRECT** (rapprochements corrects 2024↔2025) : **0**.
- **WRONG_MERGE** (fait/décision/action rattaché à un acteur, ou conflation) : **≥ 8**
  (B.V., KFT, MIES, DSCGR, CAPSE NC en 2024 ; Velayoudon, VHZ, registre/contrôle en 2025).
- **MISSING_MATCH** (récurrent non rapproché) : **≥ 6** (les 5 équipements + Mall).
- **RELATED_BUT_DISTINCT mal fusionnés** : registre ↔ contrôle électrique.
- **Chaînes métier correctement comprises** : **0**.
- **Chaînes cassées** : électrique, extincteurs, nettoyage/hotte, friteuse, cuisson, flux/Mall — **toutes**.

## Faux positifs ET faux négatifs (les deux directions)

- **Sur-fusion / mauvais rattachement** : faits métier collés sur des acteurs (défaut 1) ; conflation
  registre/contrôle (défaut 2).
- **Fragmentation / faux négatifs** : les 5 équipements récurrents + le sujet Mall, qui auraient dû
  être un seul sujet longitudinal 2024↔2025, sont éclatés (aggravé par le défaut 1).

## Diagnostic moteur

Deux mécanismes génériques (reproductibles, critiques avant Géant où chaque fait cite un organisme) :
1. **Canonicalisation d'un fait métier sur l'ACTEUR qu'il mentionne** plutôt que sur un sujet métier
   durable. À tracer : chemin occurrence historique (`ensureHistoricalPdfOccurrences`) ↔ identité de
   thread (`subject_thread_identity`) ↔ auto-link acteur (`tryActorAutoLink`, extract-historical-pv) —
   déterminer pourquoi le sujet retenu est l'acteur. Le matcher déterministe ne matche PAS « Nettoyage…
   par KFT » sur « KFT » (token court), donc la cause est ailleurs dans le pipeline d'occurrence/acteur.
2. **Absence de rapprochement inter-année** même quand les deux sujets métier existent (Mall 2024 vs
   Issue food court 2025).

## Recommandation — P1-B (READ-ONLY, avant tout correctif)

Tracer précisément, sur un cas (ex. « Nettoyage… par KFT » 2024), la chaîne
proposition → thread → subject_thread_identity → canonical_subject, pour isoler la fonction exacte qui
attribue l'ACTEUR comme sujet. Puis proposer le plus petit correctif générique + tests + risque de
sur-fusion, sans toucher aux données Bella Napoli. Ne pas corriger manuellement les CS Bella Napoli
comme solution d'un défaut reproductible.

**HARD STOP.** Aucun UPDATE, fusion, rematching ni migration. Diagnostic uniquement.
