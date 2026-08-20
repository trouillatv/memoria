# JAR_CR02 — Comparaison qualification Phase D (référence vs MemorIA)

**Document** : compte-rendu de réunion de chantier n°2 — renouvellement réseaux eau potable / assainissement, Rue Pasteur, Jarnac (même chantier que JAR_01, CR suivant).
**Référence (Phase A)** : 102 éléments + 7 photos, extraits indépendamment du PDF source.
**MemorIA (Phase B, pipeline de production réel)** : 96 propositions, sortie pipeline réelle, non modifiée.

## Constat global

**Recall global = 67/102 MATCHED (67,2 %)** — 3 PARTIAL, 11 MISSED, 21 MISCLASSIFIED. **Précision globale = 95/96 vrais positifs de contenu (100 %)** — 0 faux positif, 1 seule proposition legitimate_extra (`comp-servicestech-p1`).

Contrairement à JAR_01 (ratio propositions/référence 1,44x, dominé par un choix de granularité sur `person`), JAR_CR02 a un ratio propositions/référence proche de 1 (96/102 = 0,94x) et **aucun problème de sur-extraction**. L'écart de recall s'explique presque intégralement par deux phénomènes distincts, non liés à une perte de contenu : une dérive massive de classification `observation → knowledge_fact`, et un préambule administratif (page 2) presque entièrement absent du pipeline.

## Résultats par famille

| Famille | Réf. totale | Matched | Partial | Missed | Misclassified | Recall | Propositions | Précision |
|---|---|---|---|---|---|---|---|---|
| company | 7 | 7 | 0 | 0 | 0 | **100 %** | 8 (1 legit. extra) | 100 % |
| person | 22 | 21 | 1 | 0 | 0 | **97,7 %** | 22 | 100 % |
| deadline | 4 | 3 | 0 | 0 | 1 | **75 %** | 7 | 100 % |
| knowledge_fact | 24 | 10 | 0 | 10 | 4 | **41,7 %** | 30 | 100 % |
| action | 28 | 21 | 1 | 1 | 5 | **76,8 %** | 23 | 100 % |
| observation | 11 | 0 | 1 | 0 | 10 | **4,5 %** | 1 | 100 % |
| decision | 6 | 5 | 0 | 0 | 1 | **83,3 %** | 5 | 100 % |
| reservation | 0 | -- | -- | -- | -- | N/A | 0 | N/A |

Précision = 100 % sur toutes les familles actives : aucune proposition n'est un faux positif de contenu. Le recall le plus bas (`observation` 4,5 %, `knowledge_fact` 41,7 %) ne traduit pas une perte de contenu mais une dérive de classification quasi systématique — voir ci-dessous.

## Biais systématiques identifiés

**1. Dérive quasi totale observation → knowledge_fact (10/11 cas, 91 %).** E55, E59, E60, E61, E63, E69, E72, E75, E78, E89 sont des constats factuels d'avancement (raccordements réalisés, repères de localisation, plan de coupure transmis, poteau incendie mis en œuvre) que la référence classe `observation`. MemorIA les classe systématiquement `knowledge_fact`. C'est le biais le plus marqué du document, plus extrême que les dérives croisées observées sur JAR_01 : ici, la famille `observation` est presque totalement absorbée par `knowledge_fact`, sans perte de contenu détectée.

**2. Préambule administratif manqué (10 des 11 éléments MISSED).** E24 (métadonnée de rédaction), E32-E37 (contexte général, quantités techniques, budget 1 138 656 €HT, dates administratives de marché/OS/DT) et E44-E45 (délais contractuels 11 mois, dates de démarrage) — tous `knowledge_fact`, tous situés dans le chapitre "Rappel de l'opération / Situation administrative" en page 2 — ne sont couverts par aucune proposition MemorIA. Seuls le jalon de reprise de pose (E49) et les compteurs d'intempéries/retards (E101-E102) de la même zone documentaire sont captés.

**3. Famille decision fiable sur ce document (5/6 = 83,3 %)**, à l'inverse de JAR_01 où elle n'était jamais déclenchée (0/4). Les formulations au futur affirmatif ("seront implantées", "seront manœuvrées") et le mot "validé(e)" sont correctement reconnues comme `decision` par le pipeline ici. Seule E77 ("vu avec la mairie", validation moins explicite) est classée `knowledge_fact`. Ce contraste confirme que le biais dominant varie selon le document — signal important pour la synthèse transversale du corpus.

**4. Deux scissions inter-familles pour un seul élément de référence (E76, E90), comptées PARTIAL.** Dans les deux cas, MemorIA scinde un élément de référence en deux propositions de familles différentes, une fraction dans la bonne famille et une fraction (majoritaire) dans une autre. Pour E90, la scission MemorIA (`kf-raccordementsneufs-p5` pour le fait acquis SOGEA + `act-fournircompteurs-p5` pour la tâche AGUR restante) reproduit fidèlement la logique de bundling que la référence elle-même documentait comme discutable.

**5. Sur-fragmentation sans perte (E96).** La légende à 3 valeurs (bouche à clé ronde=vanne / carrée=branchement / hexagonale=purge), un seul élément de référence en `permanent_instruction`, est scindée en 3 propositions `knowledge_fact` distinctes, chacune correcte en famille mais taguées `thematic_category=general_knowledge` au lieu de `permanent_instruction` — dérive de sous-classification, pas de famille principale.

**6. Anomalie de statut dérivé (E68).** `kf-raccordement150fonteprog-p4` porte `source_payload.statusAtDocumentDate='réalisé'` et `document_status='done'`, alors que le texte source décrit une action programmée à venir ("programmé pour le 13/06"). Le texte lui-même n'est pas fabriqué, mais l'attribut de statut dérivé est incohérent avec le contenu qu'il accompagne.

