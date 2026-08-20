# Rapport de qualification — OPC_003

Document : CCTP (Cahier des Clauses Techniques Particulières, intitulé par erreur « Cahier des Clauses Administratives Particulières » en page de garde) d'un marché public de prestations intellectuelles pour une mission OPC (Ordonnancement, Pilotage, Coordination) — construction d'une bibliothèque et réhabilitation de l'ancienne mairie de Maromme (76), mars 2011. Document de consultation antérieur à la désignation du titulaire OPC : pas de personnes physiques nommées, formules génériques « l'OPC » / « le prestataire », et une majorité du contenu (pages 4 à 9) constituée d'obligations contractuelles génériques et récurrentes du futur titulaire.

- Référence (lecture indépendante) : 32 éléments texte + 1 photo (logo institutionnel décoratif, page 1)
- MemorIA (pipeline de production réel) : 17 propositions + 17 evidence texte, 0 evidence image, `proposalEvidenceLinks` vide

## Résultats par famille

| Famille | Éléments réf. | Recall | Propositions MemorIA | Précision |
|---|---|---|---|---|
| company | 4 | **100 %** (4/4 MATCHED) | 4 | **100 %** |
| deadline | 2 | **100 %** (2/2 MATCHED) | 2 | **100 %** |
| knowledge_fact | 26 | **15,4 %** (4 MATCHED, 22 MISSED) | 11 | **100 %** |
| person / decision / action / observation / reservation | 0 | -- | 0 | -- |

**Global** : recall = **10/32 MATCHED (31,25 %)**, 0 PARTIAL, 22 MISSED, 0 MISCLASSIFIED. Précision = **17/17 vrais positifs (100 %)**, 0 faux positif, 0 legitimate_extra.

C'est, à ce jour, le recall le plus bas du corpus qualifié — mais pour une raison structurelle précise, pas pour une confusion de classification.

## Cause du recall bas : lacune de couverture par page, pas une erreur de classification

Les 17 propositions MemorIA proviennent exclusivement des **pages 3 et 10** du PDF (document de 10 pages). Les pages 1, 2 et 4 à 9 n'ont produit **aucune proposition**, alors qu'elles contiennent 22 des 26 éléments knowledge_fact de la référence :

- Page 1-2 : objet du marché, mode de passation (E01, E02).
- Pages 4 à 9 : l'intégralité du corps du CCTP décrivant les obligations du futur titulaire OPC par phase (étude, DCE/ACT, préparation, exécution, livraison) — E06 à E24, soit 19 éléments.
- Page 10 (fin) : clause de visa de l'opérateur économique (E32).

Le bloc pages 4-9 est précisément la section que la référence a classée `knowledge_fact/permanent_instruction` — des clauses contractuelles génériques et récurrentes, volontairement distinguées des faits d'avancement réels de chantier. La tâche demandait explicitement de vérifier que MemorIA ne confond pas ces clauses avec des faits métier réels : sur ce point, **aucune contamination n'a été observée** (aucune de ces clauses n'a été forcée en `action` ou `decision`), mais ce résultat doit être lu avec prudence — MemorIA n'a pas mal classé ce contenu, il ne l'a simplement **pas extrait du tout**. Le test de discrimination knowledge_fact/permanent_instruction vs action/decision n'a donc réellement porté que sur les pages 3 et 10, pas sur l'ensemble du document.

## Faux positifs

**0.** Les 17 propositions MemorIA correspondent toutes à un élément réel de la référence. `unmatchedProposals` est vide.

## Éléments manqués

**22**, tous en famille knowledge_fact : E01, E02 (objet/mode de passation, pages 1-2), E06 à E24 (obligations contractuelles par phase, pages 4-9), E32 (visa opérateur économique, page 10). Impact majeur sur le recall global, mais contenu de nature contractuelle générique (pas de fait daté, pas de nom propre, pas de décision effective) — cohérent avec la lecture de la référence elle-même qui qualifie ce bloc de clauses récurrentes plutôt que d'événements.

## Fidélité factuelle — point positif notable

Contrairement au faux positif observé sur LRM_01 (un jour calendaire fabriqué pour une date mois/année), les deux échéances de ce document sont encodées par MemorIA avec la granularité exacte de la source :
- Démarrage des travaux : `dueDate = "2011-10"` (texte source : « Octobre 2011 »)
- Livraison de l'opération : `dueDate = "2013-04"` (texte source : « Avril 2013 »)

Aucun jour n'est inventé. Comportement conforme à la doctrine anti-faits-fictifs, à l'inverse du cas déjà documenté sur LRM_01.

## Classification métier

0 MISCLASSIFIED sur les éléments appariés. Deux points de vigilance mineurs, sans changement de famille :
- **Perte de granularité de rôle** : Veritas (Coordonnateur SPS) et DEKRA (Contrôleur technique + S.S.I) sont tous deux réduits au `companyRole` générique « partenaire » côté MemorIA, alors que la référence conserve le rôle métier spécifique donné par le CCTP. La famille `company` reste correcte dans les deux cas.
- **Écart de libellé sans impact** : « MAIRIE DE MAROMME » (MemorIA) vs « VILLE DE MAROMME » (référence, dénomination exacte du CCTP) — même entité maître d'ouvrage.

## Biais récurrents

1. **Lacune de couverture par page (biais dominant et nouveau)** : sur ce document, MemorIA n'a traité que 2 des 10 pages (3 et 10), ignorant intégralement un bloc de 6 pages consécutives (4-9) qui concentre l'essentiel du contenu contractuel. À investiguer : limite de pagination, coût/troncature du prompt d'extraction, ou décision du modèle de ne pas extraire un contenu jugé trop générique/répétitif sur cette longueur de document.
2. **Sur-fragmentation systématique**, cohérente avec le reste du corpus : E04 (tranche ferme, 1 élément) éclaté en 4 propositions ; E29 (SHON/ERP/coûts, 1 élément) éclaté en 5 propositions. Aucune perte de contenu dans les deux cas.
3. **Genericisation des rôles d'intervenants secondaires** (SPS, contrôle technique) vers une étiquette « partenaire » unique — à surveiller si l'app affiche ce rôle à l'utilisateur.

## Photos

Référence : 1 photo (logo institutionnel décoratif de la Ville de Maromme, page 1, rôle `decorative`, jugée non probatoire par la référence elle-même). MemorIA : 0 evidence image, 17 evidence toutes `text_excerpt`. Cohérent, aucune perte de contenu substantiel.
