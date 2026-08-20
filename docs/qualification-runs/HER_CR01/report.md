# Rapport de qualification — HER_CR01

Document : compte-rendu d'une seule page (chantier 002, Héricy — Place du Clos), daté du 20 septembre 2018. Travaux de voirie/aménagement urbain avec fouilles archéologiques préalables (INRAP). Contenu presque exclusivement organisationnel : plan de stationnement provisoire en 5 zones, restrictions de circulation, dispositif pour le marché de Noël, entrée de l'école, une seule date calendaire ferme (démarrage de la 1e phase le 1er octobre 2018). Aucune observation de terrain, une seule personne nommée (Mr Morel), une seule organisation nommée par sigle (INRAP), « la Mairie » citée à plusieurs reprises sans rôle contractuel formalisé.

- Référence (Phase A) : 20 éléments texte, 0 photo.
- MemorIA (Phase B, pipeline de production réel) : 16 propositions, 16 evidence texte, 0 evidence image, `proposalEvidenceLinks` ne contient qu'1 lien (sur les 16 propositions).

## Résultats par famille

| Famille | Éléments réf. | Recall strict | Propositions MemorIA | Precision stricte |
|---|---|---|---|---|
| person | 1 | **0 %** (0/1, 1 MISSED) | 0 | N/A |
| company | 2 | **0 %** (0/2, 2 MISSED) | 0 | N/A |
| deadline | 4 | **100 %** (4/4 MATCHED) | 4 | **100 %** |
| decision | 9 | **11 %** (1/9 MATCHED, 8 MISCLASSIFIED) | 1 | **100 %** |
| action | 2 | **50 %** (1/2 MATCHED, 1 MISCLASSIFIED) | 1 | **100 %** |
| reservation | 1 | **0 %** (0/1, 1 MISCLASSIFIED) | 0 | N/A |
| knowledge_fact | 1 | **0 %** (0/1 MISSED) | 10 | **0 %** (10/10 MISCLASSIFIED) |
| observation | 0 | -- | 0 | -- |

**Global (strict, famille correcte exigée)** : recall = **6/20 MATCHED (30 %)**, 0 PARTIAL, 10 MISCLASSIFIED, 4 MISSED. Precision = **6/16 vrais positifs (37,5 %)**, 10 MISCLASSIFIED, 0 faux positif, 0 legitimate_extra.

**Global (contenu retrouvé, famille ignorée)** : recall = **16/20 (80 %)**, precision = **16/16 (100 %)**. Autrement dit : le pipeline retrouve la quasi-totalité du contenu du document et ne fabrique aucun fait étranger au texte, mais range ce contenu dans la mauvaise famille métier une fois sur deux, et vide entièrement deux familles (person, company).

C'est un profil très différent de LRM_01 : là où LRM_01 échouait peu sur la classification et un peu sur la précision temporelle, HER_CR01 échoue massivement sur la classification (family) tout en gardant une fidélité de contenu quasi parfaite.

## Fidélité factuelle

Distincte de la classification : 3 des 4 propositions `deadline` encodent un `dueDate` ISO précis alors que le texte source ne fournit que des expressions ambiguës ou relatives.

- **E01** (rebouchage des tranchées) : `dueDate=2018-09-27`. Le texte dit « jeudi 27 et/ou vendredi 28 septembre » — deux dates alternatives explicites, sans tranchage. MemorIA retient l'une des deux sans signaler l'ambiguïté ; la référence avait délibérément laissé `deadlineDate` à `null`. Sévérité modérée : la date choisie figure littéralement dans le texte, ce n'est pas une invention pure, mais l'ambiguïté documentée est supprimée.
- **E10** (ouverture du parking du Clos) : `dueDate=2018-09-28`. Le texte dit seulement « fin de semaine prochaine ». Aucune date calendaire n'apparaît dans le document — fabrication par calcul (vraisemblablement : vendredi suivant la réunion du 20 septembre 2018).
- **E15** (fléchage) : `dueDate=2018-09-28`. Le texte dit seulement « la semaine prochaine ». Même schéma, avec **exactement la même date calculée** que E10.

La coïncidence E10/E15 (même date fabriquée pour deux expressions relatives distinctes) suggère une résolution automatique et systématique des expressions temporelles relatives en date calendaire absolue, sans expression d'incertitude — à l'opposé de la discipline montrée par la référence Phase A, qui laisse `deadlineDate` à `null` dans ces trois cas précis.

Aucune autre fabrication détectée : pas de personne, société ou montant inventé.

## Faux positifs

**Aucun.** `unmatchedProposals` est vide : les 16 propositions MemorIA correspondent toutes à du contenu réel du document, sans exception. Ce document ne présente donc ni FALSE_POSITIVE ni LEGITIMATE_EXTRA — situation inverse de LRM_01, où existait un faux positif net (date fabriquée sur une proposition non appariée).

## Éléments manqués

**4 sur 20**, concentrés sur les familles person, company et le seul knowledge_fact réel du document :

- **E17** — Mr Morel (person) : son nom apparaît en incise dans la description de la proposition `kf-entree-ecole-p1`, mais aucune proposition de famille `person` n'a été créée. 0 proposition person sur l'ensemble du document.
- **E18** — INRAP (company) : le sigle apparaît dans l'excerpt de `kf-condition-inrap-p1`, mais aucune proposition de famille `company` n'a été créée. 0 proposition company sur l'ensemble du document.
- **E20** — la Mairie (company) : mentionnée à plusieurs reprises (cour de la Mairie, élus et agents, site internet) dans plusieurs propositions knowledge_fact, mais jamais extraite comme entité `company` dédiée.
- **E19** — procédure récurrente (knowledge_fact) : « réunion de chantier chaque jeudi, compte rendu publié sur le site de la mairie ». Aucune proposition ni evidence ne couvre ce passage — angle mort complet, alors même que la famille knowledge_fact est par ailleurs sur-représentée (10 propositions) pour du contenu qui n'en est pas.

## Biais récurrents

1. **`knowledge_fact` utilisée comme famille fourre-tout.** Sur les 10 propositions classées `knowledge_fact`, **aucune** ne correspond à un véritable élément knowledge_fact de la référence : 8 correspondent à des `decision` (E05, E06, E07, E08, E09, E13, E14, E16), 1 à une `action` (E11), 1 à une `reservation` (E03). Le seul vrai knowledge_fact du document (E19) est manqué. C'est le biais dominant de ce document : le contenu est presque intégralement retrouvé (80 % en comptage brut), mais la classification métier est en échec sur la quasi-totalité des decisions.
2. **Familles person et company totalement vides.** 0 proposition dans ces deux familles malgré 3 entités nommées identifiables dans le texte (Mr Morel, INRAP, la Mairie). Contrairement à LRM_01 où person/company atteignaient 100 % de recall, ce document montre un échec complet sur ces deux familles — à surveiller sur d'autres CR courts à faible densité nominative.
3. **Fabrication de précision temporelle sur les expressions relatives.** 3 des 4 deadlines encodent une date ISO absente ou partiellement absente du texte (voir section Fidélité factuelle) ; 2 d'entre elles partagent une même date calculée, signe d'un mécanisme de résolution systématique plutôt que d'erreurs isolées. Même famille de biais que documentée sur LRM_01 (deadline-startdate-p1), mais ici le phénomène touche des propositions correctement classées et appariées, pas des doublons inter-famille.

## Photos

Référence : 0 photo. MemorIA : 0 evidence de type image, 16 evidence toutes `text_excerpt`. Cohérent avec un document d'une seule page, texte seul, sans mise en page illustrée — pas de comparaison photo détaillée nécessaire.