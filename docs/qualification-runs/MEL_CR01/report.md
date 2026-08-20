# Rapport de qualification — MEL_CR01

Document : compte-rendu de reunion de suivi de chantier VRD (reseaux eau/assainissement, Melay), LOT 1 et LOT 2 attribues a STPI. Feuille de presence detaillee (14 personnes), tableau des entreprises (9), plusieurs OS/notifications de marche dates, constats d'avancement chiffres par lot, questions techniques ouvertes (forage dirige, encorbellement sous dalot), decisions actees par les elus, deux echeances (reunion publique 07/12, visite chantier 13/12), clauses administratives recurrentes de fin de CR. Aucune photo.

- Reference (Phase A) : 59 elements texte (E01-E59), 0 photo
- MemorIA (Phase B, pipeline de production reel) : 59 propositions + 69 evidence texte (0 evidence image), `proposalEvidenceLinks` ~10 entrees

## Resultats par famille

| Famille | Elements ref. | Recall | Propositions MemorIA | Precision |
|---|---|---|---|---|
| person | 14 | **100 %** (14/14 MATCHED) | 14 | **100 %** |
| company | 9 | **100 %** (9/9 MATCHED) | 9 | **100 %** |
| deadline | 3 | **33 %** (1 MATCHED, 2 MISCLASSIFIED) | 3 | **100 %** |
| decision | 6 | **67 %** (4 MATCHED, 2 MISCLASSIFIED) | 5 | **100 %** |
| action | 7 | **100 %** (7/7 MATCHED) | 8 (1 legitimate_extra) | **100 %** |
| observation | 8 | **25 %** (2 MATCHED, 6 MISCLASSIFIED) | 3 | **100 %** |
| knowledge_fact | 12 | **50 %** (6 MATCHED, 3 MISSED, 3 MISCLASSIFIED) | 17 | **100 %** |
| reservation | 0 | N/A | 0 | N/A |

## Global

**Recall** = **43/59 MATCHED (73 %)**, 0 PARTIAL, 3 MISSED (5 %), 13 MISCLASSIFIED (22 %). Aucun contenu n'est totalement perdu au-dela des 3 MISSED : les 13 MISCLASSIFIED correspondent a du contenu reellement capture mais range dans une famille metier differente de celle de la reference.

**Precision** = **58/59 vrais positifs (98 %)**, **0 faux positif** (aucune donnee fabriquee ou dupliquee sans base reelle dans le contenu des propositions), 1 legitimate_extra exclue du calcul.

Meilleur resultat de precision du corpus a ce stade (0 FP, egal a LRM_01), mais recall nettement plus faible que LRM_01 (73 % vs 96 %) — l'ecart s'explique integralement par la classification de famille, pas par une perte de contenu.

## Faux positifs

**0 sur le plan du contenu.** Aucune proposition ne fabrique une donnee (date, nom, chiffre) absente du document source.

Deux points de vigilance documentes separement car ils ne sont pas des fabrications de *contenu textuel* mais des fabrications de *metadonnee structuree* :

1. **Invention de responsable (linkedActorTemporaryKey) sur 4 actions a responsable non nomme.** La reference laisse explicitement `responsible: null` par rigueur epistemique sur E39 (documents a fournir LOT 1), E46 (sondages avant forage dirige) et E52 (murs parcelle 166), et sur E56 (planning LOT 2) car le terme « mandataire » n'est jamais explicitement rattache a STPI dans le texte source. MemorIA assigne `linkedActorTemporaryKey="c-stpi-p1"` (STPI) sur ces 4 elements. Le cas **E56 est le plus explicite** : la description de la proposition ecrit litteralement « Le planning du LOT 2 est a fournir par le mandataire (STPI) », nommant STPI en toutes lettres dans un contenu jamais rattache a STPI dans le document. A l'inverse, sur E41 et E44 (le mot « mandataire » apparait sans action associee), MemorIA n'assigne aucun responsable — la fabrication est correlee au couple action+linkedActorTemporaryKey, pas a la simple presence du mot « mandataire ».
2. **Statuts de presence inverses ou inventes.** E03 (Thabourin) : reference « absente » (case cochee explicitement) -> MemorIA « present », soit l'inverse. E08 (M. MAIRE) : reference « convoque, non marque present » -> MemorIA « present », contredisant la case documentaire. E02 (Mazelin) et E09 (Henriot) : reference laisse le statut indetermine (aucune case exploitable) -> MemorIA tranche « absent » sans base documentaire. Le champ family/label reste correct dans les 4 cas (statut MATCHED), c'est une fabrication de metadonnee distincte du probleme de responsable.

