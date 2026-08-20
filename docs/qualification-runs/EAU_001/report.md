# Rapport de qualification — EAU_001

Document : compte-rendu de reunion de concertation du SAGE Bievre Liers Valloire (17 janvier 2012, session AEP/assainissement), anime par ACTeon. Ce n'est pas un PV de chantier BTP classique : les deux premiers tiers du document (pages 3-5) posent le cadre de gouvernance (qu'est-ce que le SAGE, role de la CLE, calendrier des 3 sessions de concertation), et les pages 6-11 restituent la discussion technique (constats des participants, pistes d'action ouvertes non arbitrees) et la liste de presence. Aucune reserve, aucun arbitrage formel sur les 17 pistes d'action : elles restent au milieu du gue, ce qui explique l'absence de la famille `reservation` cote reference.

- Reference (Phase A) : 55 elements texte + 5 photos (3 decoratives page de couverture, 2 `document_context` bandeau logos/logo ACTeon page 1)
- MemorIA (Phase B, pipeline de production reel) : 47 propositions + 43 evidence texte, 0 evidence image, 21 `proposalEvidenceLinks`

## Resultats par famille

| Famille | Elements ref. | Recall | Propositions MemorIA | Precision |
|---|---|---|---|---|
| person | 7 | **100 %** (7/7 MATCHED) | 7 | **100 %** |
| company | 6 | **83 %** (5/6 MATCHED, 1 MISSED) | 5 | **100 %** |
| deadline | 1 | **100 %** (1/1 MATCHED) | 1 | **100 %** |
| knowledge_fact | 6 | **0 %** (6/6 MISSED) | 13 | **100 %** (12 vrais positifs + 1 legitimate_extra) |
| decision | 4 | **0 %** (4/4 MISSED) | 0 | N/A |
| observation | 14 | **21 %** (3 MATCHED, 1 MISSED, 10 MISCLASSIFIED) | 21 | **100 %** |
| action | 17 | **0 %** (17/17 MISCLASSIFIED) | 0 | N/A |
| reservation | 0 | -- | 0 | -- |

**Global** : recall strict = **16/55 MATCHED (29 %)**, 0 PARTIAL, 12 MISSED, 27 MISCLASSIFIED. Si on ignore la famille et qu'on ne mesure que la capture de contenu (matched+misclassified)/total = **43/55 (78 %)**. Precision = **47/47 vrais positifs (100 %)**, 0 faux positif, 1 legitimate_extra exclue du calcul.

Le contenu metier est tres majoritairement capture (78 %), mais la classification en famille est le point de rupture principal de ce document : c'est le pire score de classification du corpus, malgre une precision et une fidelite factuelle parfaites.

## Faux positifs

**0.** Sur les 47 propositions du run, aucune ne contient de donnee fabriquee (nom, chiffre, date). La deadline unique du document (atelier du 20 mars 2012) conserve son jour exact tel que donne par la source, sans granularite inventee — contraste explicite avec le biais de date fabriquee documente sur LRM_01.

## Elements manques

**12**, concentres sur le cadrage methodologique des pages 3-5 :
- **4 decision** (E02, E05, E08, E11) — decisions de gouvernance du SAGE/CLE (creation du SAGE il y a 9 ans, strategie commune, strategies alternatives avant arbitrage, engagement de reprise des propositions des acteurs). La famille `decision` n'est utilisee 0 fois sur les 47 propositions du run.
- **6 knowledge_fact** (E03, E06, E07, E09, E10, E12) — definition du SAGE, pouvoir reglementaire, 3 livrables deja realises, 4 objectifs des reunions, trame en 3 temps, calendrier des 3 sessions de janvier. La page 4 entiere n'a produit aucune proposition ni evidence, toutes familles confondues.
- **1 company** (E04) — la CLE (Commission Locale de l'Eau) elle-meme, jamais extraite comme entite, coherent avec le trou pages 3-5 ou elle est presentee.
- **1 observation** (E40) — regret des participants sur le manque de concertation intercommunale (page 10, avec coquille source « presentent- » preservee dans la reference), alors que le contenu voisin (E41-E44) est integralement couvert.

## Legitimate extra

**1.** La proposition `cf73ceb9` (« Les marges de manoeuvre pour diminuer les prelevements de l'AEP sont assez restreintes », page 6) est une formulation proche mais distincte de la synthese de fin de reunion page 10 (« La marge de manoeuvre est plus grande sur l'amelioration de la qualite de l'eau que sur la baisse des prelevements », capturee separement dans E42). Coherent avec un document qui pose un constat en introduction de section (page 6) puis le reprend en synthese (page 10) ; aucune donnee fabriquee.

## Biais recurrents

1. **Confusion bidirectionnelle observation/action/knowledge_fact — le risque signale pour ce document, confirme et severe.** (a) Les 17 pistes d'action de la section technique (E23-E29, E31-E39, E41) sont capturees mot pour mot mais **toujours** classees `observation`, jamais `action` : la famille `action` n'est utilisee 0 fois sur les 47 propositions du run alors que 17 actions reelles existent dans le document. (b) 10 des 14 observations de reference (E14-E18, E20-E21, E30, E42-E43 — constats et positions exprimes par les participants) sont capturees mot pour mot mais classees `knowledge_fact` au lieu d'`observation`. Seules 3 observations (E19, E22, E44) et 0 action atterrissent dans la bonne famille. Le classifieur oscille entre les trois familles sans frontiere stable sur ce type de document (reunion de concertation/planification, pas de chantier physique).
2. **Trou complet sur le cadrage methodologique pages 3-5.** Les 6 knowledge_fact et les 4 decision de gouvernance sont integralement manques, la page 4 ne produisant aucune sortie de quelque famille que ce soit — alors que les pages 6 a 11 (discussion technique, pistes d'action, liste de presence) sont couvertes en quasi-totalite. Ce trou touche exactement le tiers introductif/contextuel du document.
3. **Entite de gouvernance centrale jamais extraite.** La CLE, instance pivot du document, n'apparait dans aucune proposition, y compris dans les decisions E05/E08 qui la citent comme responsable (elles-memes MISSED).
4. **Sur-fragmentation ponctuelle, sans perte de contenu.** E42 (2 propositions), E44 (2 propositions), E26 (2 propositions a cheval sur observation et knowledge_fact) — meme schema que sur les autres documents du corpus.
5. **Familles entites (person/company/deadline) epargnees.** Recall et precision proches de 100 % sur person (7/7), company (5/6, seul manque = l'institution CLE) et deadline (1/1) : le defaut de ce document est concentre sur les familles a contenu narratif (action, observation, decision, knowledge_fact contextuel), pas sur l'identification des acteurs.

## Photos

Reference : 5 photos, toutes decoratives (3, page de couverture) ou `document_context` (2, bandeau logos institutionnels + logo ACTeon, page 1) — aucune valeur probante narrative. MemorIA : 0 evidence image sur 43 evidence (toutes `text_excerpt`), 21 `proposalEvidenceLinks` non vide. Ecart nul et attendu : document sans photo de terrain ni d'ouvrage.
