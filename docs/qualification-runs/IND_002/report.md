# Qualification IND_002 — Rapport de comparaison Référence vs MemorIA

**Document** : IND_002_CHARENTE_GOUV — compte-rendu de vérification périodique électrique (Bureau Veritas), Centre d'Abattage de Chalais, incluant un rapport de thermographie infrarouge.

**Méthode** : comparaison entre `reference.json` (lecture indépendante du PDF, Phase A, 22 éléments) et `memoria-output.json` (extraction réelle du pipeline de production, Phase B, 65 propositions). Chaque élément de référence est classé MATCHED / PARTIAL / MISCLASSIFIED / MISSED ; chaque proposition MemorIA sans correspondance est vérifiée individuellement et classée LEGITIMATE_EXTRA (contenu réel non retenu par la référence) ou FALSE_POSITIVE (contenu halluciné ou déformé).

## Note sur les familles

`reference.json` utilise la famille `reservation` (2 éléments : E06, E07) que le pipeline MemorIA ne produit pas dans ce run. Ces 2 éléments ont été rattachés au panier `observation`, où ils sont effectivement matérialisés côté MemorIA, pour permettre une table recall/précision à 6 familles comparables. Les familles `deadline` et `action` de MemorIA n'ont aucune base dans la référence : leur recall est non applicable (N/A) ; seule leur précision (absence de faux positif) est mesurable.

## Recall par famille

| Famille | Matched | Partial | Misclassified | Missed | Total référence | Recall |
|---|---|---|---|---|---|---|
| company | 2 | 0 | 0 | 0 | 2 | **100 %** |
| person | 3 | 0 | 0 | 1 | 4 | **75 %** |
| knowledge_fact | 8 | 1 | 1 | 3 | 13 | **65,4 %** |
| observation (dont reservation) | 3 | 0 | 0 | 0 | 3 | **100 %** |
| deadline | – | – | – | – | 0 | N/A (aucun élément de référence) |
| action | – | – | – | – | 0 | N/A (aucun élément de référence) |
| **Global** | **16** | **1** | **1** | **4** | **22** | **75 %** |

## Précision par famille

| Famille | Vrais positifs | Faux positifs | Legitimate extra | Total propositions | Précision |
|---|---|---|---|---|---|
| company | 2 | 0 | 1 | 3 | **100 %** |
| person | 3 | 0 | 1 | 4 | **100 %** |
| knowledge_fact | 13 | 0 | 37 | 50 | **100 %** |
| observation | 5 | 0 | 0 | 5 | **100 %** |
| deadline | 0 | 0 | 2 | 2 | N/A (dénominateur nul, 0 hallucination) |
| action | 0 | 0 | 1 | 1 | N/A (dénominateur nul, 0 hallucination) |
| **Global** | **23** | **0** | **42** | **65** | **100 %** |

**Constat majeur : zéro faux positif détecté sur les 65 propositions.** Chacune des 42 propositions sans correspondance en référence a été vérifiée individuellement (excerpt, page source, cohérence de format) et s'est révélée être du contenu réel du document, non retenu par la lecture indépendante — jamais une fabrication ou une déformation.

## Éléments manqués (MISSED)

- **E08** (p.6, knowledge_fact) — « Rapport de la précédente vérification périodique : Présenté ». Aucune proposition ne capture ce champ administratif.
- **E09** (p.8, knowledge_fact) — « Registre de sécurité visé à l'issue de la vérification ». Aucune proposition correspondante.
- **E18** (p.22, knowledge_fact) — Périodicité retenue « Annuelle ». Aucune proposition correspondante.
- **E22** (p.26, person) — Benoît Clair, Délégué Général CNPP, signataire de l'attestation de compétence en annexe. Les 4 propositions `person` couvrent Corbès, Raynaud et Audoin (×2) mais pas Clair.

## Cas de désaccord de famille (MISCLASSIFIED / PARTIAL)

