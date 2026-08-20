# Rapport de comparaison — LRM_CR07

CR n°07 du chantier de restauration de l'église Saint-Yves de La Roche Maurice (Finistère), 5 pages, réunion du 28/10/2014. Document dense : avancement des travaux, désordres constatés (fissures, arbalétrier cassé), décisions sur la polychromie, échéances de novembre-décembre 2014, et rappel du périmètre CCTP des 5 lots en fin de document. Aucune photographie.

- Référence : 66 éléments (8 company, 10 person, 13 knowledge_fact, 2 reservation, 3 observation, 4 decision, 4 deadline, 22 action).
- MemorIA : 108 propositions (10 company, 16 person, 48 knowledge_fact, 0 reservation, 1 observation, 4 decision, 5 deadline, 24 action), 95 evidence text_excerpt, 0 image, 25 proposalEvidenceLinks.

## Résultats par famille

| Famille | Réf. | Recall | Precision | Note |
|---|---|---|---|---|
| company | 8 | 100 % (8/8) | 100 % (8 TP, 2 extra) | 1:1 parfait |
| person | 10 | 100 % (10/10) | 100 % (10 TP, 6 extra) | 1:1 parfait |
| knowledge_fact | 13 | 69,2 % (9 matched, 3 missed, 1 misclassified) | 100 % (41 TP, 7 extra) | sur-fragmentation massive côté precision |
| reservation | 2 | 0 % (0 matched, 2 misclassified) | N/A (0 proposition) | famille absente de la sortie MemorIA |
| observation | 3 | 16,7 % (0 matched, 1 partial, 2 misclassified) | N/A (1 proposition, cross-famille) | frontière confuse dans les 2 sens |
| decision | 4 | 75 % (3 matched, 1 misclassified) | 100 % (3 TP, 1 extra) | |
| deadline | 4 | 75 % (3 matched, 1 misclassified) | 100 % (3 TP, 2 extra) | 2 des 3 matched contiennent une date fabriquée |
| action | 22 | 90,9 % (20 matched, 2 misclassified) | 100 % (20 TP, 4 extra) | |

**Global** : 53/66 MATCHED, 1 PARTIAL, 3 MISSED, 9 MISCLASSIFIED → recall ≈ 81,1 %. Precision de classification (TP/(TP+FP)) = 100 % sur toutes les familles avec TP+FP>0 : **0 proposition hallucinée** sur 108. 23 propositions LEGITIMATE_EXTRA (contenu réel non isolé par la référence, ou classées dans une autre famille que la référence).

## Faux positifs

Aucun. Les 108 propositions de MemorIA correspondent toutes à du contenu réellement présent dans le document — ni personne, société, décision ou fait inventé. Ce résultat est net et distinct des problèmes de fidélité factuelle détaillés ci-dessous, qui portent sur des propositions par ailleurs correctement appariées.

### Fidélité factuelle : deux dates fabriquées

Deux échéances sont données dans le texte source en approximation, sans jour précis (« mi-novembre », « mi-décembre 2014 ») :

- **E35** — achèvement du montage des échafaudages extérieurs « prévu pour la mi-novembre ». La référence laisse `deadlineDate: null` (aucun jour donné). MemorIA (proposition `7ced3863`) encode `dueDate: "2014-11-15"` — le jour 15 est **inventé**.
- **E36** — reprise de la voûte du bas-côté Nord « prévu achevés pour la mi-décembre 2014 ». Même situation : référence `deadlineDate: null`, MemorIA (`2c41e9f7`) encode `dueDate: "2014-12-15"` — même fabrication.

C'est exactement le même schéma que celui déjà observé sur LRM_01 (proposition `deadline-startdate-p1`, jour fabriqué pour une date en mois/année seul) : la précision inventée d'un jour calendaire non présent dans le document viole la doctrine du projet sur les faits fictifs. Deux occurrences dans ce seul CR.

