# HER_CR10 — Comparaison qualification Phase C (référence vs MemorIA)

**Document** : compte-rendu de chantier d'une page (texte dactylographié, sans image), signé par Sylvie Bouchet Bellecourt, Madame le Maire.
**Référence (Phase A)** : 4 éléments, 0 photo, extraits indépendamment.
**MemorIA (Phase B)** : 4 propositions — sortie pipeline réelle, non modifiée.

## Constat global

Document très court : chaque écart pèse 25 % du score, à interpréter avec prudence statistique plutôt que comme une tendance robuste.

- **0/4 MISSED, 0/4 PARTIAL** : les 4 faits réels du document sont systématiquement retrouvés par MemorIA.
- **2/4 MATCHED** directement (decision, person), **2/4 MISCLASSIFIED** (contenu identique mot pour mot à la référence, mais rangé dans une autre famille).
- **0 donnée fabriquée** : les 4 `source_excerpt` de MemorIA sont identiques mot pour mot aux excerpts de la référence humaine. Precision de contenu (absence d'hallucination) = 100 %, à distinguer de la precision de classification = 50 % (recall global 0,5 également, par symétrie sur ce document).

## Recall et précision par famille

| Famille | Réf. totale | Matched | Misclassified | Recall | Propositions | Précision |
|---|---|---|---|---|---|---|
| person | 1 | 1 | 0 | 100 % | 1 | 100 % |
| company | 0 | 0 | 0 | n/a — aucune entreprise ni cabinet nommé (seul le rôle générique « architecte » est cité, sans nom propre), absence confirmée des deux côtés | 0 | n/a |
| knowledge_fact | 0 | 0 | 0 | n/a — aucun fait général/récurrent distinct côté référence ; MemorIA a néanmoins produit 1 proposition, qui est en réalité E01 mal classé | 1 | 0 % (l'unique proposition est le contenu réel de E01, mauvaise famille, 0 vrai positif) |
| deadline | 0 | 0 | 0 | n/a — aucune date précise dans le document (« la semaine prochaine » reste relatif, volontairement non converti) ; MemorIA n'en fabrique aucune non plus | 0 | n/a |
| decision | 1 | 1 | 0 | 100 % | 1 | 100 % |
| action | 1 | 0 | 1 | 0 % | 0 | n/a — MemorIA n'a produit aucune proposition action ; la proposition correspondante a été rangée en reservation |
| observation | 1 | 0 | 1 | 0 % | 0 | n/a — MemorIA n'a produit aucune proposition observation ; la proposition correspondante a été rangée en knowledge_fact |
| reservation | 0 | 0 | 0 | n/a — le mot « réserve » apparaît une fois mais désigne une condition de validation d'un principe d'aménagement, pas une réserve technique, exclue à dessein par la référence | 1 | 0 % (l'unique proposition est le contenu réel de E03, mauvaise famille, 0 vrai positif) |

## Biais systématiques identifiés

**1. Fuite observation → knowledge_fact (E01).** « La pose des bordures de la phase n°1 a débuté et se prolongera la semaine prochaine. » — constat d'avancement daté sans échéance chiffrée, classé `observation` en référence pour éviter d'inventer une date. MemorIA le classe `knowledge_fact` (avec `thematic_category='progress'`, `document_status='in_progress'`). Le champ structuré reste honnête (pas de date fabriquée), mais la famille choisie efface la distinction entre un constat d'avancement ponctuel et un fait général.

**2. Fuite action → reservation (E03), dans le sens inverse du biais habituel du corpus.** « sous réserve de la présentation du nouveau plan corrigé par l'architecte » — la référence classe ce passage en `action` (tâche implicite pour l'architecte, sans date) et documente explicitement, dans la classificationNote de E02, pourquoi le mot « réserve » ici n'est *pas* une réserve technique de réception de travaux. MemorIA range pourtant cette même phrase en `reservation` — exactement la confusion que la lecture de référence avait anticipée et écartée. Contenu fidèle, aucune date ni responsable inventé, mais frontière de famille franchie dans le sens contraire du biais observé ailleurs dans le corpus (VRD_002 knowledge_fact→action, IND_002 knowledge_fact→observation, JAR_01 action→observation et decision→knowledge_fact).

**3. Familles absentes des deux côtés, cohérentes.** `company` (aucune entreprise/cabinet nommé), `deadline` au sens strict (aucune date précise dans le texte, aucune fabrication contrairement à d'autres documents du corpus, ex. LRM_01 deadline-startdate-p1 ou JAR_01 E48).

## Doublons internes à MemorIA

Aucun doublon détecté.

## Section Photos

0 photo des deux côtés. Les 4 evidence de `memoria-output.json` sont toutes de type `text_excerpt` ; `proposalEvidenceLinks` ne contient qu'1 lien (E03/reservation → son propre excerpt). Cohérent avec un CR d'une page, texte dactylographié uniquement, sans image.

## Éléments manqués

Aucun. 0 élément de référence sur 4 est MISSED.

## Synthèse

Sur HER_CR10, l'écart porte entièrement sur la classification de famille (2 MISCLASSIFIED sur 4, recall global 50 %), jamais sur la détection ou la fidélité du contenu : les 4 faits réels sont retrouvés et aucun excerpt n'est fabriqué. Le cas le plus significatif pour la doctrine du projet est E03 : la lecture de référence anticipe et documente explicitement pourquoi la clause « sous réserve de... » ne doit pas être classée en famille `reservation`, et MemorIA commet malgré tout cette confusion précise — signal à surveiller sur d'autres documents contenant le même tour de phrase.
