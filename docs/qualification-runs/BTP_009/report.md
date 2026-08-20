# BTP_009 — Comparaison qualification Phase C (référence vs MemorIA)

**Document** : *BTP_009_7_saintlambert_courbes.pdf* — rapport pédagogique de visite de chantier (Lycée Saint Lambert, section BAT1, programme ALTOA/EIFFAGE, 11 pages). Ce n'est pas un PV opérationnel classique : pas de liste de présence datée avec réserves/actions formelles, mais un document de synthèse pédagogique (intervenants, données chiffrées du marché, modes constructifs, matériaux, organisation, catalogue de finitions, photos).
**Référence (Phase A)** : 35 éléments + 17 photos, extraits indépendamment du PDF source.
**MemorIA (Phase B)** : 44 propositions — sortie pipeline réelle, non modifiée.

Note technique : ce document a d'abord échoué (timeout Gemini ~247s) sur un premier passage pipeline, puis a réussi sans aucune modification de code/config/prompt sur un second passage identique. Le résultat scoré ici est celui de la tentative réussie ; c'est un transitoire d'infrastructure, sans effet sur le scoring qualitatif ci-dessous.

## Constat global

- **28/35 éléments de référence MATCHED**, 3 PARTIAL (E19, E28, E30), 3 MISSED (E11, E26, E35), 1 MISCLASSIFIED (E12, contenu capturé mais rangé en `knowledge_fact` au lieu de `deadline`).
- **Recall pondéré global ≈ 84,3 %** ((28 + 0,5×3) / 35).
- Sur 44 propositions MemorIA : 39 vrais positifs, 1 seul faux positif de contenu (« bureau d'étude GO », entité fabriquée à partir d'une mention de rôle sans nom), 1 proposition mal classée, 3 legitimate extra (contenu réel non isolé par la référence).
- **Précision globale ≈ 95,1 %** (39 / (44-3)).
- Aucune fabrication de chiffre ou de date détectée : les 8 données chiffrées du document (démarrage 01/09/2017, réception 01/07/2019, montant 15,65 M€, durée 22 mois, 7400 m3 béton/990 toupies, 510 t acier, effectif 40-50/90, 50 000 h GO) sont reprises à l'identique côté MemorIA, y compris les deux dates avec jour exact.

## Recall et précision par famille

| Famille | Réf. totale | Matched | Partial | Missed | Recall | Propositions | Vrai positif | Faux positif | Legit. extra | Précision |
|---|---|---|---|---|---|---|---|---|---|---|
| person | 8 | 8 | 0 | 0 | 100 % | 8 | 8 | 0 | 0 | 100 % |
| company | 3 | 2 | 0 | 1 | 66,7 % | 3 | 2 | 1 | 0 | 66,7 % |
| deadline | 2 | 1 | 0 | 0 (1 misclassified) | 50 % | 1 | 1 | 0 | 0 | 100 % |
| decision | 1 | 1 | 0 | 0 | 100 % | 1 | 1 | 0 | 0 | 100 % |
| knowledge_fact | 20 | 16 | 3 | 1 | 87,5 % | 31 | 27 | 0 | 3 | 96,4 % |
| observation | 1 | 0 | 0 | 1 | 0 % | 0 | 0 | 0 | 0 | n/a (0 proposition) |
| action | 0 | – | – | – | n/a | 0 | – | – | – | n/a |
| reservation | 0 | – | – | – | n/a | 0 | – | – | – | n/a |

`action` et `reservation` sont explicitement notées absentes du document des deux côtés (rapport pédagogique, pas de PV de réunion de chantier avec actions/réserves formelles) — pas un défaut d'extraction.

## Biais systématiques identifiés

**1. Incohérence de classification entre deux dates de nature identique.** La date de réception (E13) est correctement classée `deadline` avec `dueDate` structuré, mais la date de démarrage (E12, ordre de service du 01/09/2017) est classée `knowledge_fact` sans champ `dueDate`, alors que les deux phrases source ont une structure quasi identique (« [Label] : [date] »).

**2. Fabrication d'entité à partir d'un rôle sans nom.** Sur 3 mentions de rôles non nominatifs dans la même phrase source (bureau d'étude GO, bureau de contrôle, coordinateur SPS — aucun n'est nommé), MemorIA en extrait 1 comme entité `company` (« bureau d'étude GO »), avec de surcroît un `companyRole` erroné (« maître d'œuvre », alors que le maître d'œuvre réel est l'architecte cité juste avant), et ignore correctement les 2 autres. Traitement incohérent au sein d'un même paragraphe.

**3. Sur-fragmentation systématique des listes à puces `knowledge_fact`.** E27 (bâtiment basse consommation, 6 items) et E34 (catalogue de finitions béton, 6 items) sont chacun éclatés en 6 propositions MemorIA distinctes. Aucune perte de contenu sur E27, mais densité informationnelle très faible sur E34 : les 6 propositions portent une description identique et quasi vide (« Finition de béton. »), seul le label distingue les finitions entre elles.

