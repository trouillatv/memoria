# Rapport de qualification — JAR_CR04

Document : compte-rendu de réunion de chantier de renouvellement de réseau AEP/assainissement à Jarnac (opération Grand Cognac, MO/MOE ; SOGEA, entreprise de travaux). 8 pages, tableau de présence dense (22 personnes, 9 entités), planning hebdomadaire au format « semaine X », 5 photos de référence pages 5-6. Document le plus long et le plus dense en volume d'éléments du lot Phase D (102 éléments de référence).

- Référence (Phase A) : 102 éléments texte + 5 photos.
- MemorIA (Phase B, pipeline de production réel) : 110 propositions (person×22, company×9, deadline×1, decision×1, action×22, observation×1, knowledge_fact×54) + 9 evidence image.

## Résultats par famille

| Famille | Éléments réf. | Recall | Propositions MemorIA | Precision |
|---|---|---|---|---|
| person | 22 | **100 %** (22/22 MATCHED) | 22 | **100 %** |
| company | 9 | **77,8 %** (7 MATCHED, 2 MISSED) | 9 | **100 %** |
| deadline | 9 | **11,1 %** (1 MATCHED, 8 MISCLASSIFIED) | 1 | **100 %** |
| decision | 2 | **50 %** (1 MATCHED, 1 MISCLASSIFIED) | 1 | **100 %** |
| action | 28 | **71,4 %** (20 MATCHED, 8 MISCLASSIFIED) | 22 | **90,9 %** |
| observation | 11 | **0 %** (0 MATCHED, 10 MISCLASSIFIED, 1 MISSED) | 1 | **0 %** |
| knowledge_fact | 21 | **81 %** (17 MATCHED, 1 MISCLASSIFIED, 3 MISSED) | 54 | **35,2 %** |

**Global** : recall = **68/102 MATCHED (66,7 %)**, 0 PARTIAL, 28 MISCLASSIFIED, 6 MISSED. Precision globale = **72/110 (65,5 %)**, mais **0 FALSE_POSITIVE** sur les 110 propositions : aucun contenu fabriqué détecté. L'écart de precision est intégralement dû à 36 inversions de famille et 2 legitimate extra dérivés de contenu réel.

## Biais dominant : deadline et observation absorbées par knowledge_fact

**Deadline (recall 11,1 %) :** 8 des 9 échéances de référence — les jalons de planning hebdomadaires au format « semaine X » et les dates de report — sont capturés mot pour mot mais rangés en `knowledge_fact` au lieu de `deadline`. Seule la date de la prochaine réunion (E01, format explicite jour+heure « vendredi 07/07/2023 9h00 ») est correctement classée. La précision de l'unique proposition `deadline` produite est de 100 % : l'échec est entièrement un problème de sous-classification, jamais de fabrication de date.

**Observation (recall 0 %) :** aucun des 11 éléments observation de référence n'est retrouvé dans la famille observation. 10 constats d'avancement/état ponctuels (dégagements, blindages, essais de pression, contrôles réalisés) sont systématiquement traités comme des faits généraux permanents (`knowledge_fact`) plutôt que comme des observations datées. L'unique proposition `observation` du document (vigilance sur la stabilité d'un immeuble) correspond en réalité à un élément `action` de référence (E73) — misclassification inverse.

**Action (recall 71,4 %, résiste mieux) :** 8 des 28 actions de référence partagent le même biais résiduel vers knowledge_fact (7 cas : E56, E58, E63, E70, E74, E76, E82) ou vers observation (1 cas : E73).

**Knowledge_fact (54 propositions, precision 35,2 %) :** panier le plus dilué du document — 34 des 54 propositions sont en réalité le contenu d'éléments deadline (8), action (9), observation (16) ou decision (1) mal rangés ici. 0 fabrication dans ces 34 cas, seulement une frontière de famille non respectée.

**2 misclassifications inverses**, à contre-courant du biais dominant : E73 (action → observation) et E90 (knowledge_fact → action, règle de répartition SOGEA/AGUR pour les compteurs) — signe que la frontière observation/action/knowledge_fact est globalement instable sur ce document, pas seulement orientée « tout vers knowledge_fact ».

## Éléments manqués (6 sur 102)