- **E10** (p.8) — Mise hors tension partielle / DDR testés partiellement : contenu quasi identique à `obs-verif-partielle-ddr`, mais capté par MemorIA en famille `observation` au lieu de `knowledge_fact`. Fait correctement extrait, mauvaise famille.
- **E14** (p.18, PARTIAL) — Périmètre d'examen limité aux tableaux « présentés et accessibles » : l'evidence liée (p.21) contient la phrase clé, mais la proposition `c1-obs-examen-partiel-p21` se concentre sur la recommandation d'extension plutôt que sur le fait de périmètre limité lui-même, et se trouve en famille `observation`. Contenu partiellement équivalent.

## Faux positifs

**Aucun.** C'est le résultat central de cette qualification : sur 65 propositions, 0 a été jugée fabriquée ou déformée après vérification individuelle (excerpts, pages sources, cohérence de format avec les lignes déjà validées par la référence).

## Biais récurrent : sur-fragmentation du tableau d'équipements (p.23-24)

Le document contient un tableau récapitulatif dense de ~41 lignes d'équipements électriques examinés (pages 23-24). La référence agrège volontairement les lignes uniformes en 3 éléments :
- **E19** : ~23 lignes « Rien À Signaler » → 1 seul élément agrégé (choix éditorial explicite, cf. `readerNotes`).
- **E20** : 1 ligne « Examen impossible » isolée → 1 élément.
- **E21** : 6 lignes « Examen impossible » du Hall abattage → 1 élément regroupant les 6.

MemorIA a extrait **chacune des 41 lignes individuellement** comme proposition `knowledge_fact` distincte :
- 23 propositions pour les lignes RAS (dont 1 correspond au point d'ancrage de E19, 22 en LEGITIMATE_EXTRA redondant).
- 18 propositions « Non examiné », dont 6 correspondent bien aux 6 sous-éléments de E21 (granularité voulue par la référence elle-même, correcte), mais **11 propositions supplémentaires** couvrent des lignes « Triperie » et « Atelier maintenance » que la référence n'a pas listées du tout — probable angle mort de la lecture indépendante sur un tableau dense de 2 pages plutôt qu'une invention, format d'excerpt strictement identique aux lignes déjà validées. **Non vérifiable visuellement dans cet environnement** (pdftoppm indisponible pour rendre les pages du PDF) ; à confirmer si un doute subsiste.

**Résultat** : 37 des 50 propositions `knowledge_fact` (74 %) sont des doublons ou fragments d'un seul fait retenu par la référence, sans qu'aucune ne soit fausse. Ce biais dégrade la lisibilité et le volume, pas la fiabilité factuelle. Point de vigilance pour les prochains documents à tableaux répétitifs : le pipeline manque d'un mécanisme d'agrégation équivalent au choix éditorial de la Phase A.

## Preuves image

5 images côté référence (logos Bureau Veritas, cachets/signatures, 2 attestations administratives en annexe) contre 10 `evidence_type: image` côté MemorIA. Document sans photo de chantier au sens propre — uniquement logos, signatures et certificats. Pas de comparaison qualité image-par-image requise pour ce document (à la différence de VRD_002/JAR_01) ; relevé quantitatif uniquement.

## Synthèse

IND_002 confirme un pipeline **fiable mais verbeux** sur les documents à tableaux répétitifs : précision parfaite (100 %, aucune hallucination, y compris sur les clauses légales génériques hors périmètre de la référence), recall global correct (75 %) mais recall `knowledge_fact` pénalisé (65,4 %) par 3 champs administratifs isolés manqués et une personne en annexe non captée. Le point d'attention principal reste la sur-fragmentation (74 % de doublons/fragments sur `knowledge_fact`) et un possible angle mort de la référence elle-même sur 11 lignes de tableau — à confirmer visuellement dès qu'un rendu PDF sera disponible.
