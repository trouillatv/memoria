# Rapport de qualification — LRM_CR04

Document : compte-rendu de chantier n°04 (restauration eglise, 16/09/2014), tranche ferme en cours + travaux projetes sur tranches conditionnelles. CR dense : listes de presence, rappels CCTP par lot (pages 5-6), calendrier des tranches (semaines/quinzaines, pas de dates exactes), decisions techniques sur les couvertures/versants, reserves conditionnelles ("a priori"), nombreuses actions de protection/evacuation d'objets avant travaux, aucune photo.

- Reference (Phase A) : 85 elements texte, 0 photo
- MemorIA (Phase B, pipeline de production reel) : 67 propositions + 67 evidence texte (100 % `text_excerpt`), 0 evidence image, `proposalEvidenceLinks` = 27 liens `supports`

## Resultats par famille

| Famille | Elements ref. | Recall | Propositions MemorIA | Precision |
|---|---|---|---|---|
| person | 13 | **92 %** (12/13 MATCHED, 1 MISSED) | 12 | **100 %** |
| company | 12 | **92 %** (11/12 MATCHED, 1 MISSED) | 11 | **100 %** |
| deadline | 12 | **38 %** (3 MATCHED, 3 PARTIAL, 5 MISCLASSIFIED, 1 MISSED) | 6 | **100 %** |
| decision | 10 | **0 %** (10/10 MISCLASSIFIED) | 0 | N/A |
| action | 19 | **100 %** (19/19 MATCHED) | 25 | **100 %** |
| observation | 4 | **0 %** (2 MISCLASSIFIED, 2 MISSED) | 0 | N/A |
| reservation | 5 | **10 %** (1 PARTIAL, 4 MISCLASSIFIED) | 0 | N/A |
| knowledge_fact | 10 | **5 %** (1 PARTIAL, 9 MISSED) | 13 | **100 %** |

**Global** : 45 MATCHED, 5 PARTIAL, 14 MISSED, 21 MISCLASSIFIED sur 85 (recall strict ≈ 56 %). Contenu reellement detecte (MATCHED + PARTIAL + MISCLASSIFIED) = 71/85 ≈ 84 %. Precision = **62/62 vrais positifs (100 %)**, 0 faux positif, 0 legitimate_extra.

Ce document est le premier du corpus a montrer un ecart aussi net entre "detection de contenu" (bonne, 84 %) et "classification metier" (mediocre, 56 %) : la matiere est presente mais rangee au mauvais endroit.

## Faux positifs

**Aucun.** `unmatchedProposals` est vide : les 67 propositions de MemorIA (12 person + 11 company + 6 deadline + 25 action + 13 knowledge_fact) tracent toutes vers un contenu reel de la reference. Precision globale = 100 %.

## Elements manques

**14 elements sans aucune trace dans la sortie MemorIA :**
- E13 / E70 — Guylaine Duport (economiste), presence mentionnee R.A.S. : absente partout (aucune occurrence de "Duport").
- E24 — CCA, entreprise ayant realise la couverture des travees 1&2 en 1995 : jamais extraite comme entite autonome (seulement mentionnee au fil du texte de deux knowledge_fact).
- E37 / E85 — clause administrative "8 jours" (approbation tacite du CR), doublon volontaire de la reference : absente des deux cotes de son double codage.
- E69 — goujons / relevès precis, surveillance de l'evolution (observation) : aucune proposition ne la couvre.
- E76 a E82 — bloc quasi complet des knowledge_fact "documentaires" : cadrage general du PV, travaux projetes (5 puces), rappels de perimetre contractuel CCTP Lot 1 a Lot 5 (pages 5-6).
- E84 — liste DESTINATAIRES (Conservateur MH, Conservateur Archeologie, ABF).

C'est un angle mort systematique sur le knowledge_fact "administratif/documentaire" (cadrage, perimetre contractuel, destinataires) : 9 des 10 elements knowledge_fact de la reference sont MISSED, alors que les 13 knowledge_fact produits par MemorIA viennent tous d'ailleurs (voir biais ci-dessous).

## Legitimate extra

**Aucune.** Coherent avec `unmatchedProposals` vide : pas de contenu extrait par MemorIA qui ne corresponde a aucun element de reference.

## Biais recurrents

1. **Effondrement des familles decision / observation / reservation.** MemorIA n'emet ZERO proposition dans ces 3 familles sur ce document. Les 19 elements de reference correspondants (10 decision, 4 observation, 5 reservation) sont integralement reroutes ailleurs : la quasi-totalite vers `knowledge_fact` (13 cas), quelques-uns vers `action` (4 cas, decisions a formulation imperative forte type "prevoir X"). Resultat : recall = 0 % pour decision et observation, 10 % pour reservation, alors que le contenu est presque toujours present (MISCLASSIFIED, pas MISSED).
2. **Knowledge_fact = fourre-tout, pas la famille documentaire attendue.** Corollaire du point 1 : les 13 knowledge_fact produits ne correspondent a AUCUN des 10 knowledge_fact reels de la reference (rappels CCTP, cadrage, destinataires) — ces derniers sont MISSED a 90 %. La famille knowledge_fact sert ici de destination par defaut pour du contenu decision/observation/reservation mal etiquete, pas pour capturer le "cadrage documentaire" du CR.
3. **Fabrication de precision temporelle sur les 3 seules dates non triviales.** E29/E30/E31 (montage echafaudages int./ext., etude polychromies) : la source ne donne que "debut/fin/derniere semaine d'Octobre 2014", MemorIA invente un jour calendaire exact (`dueDate`) dans chacune des 3 propositions. Meme famille de biais que sur LRM_01, mais plus grave ici : ce n'est pas un doublon en trop, c'est la SEULE proposition disponible pour ces echeances qui est ainsi fragilisee.
4. **Perte de la nuance conditionnelle.** Les decisions "a priori"/conditionnelles que la reference double-code volontairement en decision+reservation (E38/E73, E47/E72) sont capturees par MemorIA comme une seule proposition knowledge_fact qui presente la solution comme actee, sans reprendre le caractere provisoire ("a priori", "on ne pourra pas gagner en epaisseur").
5. **Dispersion d'un fait administratif unique en fragments person.** Le tableau recapitulatif entreprises/coordonnees (E83, knowledge_fact) n'est pas capture comme un objet unique : ses telephones/emails se retrouvent eclates dans les champs description de 7 propositions person distinctes.

## Photos

Reference : 0 photo. MemorIA : 0 evidence de type image, 67 evidence toutes `text_excerpt`. Aucune divergence ; coherent avec les readerNotes de la reference (document sans photo). Pas de comparaison photo detaillee requise pour ce document.