- **E02** — clause procédurale « CR réputé accepté sous 8 jours ».
- **E32, E33** — GRDF et ENEDIS (company) : cités uniquement en page 3 dans le corps du texte (contrainte de raccordement gaz, consignation câble électrique), jamais dans le tableau de présence page 1 d'où proviennent les 9 autres propositions company. MemorIA ne détecte aucune entité company en dehors du tableau de présence structuré.
- **E34** — contexte projet (aménagement voirie communal en parallèle du renouvellement réseau).
- **E53** — information générale Grand Cognac liée à l'avenue G Leclerc.
- **E80** — contrôle de potabilité en cours (le plan de coupure associé dans le même excerpt est déjà comptabilisé séparément en E67, MATCHED).

Aucun schéma commun identifié entre ces 6 manques : ce sont des phrases isolées sans reprise ailleurs dans le document.

## Faux positifs / Legitimate extra

**0 FALSE_POSITIVE.** 2 LEGITIMATE_EXTRA : un en-tête d'opération capturé comme fait autonome (page 1-2, contexte réel non retenu comme élément distinct par la référence), et une action « déposer le massif gaz » dérivée d'une annotation manuscrite visible sur la photo P05 (page 6) — contenu réel de l'image source, que la référence a documenté comme evidence photo plutôt que comme action textuelle.

## Fragmentation

8 éléments de référence fragmentés en plusieurs propositions MemorIA, cross-famille et même famille confondues :
- **Même famille (sans impact sur le recall)** : E25, E26 (2 fragments chacun, rôles MO/MOE et Mairie/Services techniques), E96 (3 fragments, légende de repérage des bouches à clé).
- **Cross-famille (verdict MISCLASSIFIED)** : E57, E59, E65 (4 fragments, le plus élevé du corpus), E74, E79 — fragmentés vers knowledge_fact.
- **Cross-famille mixte (verdict MATCHED)** : E60 — fragmenté en 1 action + 1 knowledge_fact ; compte MATCHED côté recall action car le fragment porteur du cœur de l'élément reste correctement classé.

## Photos

5 photos de référence (pages 5-6) contre 9 evidence image MemorIA. Distribution par page identique sur le périmètre couvert (2 images page 5, 3 images page 6 des deux côtés) ; MemorIA produit 4 images supplémentaires hors périmètre de la référence (pages 1-3), écart de sélection éditoriale plutôt que faux positif.

Fidélité des légendes fortement dégradée — captions MemorIA systématiquement tronquées à 1-2 mots :
- P04 « Zone de raccordement » ↔ img-p6-2 (caption tronquée « Zone ») : correspondance plausible.
- P03 « Rue Croix St Gilles » ↔ img-p6-3 (caption tronquée « Rue ») : correspondance plausible.
- P05 « Massif gaz à déposer » : aucune caption exploitable côté MemorIA (caption null), correspondance par élimination de position uniquement, non confirmée.
- P01 et P02 (page 5, référence caption identique « Dégagement des piquages » pour les deux) : 0/2 correspondance — les 2 images MemorIA portent des captions tronquées (« Continuité », « Tranch[ée] ») sans rapport textuel apparent.

Au global : 2/5 correspondances plausibles par préfixe de légende, 0/5 correspondance exacte, malgré un alignement parfait du nombre et de la page.

## Biais récurrents (cohérence avec le reste du corpus Phase D)

1. **Absorption massive de deadline et observation par knowledge_fact**, le biais le plus sévère observé sur l'ensemble du corpus Phase D en amplitude (recall 0,111 et 0,0 respectivement) — cohérent avec le même schéma déjà noté sur EAU_001, MEL_CR01/CR03, HER_CR05/CR10, mais ici sur un volume d'éléments bien plus large.
2. **0 fabrication de contenu** malgré un taux de misclassification élevé (28/102) — confirme le schéma déjà observé sur les autres documents du lot : les erreurs de ce pipeline sont des erreurs de frontière de famille, pas des hallucinations.
3. **Détection d'entités company limitée au tableau de présence structuré** — les entités mentionnées uniquement dans le corps du texte narratif (GRDF, ENEDIS) ne sont pas extraites comme entités autonomes.
4. **Fidélité de légende photo dégradée par troncature systématique**, déjà documentée sur d'autres documents du corpus (VRD_005, BTP_009) — ici aggravée par une ambiguïté totale sur 2 des 5 photos de référence.
