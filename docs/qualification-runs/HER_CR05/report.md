# HER_CR05 — Comparaison qualification Phase C (référence vs MemorIA)

**Document** : compte-rendu de réunion de chantier — place du Clos, Héricy (1 page). Sujets : traitement des eaux usées/pluviales de la salle du Clos, agrandissement de puisards, intervention Véolia sur une conduite d'assainissement, alimentation de la fontaine, réaménagement d'une place PMR.
**Référence (Phase A)** : 10 éléments, 0 photo.
**MemorIA (Phase B)** : 9 propositions, 8 evidence — sortie pipeline réelle, non modifiée.

## Constat global

- **6/10 éléments de référence MATCHED**, **4/10 MISCLASSIFIED** (E01, E02, E08, E09), **0 MISSED**, **0 PARTIAL**.
- Couverture de contenu totale : les 9 propositions MemorIA correspondent chacune à un élément de référence identifiable (0 `unmatchedProposals`), 0 `FALSE_POSITIVE`, 0 `LEGITIMATE_EXTRA`, aucune hallucination détectée sur ce document d'une seule page.
- Les 4 MISCLASSIFIED portent toutes sur un contenu capturé fidèlement (excerpt identique ou mot pour mot) mais rangé dans une famille différente de celle de la référence — jamais une perte de contenu.

## Recall et précision par famille

| Famille | Réf. totale | Matched | Misclassified | Missed | Recall | Propositions | Vrai positif | Misclassified (precision) | Précision |
|---|---|---|---|---|---|---|---|---|---|
| person | 1 | 1 | 0 | 0 | 100 % | 1 | 1 | 0 | 100 % |
| company | 1 | 1 | 0 | 0 | 100 % | 1 | 1 | 0 | 100 % |
| deadline | 1 | 1 | 0 | 0 | 100 % | 1 | 1 | 0 | 100 % |
| decision | 3 | 1 | 2 | 0 | 33,3 % | 1 | 1 | 0 | 100 % |
| knowledge_fact | 4 | 2 | 2 | 0 | 50 % | 4 | 2 | 2 | 50 % |
| observation | 0 | — | — | — | n/a (0 réf.) | 1 | 0 | 1 | 0 % |
| action | 0 | — | — | — | n/a (0 réf.) | 0 | — | — | n/a |
| reservation | 0 | — | — | — | n/a (0 réf.) | 0 | — | — | n/a |

La précision de la famille `decision` reste à 100 % malgré un recall de 33,3 % : la seule proposition physique de cette famille (`dec-puisards-p1`) est un vrai positif (E03), mais elle porte aussi — sans lui donner d'existence propre — le contenu de l'élément E02 (voir note ci-dessous, non recompté au dénominateur de precision pour éviter un double comptage de la même proposition).

## Biais systématiques identifiés

**1. Frontière decision / knowledge_fact sensible à la présence d'un marqueur de validation explicite.** Sur les 3 éléments de référence en famille `decision`, seul celui portant le mot « accepté » (E03, agrandissement des puisards) est classé `decision` par MemorIA. Les 2 autres — E08 (« la fontaine sera alimentée à partir de la salle de l'Orangerie ») et E09 (« la place... devient une place sans signalétique mais reste une place prioritaire ») — tranchent bien un choix technique/administratif au présent ou futur mais sans terme de validation explicite, et sont classés `knowledge_fact/general_knowledge`. Recall de la famille `decision` : 33 % (1/3), entièrement dû à ce biais de classification, pas à une perte de contenu.

**2. Survalorisation du mot « problème » comme déclencheur de la famille observation.** La phrase d'ouverture E01 (« le problème du traitement des eaux usées... est examiné ce jour »), une simple annonce de sujet à l'ordre du jour, est classée `observation` par MemorIA alors que la référence affirme explicitement l'absence de toute observation de terrain dans ce document. Signal cohérent avec un déclenchement sur le mot « problème », indépendamment du registre réel de la phrase (méta-descriptif, pas un constat physique daté).

**3. Cas de fusion inter-éléments.** La proposition `dec-puisards-p1` (famille `decision`) regroupe dans son excerpt à la fois la règle technique permanente E02 (`knowledge_fact/permanent_instruction` : obligation de traiter les eaux pluviales sur place) et la décision E03 (agrandissement des puisards). Seule la décision reçoit une existence d'objet propre ; la règle générale n'est pas capturée comme `knowledge_fact` indépendant. Traité comme MISCLASSIFIED pour E02 plutôt que MATCHED, conformément à la doctrine (famille différente jamais comptée comme succès).

**4. Fidélité factuelle intacte.** Aucune donnée fabriquée détectée. Point positif : la date Véolia (25 octobre 2018, E05) est reprise telle quelle depuis le texte source (jour, mois et année tous explicitement présents), sans troncature ni fabrication de granularité temporelle.

**5. Pertes de précision mineures sur des champs structurés, sans impact sur la famille.** `companyRole="partenaire"` (E06, Véolia) est un libellé générique par rapport au rôle précis de la référence (« réparation ponctuelle du réseau d'assainissement »), mais la description texte reste correcte. `thematic_category="general_knowledge"` (E07, armoire électrique) diverge de `thematicCategory="progress"` côté référence, sans conséquence sur la famille.

## Doublons internes à MemorIA

Aucun doublon détecté.

## Section Photos

0 evidence de type image des deux côtés (`photos=[]` en référence, `imagesDetected=0` et 8 evidence toutes `text_excerpt` côté MemorIA) — cohérent, document d'une page sans illustration. Pas de comparaison photo à mener.

## Éléments manqués

Aucun. 0 élément de référence sur 10 est MISSED.

## Point technique hors périmètre de notation

`proposalEvidenceLinks` ne contient qu'un seul lien (`obs-eaux-usees-p1` → evidence `69daa281`) sur les 9 propositions et 8 evidence disponibles, alors que chaque proposition a un `source_excerpt` qui correspond mot pour mot à une evidence `text_excerpt` distincte. Lacune de liaison structurelle proposal↔evidence à signaler séparément — le statut `ready_for_review` du run n'est pas remis en cause, succès technique déjà acquis.

## Synthèse

Sur HER_CR05, aucun contenu réel n'est perdu (0 MISSED, 0 FALSE_POSITIVE, 0 hallucination) sur ce document court d'une seule page. Le seul défaut mesuré est un biais de classification récurrent déjà documenté sur d'autres corpus : la famille `decision` n'est déclenchée que lorsqu'un marqueur de validation explicite (« accepté ») est présent dans le texte, sinon le contenu retombe en `knowledge_fact` ; et la famille `observation` peut être déclenchée à tort par un mot comme « problème » même sur une phrase purement administrative d'ouverture de réunion. Ces deux biais expliquent la totalité des 4 MISCLASSIFIED du document.