**4. Synthèses de liste non capturées comme telles.** E19 (liste des rôles d'intervenants) et E30 (organigramme complet, incluant la mention de la catégorie collective non nominative COMPAGNONS) sont des phrases de synthèse dont le contenu nominatif est bien extrait ailleurs (person/company), mais dont la synthèse elle-même n'a aucune trace — PARTIAL sur les deux.

**5. Perte partielle réelle sur E28.** La proposition MemorIA capture la partie « types de finitions + renvoi Annexe 1 » mais omet la phrase d'ouverture sur les propriétés génériques du béton (« Le béton est un matériau durable, solide et résistant aux chocs »), qui constitue selon la référence la majeure partie du texte source de cet élément.

**6. Perte de contenu factuel distinctif sur E26.** La présentation historique du groupe Eiffage (fondé 1993, fusion Fougerolle/SAE, 3e groupe français, 5e en Europe) n'est reprise par aucune proposition ; la proposition `company` « EIFFAGE » effleure le sujet de façon générique sans les faits distinctifs — perte de contenu réelle, pas seulement un déplacement de famille.

**7. Famille `observation` totalement absente côté MemorIA (0 proposition sur tout le run)**, cohérent avec le biais déjà documenté sur VRD_002 pour cette même famille.

## Section Photos

17 photos de référence vs 7 `evidence_type="image"` + 1 `page_snapshot` côté MemorIA. Vérification par recoupement page/bbox/légende uniquement (rendu visuel du PDF indisponible dans cet environnement) ; le mapping P03 est marqué incertain en conséquence.

- **Correspondances (4 sûres + 1 incertaine)** : P01 (rendu de couverture, caption vague « Rendu »), P02 (vue aérienne, caption vague « Situation du »), P03 (correspondance incertaine, best-effort), P06 (plans techniques, caption correcte « Plans » mais sur-fragmentée en 3 images pour 1 photo de référence), P07 (plateforme/étaiement, caption hors-sujet « Mise », dérivée du texte voisin plutôt que du contenu visuel — même biais que documenté sur VRD_002).
- **Couverture partielle catégorielle (6 photos → 1 objet)** : P11 à P16 (catalogue de finitions béton, page 11, chacune légendée distinctement) ne sont couvertes par aucune image individuelle, mais par un seul `page_snapshot` (caption « Liste des différents aspects de finition du béton architectonique. »). Les 6 finitions SONT capturées textuellement (E34), mais la granularité photo par finition est perdue.
- **Manquantes (5, sans aucune trace)** : P04 et P05 (page 3, les 2 seules photos `role=evidence` du document — preuve visuelle réelle d'avancement, terrassement et banchage), P08, P09, P10 (page 9, page entièrement absente de l'extraction).
- **Non prioritaire, cohérent** : P17 (logos institutionnels répétés en en-tête, `role=decorative`).
- **Faux positifs** : aucun.

L'extraction d'images couvre les pages 1, 3 (partiellement, 2/4 attendues), 5 et 7, puis s'arrête net après la page 7 — aucune evidence sur la page 9 (3 photos de référence). Ce même schéma de troncature positionnelle sur les pages profondes d'un document illustré avait déjà été observé sur VRD_002 (arrêt après la page 8 sur un document de 14 pages) : biais récurrent sur les documents de plus de ~7-8 pages. La perte des 2 photos `role=evidence` (P04, P05) est le point le plus limitant de cette dimension sur ce document.

## Éléments manqués

- **E11** (company) : LYCEE TECHNIQUE REGIONAL DU BATIMENT ET DES TRAVAUX PUBLICS SAINT LAMBERT, établissement des auteurs — aucune proposition ne capture cette entité, alors que les deux personnes qui en sont issues (E01, E02) sont bien extraites.
- **E26** (knowledge_fact) : présentation historique du groupe Eiffage (fondation, fusion, classement) — voir biais n°6.
- **E35** (observation) : section « Ouvrages déjà réalisés » illustrée uniquement par des plans, sans texte descriptif — 0 proposition `observation` dans tout le run.

## Synthèse

BTP_009 confirme un pipeline à recall élevé (84,3 % pondéré) et précision élevée (95,1 %) sur ce document pédagogique, sans fabrication de chiffre ou de date. Les pertes se concentrent sur trois points bien identifiés : une frontière `deadline`/`knowledge_fact` fragile sur des dates de structure identique, une tendance ponctuelle à fabriquer une entité `company` à partir d'un rôle sans nom, et deux biais déjà documentés sur d'autres corpus du programme — l'absence totale de la famille `observation`, et une troncature positionnelle de l'extraction d'images au-delà de la page 7-8 (ici la page 9, 3 photos perdues, et les 2 seules photos `role=evidence` du document introuvables). La sur-fragmentation des listes à puces (E27, E34) ne coûte pas de contenu mais dilue la densité informationnelle par proposition.