## Elements manques

**3, tous de meme nature.** Les clauses administratives recurrentes de fin de CR : E25 (CR repute approuve sans contestation du MO sous 8 jours), E26 (diffusion des CR uniquement par courriel), E27 (diffusion aux sous-traitants a la charge des entreprises). Recherche exhaustive confirmee dans le fichier de sortie (aucune occurrence de « 8 jours », « courriel », « sous-traitants », « Nota »). Meme angle mort deja documente sur LRM_01-E19 (clause d'approbation de CR) — schema recurrent du corpus sur les clauses procedurales de fin de document.

## Legitimate extra

1 proposition correspond a du contenu reel du document que la reference Phase A n'avait pas isole comme element propre :
- « ARTELIA doit diffuser les visas » (id `7ae88d97-80d8-40f9-a004-044646d907d2`, famille action) — correspond a l'evidence texte reelle « ARTELIA Diffuser les visas » (page 3, evidence id `8cd31615`), vraisemblablement la cellule « Action » du tableau de suivi accolee a la ligne des fiches materiaux LOT 1 presentees a visa (E37), que la reference avait absorbee dans le constat E37 sans l'isoler.

## Biais recurrents

1. **Confusion systematique observation -> knowledge_fact (biais dominant du document).** 6 des 8 elements de reference classes `observation` (E34, E37, E38, E40, E41, E44 — constats chiffres ou factuels instantanes) sont reclasses `knowledge_fact` par MemorIA ; seuls E35 et E45 conservent la bonne famille. Le moteur semble utiliser `knowledge_fact` comme famille par defaut pour des constats qui ne sont ni des actions, ni des decisions, ni des rendez-vous dates. C'est le biais le plus significatif de ce document, davantage que la sur-fragmentation (contrairement a l'hypothese initiale, ce document ne montre pas de sur-fragmentation dominante comme LRM_01).
2. **Confusion bidirectionnelle deadline <-> knowledge_fact et decision -> knowledge_fact (biais secondaire).** E30 et E57 (knowledge_fact en reference, faits administratifs/procedurax dates ou recurrents) deviennent des `deadline` cote MemorIA ; E54 et E55 (deadline en reference, evenements dates a venir) deviennent des `knowledge_fact`. E48 et E49 (decision en reference, options techniques actees ou a l'etude) deviennent egalement `knowledge_fact`. Cas limite notable, **E47** : la reference le classe explicitement en `knowledge_fact` en expliquant par ecrit pourquoi ce n'est PAS une decision (« ont pris note » != decision actee) ; MemorIA scinde cet element en 2 propositions qui tombent l'une en `observation`, l'autre en `decision` — reproduisant exactement l'erreur que la reference avait anticipee et evitee.
3. **Fabrication de responsable correlee au couple action+lien structure.** Cf. section Faux positifs — 4/7 elements action recoivent un lien STPI non confirme textuellement (E39, E46, E52, E56), alors que E41/E44 (memes termes ambigus, pas d'action associee) n'en recoivent aucun. Le biais ne porte pas sur la reconnaissance du mot « mandataire » mais sur le remplissage du champ structure `linkedActorTemporaryKey` quand une action est detectee.
4. **Sur-fragmentation croisee famille, cas isole.** E36 (action, extranet ACE BTP) est eclate en 1 proposition action fidele + 1 proposition knowledge_fact dupliquant le meme fait de realisation. Aucune perte de contenu, mais le fait est represente deux fois dans deux familles differentes — meme schema que documente sur d'autres documents du corpus, mais marginal ici (1 seul cas contre 6 sur LRM_01).
5. **Point positif — discipline temporelle preservee.** Contrairement a LRM_01 (date precise fabriquee pour un fait mois/annee), aucune date calendaire precise n'est inventee ici pour un fait a granularite insuffisante : E55 (« semaine 50 », pas de jour exact) reste sans `dueDate` structure cote MemorIA, exactement comme la reference laisse `deadlineDate=null` pour la meme raison.

## Photos

Reference : 0 photo. MemorIA : 0 evidence de type image, 69 evidence toutes `text_excerpt`. Convergence totale, coherente avec `readerNotes` de la reference (document purement textuel/tabulaire). Famille reservation egalement vide des deux cotes — coherent avec un chantier en phase preparatoire/administrative (LOT 1 pas demarre, LOT 2 a 0 %), aucune reception de travaux possible a ce stade.