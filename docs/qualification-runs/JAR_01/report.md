# JAR_01 — Comparaison qualification Phase C (référence vs MemorIA)

**Document** : compte-rendu de réunion de chantier — renouvellement réseaux eau potable / assainissement, Rue Pasteur, Jarnac.
**Référence (Phase A)** : 72 éléments + 4 photos, extraits indépendamment du PDF source.
**MemorIA (Phase B)** : 104 propositions, 113 evidence, 29 proposalEvidenceLinks — sortie pipeline réelle, non modifiée.

## Constat global

Ce document a le ratio propositions/référence le plus élevé du corpus : **104/72 = 1,44x**. L'examen élément par élément montre que ce n'est **pas** un problème de sur-extraction hallucinatoire :

- **0/72 élément de référence manqué** (0 MISSED).
- **52/72 MATCHED** directement, **1/72 PARTIAL** (un attribut de statut erroné), **19/72 MISCLASSIFIED** (contenu correct, mauvaise famille).
- **0 faux positif de contenu** parmi les 104 propositions : chaque proposition non appariée à un élément de référence renvoie à un passage réel et vérifiable du PDF.

La cause principale du ratio (~62 % de l'écart de 32 propositions) est un choix de granularité : la famille `person` extrait la totalité du roster de présence (22 personnes réelles, vérifiées page 1, tableau de présence), alors que la référence Phase A n'a retenu que 2 personnes notables (le rédacteur et un demandeur explicite). Le reste de l'écart vient de faits administratifs réels du préambule page 2 (10 `knowledge_fact`), de 2 observations liées au rabotage/HAP, et d'une action distincte sur un plan de coupure.

## Recall et précision par famille

| Famille | Réf. totale | Matched | Partial | Recall | Propositions | Legit. extra | Faux positifs | Précision |
|---|---|---|---|---|---|---|---|---|
| company | 7 | 7 | 0 | 100 % | 7 | 0 | 0 | 100 % |
| person | 2 | 1 | 1 | 75 % | 22 | 20 | 0 | 100 % |
| deadline | 8 | 6 | 0 | 75 % | 7 | 0 | 0 | 100 % |
| knowledge_fact | 22 | 21 | 0 | 95,5 % | 39 | 10 | 0 | 100 % |
| observation | 16 | 12 | 0 | 75 % | 23 | 2 | 0 | 100 % |
| action | 13 | 5 | 0 | 38,5 % | 6 | 1 | 0 | 100 % |
| decision | 4 | 0 | 0 | 0 % | 0 | 0 | 0 | n/a |

Précision = 100 % sur toutes les familles actives : aucune proposition n'est un faux positif de contenu. Les recalls les plus bas (`action` 38,5 %, `decision` 0 %) ne traduisent pas une perte de contenu mais une dérive de classification — voir ci-dessous.

## Biais systématiques identifiés

**1. Dérive action → observation (8 cas).** E13 à E18, E20 et E65 sont des documents administratifs à produire par SOGEA (DICT, PPSPS, constat d'huissier, fiches produits, planning, arrêté de circulation) ou une confirmation d'état de vannes. La référence les classe `action` ; MemorIA les classe systématiquement `observation`. Contenu identique, famille différente.

**2. Famille decision jamais utilisée (4 cas).** E41, E46, E47, E51 sont des validations techniques actées en réunion (validation mairie, validation culotte PVC, validation PVC 75 mm, validation reprise branchements en Y). La référence les classe `decision` ; MemorIA les classe `knowledge_fact`. Sur les 104 propositions produites pour ce document, **aucune n'utilise la famille `decision`** — signal structurel, pas une erreur isolée.

**3. Fuite deadline → knowledge_fact (2 cas) et inverse (1 cas).** E23 et E24 (échéances semaine 21 / semaine 27) sont classées `knowledge_fact` sans `dueDate` côté MemorIA. À l'inverse, E48 illustre un **biais de sur-précision temporelle** : la référence laisse volontairement "fin juin" non converti (intervention "envisagée" = incertaine, `observation`), alors que MemorIA convertit en `dueDate` ferme (2023-06-30) et classe en `deadline`.

**4. Fuites croisées observation ↔ knowledge_fact (5 cas).** E36, E38, E45, E61 : contenu correct, famille attendue échangée avec la famille voisine (échéance vague classée fait plutôt qu'observation, ou inversement).

**5. Bug de statut suspecté sur la famille person.** `pers-m-charrier` (E26, verdict PARTIAL) porte `statusAtDocumentDate = "présent"` côté MemorIA, alors que le tableau de présence du PDF (marqueur "E") et la référence indiquent "excusé". Ce champ est probablement figé par défaut plutôt que lu depuis le marqueur réel — à vérifier sur les 20 autres personnes extraites en LEGITIMATE_EXTRA, qui portent potentiellement le même biais.

## Doublons internes à MemorIA

Deux paires signalées, de nature différente :

| Paire | Verdict | Explication |
|---|---|---|
| `kf-poursuite-pose-conduites-rue-pasteur-p3` (= E35) / `kf-poursuite-pose-conduites-75ml-p4` | **Duplication réelle** | Même fait (poursuite de pose des deux conduites distribution/suppression) extrait deux fois, depuis deux états temporels imbriqués dans le même CR : l'état daté 09/06/2023 (page 3, "jusqu'au N°39") et l'état daté 02/06/2023 (page 4, métrique "75 ml"). Le document contient deux sous-rapports datés différemment — le doublon est explicable par la structure du document, pas par une erreur d'extraction aléatoire. |
| `obs-gestion-hap-rabotage-p3` / `obs-stockage-rabotage-hap-a-realiser-p4` | **Proximité thématique, pas duplication stricte** | Les deux propositions décrivent des faits distincts (rabotage de la première phase avenue Général Leclerc vs stockage du rabotage au niveau des réservoirs de la phase actuelle). Signalé par prudence, à traiter comme deux faits réels plutôt qu'un doublon. |

Un cas de **fusion légitime** (E10+E11, deux ordres de service regroupés en une seule proposition) et un cas de **scission légitime plus fine** que la référence (E66, une légende à 3 valeurs — bouche à clé ronde/carrée/hexagonale — scindée en 3 propositions distinctes) ont aussi été identifiés. Aucun duplicata n'a été trouvé dans la famille `person` malgré son volume (22 propositions).

## Section spéciale — Photos

**8 images extraites côté MemorIA vs 4 photos de référence — ratio 2x.** Décomposition complète :

| Origine | Nombre | Nature |
|---|---|---|
| Correspondances réelles aux 4 photos de référence | 4 | Photos de chantier page 6 |
| Faux positif | 1 | Logo institutionnel Grand Cognac, en-tête page 1 |
| Images réelles hors périmètre "photo terrain" | 3 | 1 plan de localisation (p.2) + 2 schémas techniques d'avancement (p.3) |

Les 3 images hors périmètre sont du contenu réel et légitime, mais `evidence_type=image` les classe indistinctement avec les vraies photos de chantier au lieu de les distinguer en tant que plans/schémas — ce qui explique la moitié du ratio 2x.

**Correspondance photo par photo (page 6, grille 2x2)** :

| Réf. | Légende référence | Qualité côté MemorIA |
|---|---|---|
| JAR_01-P01 | Antenne Rue de la Côte | Tronquée mais reconnaissable ("Antenne") |
| JAR_01-P02 | Terrassement rue St Dominique | Tronquée mais reconnaissable ("Terrasse") |
| JAR_01-P03 | Pose des réseaux en cours | Image correctement isolée, **caption vide** |
| JAR_01-P04 | Maintien de la propreté à l'avancement | Image correctement isolée, **caption erronée** ("Terr", fragment d'une autre légende — probable erreur d'association bbox/légende lors du découpage de la grille) |

Les 4 photos de référence sont donc **MATCHED** (0 MISSED), mais avec une qualité de légende dégradée sur 3 des 4 correspondances lorsqu'on regarde les images individuelles. Un filet de sécurité existe : l'evidence de type `page_snapshot` (capture entière de la page 6) porte les 4 légendes complètes et correctement associées dans un seul champ caption combiné — MemorIA a donc capturé l'information textuelle correcte au niveau page, mais la perd partiellement lors du découpage par image individuelle.

## Éléments manqués

Aucun. 0 élément de référence sur 72 est MISSED.

## Synthèse

Sur JAR_01, le ratio 1,44x n'indique pas une dérive qualité : c'est un pipeline à haut recall (aucun contenu réel perdu) et haute précision (aucune invention détectée), dont l'écart de volume s'explique par (1) un choix de granularité plus fin sur les personnes présentes, (2) des faits administratifs de préambule réels non retenus en Phase A, et (3) une frontière de classification `action`/`observation` et `decision`/`knowledge_fact` à resserrer — la famille `decision` n'étant simplement jamais déclenchée par le pipeline sur ce document. Le point le plus actionnable est le bug de statut suspecté sur `statusAtDocumentDate` dans la famille `person`, à vérifier sur un échantillon plus large avant de le considérer comme un défaut structurel.