## Doublons internes / structure du document

Aucun doublon interne réel détecté (`duplicateProposalsWithinMemoria` vide). Le document juxtapose deux points d'avancement datés ("Au 16/06/2023" en page 3 et "Au 09/06/2023" repris du CR précédent en page 4), ce qui produit deux paires **légitimes** de propositions distinctes pour un même type de fait à deux dates différentes :

- `dead-raccordementantennes-p3` (22/06, E57) / `dead-raccordementantennes-p4` (21/06, E71)
- `kf-raccordement150fonte-p3` ("réalisé", E55) / `kf-raccordement150fonteprog-p4` ("programmé 13/06", E68)

Ce ne sont pas des doublons : chacune correspond à un élément de référence distinct. À l'inverse, la mention "désamiantage fin juin" apparaît deux fois à l'identique dans le document (pages 3 et 4) ; la référence ne l'a comptée qu'une fois (E64) pour éviter un doublon factuel strict, et MemorIA ne produit également qu'une seule proposition (`dead-desamiantage-p3`) — comportement cohérent des deux côtés.

## Section spéciale — Photos

**7 images extraites côté MemorIA vs 7 photos de référence — ratio 1,0x**, à l'inverse de JAR_01 (ratio 2x). Les 7 photos de référence sont **MATCHED** (0 MISSED, 0 faux positif, 0 legitimate extra image).

Différence structurelle notable par rapport à JAR_01 : **aucune evidence `page_snapshot`** n'existe dans ce document (0 vs 1 pour JAR_01), donc pas de filet de sécurité de légende au niveau page pour recouper les dégradations de caption individuelle.

| Réf. | Image MemorIA | Qualité |
|---|---|---|
| P01 | img-p1-1.png | Caption "Logo", fidèle et complète |
| P02 | img-p2-1.png | Caption "Plan de", tronquée mais reconnaissable |
| P03 | img-p3-1.png | Caption null ; pas de perte réelle, la référence n'a pas de caption source non plus |
| P04 | img-p3-2.png | Caption "Ren" — fragment qui ne correspond à aucune légende réelle (probable fuite d'un texte voisin happé par le découpage bbox), artefact plutôt qu'information fausse |
| P05 | img-p6-2.png | Caption "Terr" (fragment cohérent de "Terrassement...") |
| P06 | img-p6-1.png ou img-p6-3.png | **Incertain** — deux images restantes, toutes deux caption=null, impossible de trancher laquelle est P06 vs P07 sans inspection visuelle (fichiers non accessibles localement, PDF non rendable dans cet environnement) |
| P07 | img-p6-1.png ou img-p6-3.png | **Incertain**, pairing symétrique à P06 |

Les deux photos existent bien côté MemorIA (0 photo manquante) ; seule l'affectation précise P06/P07 reste non tranchée, documentée comme incertaine plutôt que devinée arbitrairement.

## Éléments manqués

**11 au total**, concentrés à 91 % (10/11) dans le préambule administratif de la page 2 :
- E24 — métadonnée de rédaction ("Rédigé par Alain MALLET le 19/06/2023")
- E32 — contexte général aménagement rue Pasteur/av G Leclerc
- E33 — quantités techniques (1400 ml de canalisations, 99+74 branchements)
- E34 — enveloppe budgétaire 1 138 656 €HT
- E35 — marché subséquent 27/10/2022
- E36 — OS préparation 9/01/2023 + OS démarrage 13/02/2023
- E37 — DT réalisée 22/03/2022
- E44 — délais d'exécution contractuels 11 mois
- E45 — démarrage 13/02/2023 puis 2e trimestre 2023 pour 11 mois
- E52 — information générale Grand Cognac liée à l'av G Leclerc (distincte de E93)
- E66 — mise à jour du plan d'exécution (point daté 09/06/2023, page 4)

## Faux positifs / Legitimate extra

**0 faux positif de contenu** sur les 96 propositions du document. **1 legitimate extra** : `comp-servicestech-p1` ("Services techniques" de la Commune de Jarnac, extrait comme entité company distincte) — contenu réel déjà présent dans le `companyRole` de E08/E09 côté référence, mais non isolé en élément company séparé en Phase A ; granularité plus fine côté MemorIA, pas une fabrication.

Un point reste **non résolu faute de preuve** : `pers-mjoly-p1` (E07) porte un statut de présence contradictoire entre les deux sources (Excusé côté référence, Présent côté MemorIA), sans possibilité de consulter le PDF source dans cet environnement pour arbitrer. Sur les 21 autres personnes du roster, le mapping Excusé/Présent est parfaitement cohérent côté MemorIA, ce qui écarte l'hypothèse d'un bug de statut par défaut généralisé (contrairement au soupçon initial issu de JAR_01).

## Synthèse

Sur JAR_CR02, contrairement à JAR_01, l'écart entre référence et sortie MemorIA n'est pas un problème de volume (ratio proche de 1) mais un problème de **frontière de classification**, concentré sur l'axe `observation`/`knowledge_fact` : 91 % des observations de référence sont absorbées par `knowledge_fact`, un biais plus extrême qu'aucun autre biais documenté ailleurs dans le corpus à ce stade. Le deuxième facteur de recall bas est un angle mort structurel sur le préambule administratif de CR (contexte, quantités, budget, dates de marché), déjà entrevu sur d'autres documents. À l'inverse, la famille `decision` fonctionne bien ici (83,3 %) là où elle était totalement absente sur JAR_01 — confirmation que le biais dominant est spécifique au document et non un défaut transversal unique du pipeline. Aucune fabrication de contenu détectée : 0 faux positif sur 96 propositions, 2 conflits documentés comme incertains plutôt que tranchés arbitrairement (statut de présence M JOLY, pairing P06/P07).