**À ne pas confondre avec E23** : ce même document contient une incohérence de date qui existe *dans le texte source lui-même* (Tranche Ferme démarre le 22/09/2014 pour 7 mois, mais achèvement annoncé au « 21 avril 2014 », antérieur au début — probable erreur de millésime non corrigée par l'auteur du CR). MemorIA scinde ce constat en deux propositions (`a90c4312` knowledge_fact + `39fb9d4d` deadline), et le `dueDate: "2014-04-21"` de la seconde reproduit fidèlement la date écrite dans le document. Ce n'est pas une fabrication — transcrire fidèlement une incohérence existante est un comportement correct, à l'opposé d'E35/E36.

## Éléments manqués

- **E19** — objet du marché (« Restauration des charpentes et couvertures de la nef et des bas-côtés »), en-tête page 1.
- **E20** — date/heure de la réunion (28/10/2014 17h) et référence au CR précédent (16/10/14).
- **E61** — clause administrative de diffusion et d'approbation tacite du CR sous 8 jours. **Récurrence exacte** de l'angle mort déjà documenté sur LRM_01-E19 (même clause, même absence de proposition) — pattern maintenant confirmé sur deux documents distincts.

## Legitimate extra

13 propositions sans correspondance directe dans la référence, toutes du contenu réel non isolé comme élément propre :

- **6 person** (Philippe, Le Ber, Le Jeune, Bougeard, Egon, Maleshkorta) : représentants d'entreprise que la référence rattache volontairement à la fiche company de leur entreprise (choix méthodologique explicité dans ses `readerNotes`) plutôt que de les dupliquer en personnes.
- **2 company** (Mairie, DRAC de Bretagne) : entités que la référence ne mentionne qu'à travers les personnes qui les représentent (Forest/Fortin, Jablonski).
- **1 decision** (« Conservation des corniches peintes »), **2 action** (stockage des lambris sous Tyvek, protection de la polychromie avant dépose), **2 knowledge_fact** (dépose des lambris de la travée intermédiaire, calendrier des sondages en pied de contreforts) : contenu réel de pages 2-3 que la référence n'a pas isolé en élément propre.

## Biais récurrents

1. **Fabrication de jour calendaire sur échéances approximatives** (E35, E36) — cf. section fidélité factuelle. Confirmé récurrent avec LRM_01.
2. **Famille reservation absente de la taxonomie de sortie** : les 2 réserves de la référence (E24 fissures gouttereaux à charge du BET, E25 arbalétrier cassé) sont toutes deux reclassées — respectivement en action et en knowledge_fact. recall reservation = 0 %. La sémantique de « désordre/réserve nécessitant investigation ou levée » n'est jamais restituée comme telle.
3. **Confusion bidirectionnelle sur la frontière observation** : 2 des 3 observations de la référence (E27, E28 — hypothèses de datation, absence de polychromie constatée) sont classées knowledge_fact ; à l'inverse, l'unique proposition observation de tout le document correspond en réalité à une action de la référence (E48, « prévoir des visites de conservation »). E26 (fleurs de lys/macles des Rohan) n'est même pas isolé : son contenu est noyé dans la description d'une proposition action distincte (E53).
4. **Sur-fragmentation confirmée, sans perte de contenu** : la liste « Avancement des travaux » (E21, 8 puces) devient 8 propositions ; les 5 lots CCTP de fin de document (E62-E66) deviennent 30 propositions. Même schéma que sur LRM_01, contenu toujours complet.
5. **Granularité différente sur les représentants d'entreprise** : MemorIA systématise la création d'une fiche person pour chaque contact nommé, y compris ceux déjà couverts par une fiche company — choix défendable, mais qui multiplie les objets par rapport à la référence.

## Photos

Aucune photographie dans ce document (0 côté référence, 0 image evidence côté MemorIA sur 95 evidence, toutes text_excerpt). Cohérence totale, pas de section détaillée nécessaire.
