# QHSE_002 — Comparaison qualification Phase C (référence vs MemorIA)

**Document** : gabarit de rapport d'inspection de chantier — charpente métallique, Les Consultants Conformtech inc. (Montréal, QC), 5 pages.
**Référence (Phase A)** : 3 éléments + 1 photo (logo décoratif), extraits indépendamment du PDF source.
**MemorIA (Phase B)** : 4 propositions, 4 evidence texte, 0 evidence image — sortie pipeline réelle, non modifiée.

## Constat global

Le plus petit document du corpus scoré à ce stade (3 éléments de référence). C'est un cas de test « négatif » : un gabarit d'inspection quasi entièrement vierge (aucun champ d'identification projet/client/date rempli, colonne « État » vide sur les 3 pages de grille, page 5 « Liste item déficient » totalement blanche).

- **1/3 élément MATCHED** (company), **1/3 PARTIAL** (knowledge_fact, couverture très étroite), **1/3 MISSED** (knowledge_fact).
- Recall `knowledge_fact` = 25 % (matched=0, partial=1, missed=1, total=2, recallScore=0,25). Recall `company` = 100 % (1/1).
- **0 faux positif de contenu** parmi les 4 propositions : 2 vrais positifs (company + knowledge_fact) et 2 LEGITIMATE_EXTRA (reservation), 0 FALSE_POSITIVE.
- Point qui dépasse le simple scoring : reference.json (Phase A) affirme qu'« aucune non-conformité concrète... ne figure dans le texte source », alors que memoria-output.json contient 2 propositions `reservation` à source_excerpt précis et vérifiables. La lecture directe du PDF (dernier recours, imposée par cette contradiction) confirme que ces 2 phrases existent réellement dans le document, noyées dans un texte à 95 % générique — détaillé dans les biais ci-dessous.

## Recall et précision par famille

| Famille | Matched | Partial | Missed | Total réf. | Recall | Vrais positifs | Faux positifs | Legit. extra | Total prop. | Précision |
|---|---|---|---|---|---|---|---|---|---|---|
| company | 1 | 0 | 0 | 1 | 100 % | 1 | 0 | 0 | 1 | 100 % |
| knowledge_fact | 0 | 1 | 1 | 2 | 25 % | 1 | 0 | 0 | 1 | 100 % |
| reservation | 0 | 0 | 0 | 0 | n/a (0 élément de référence) | 0 | 0 | 2 | 2 | n/a (aucun vrai/faux positif, seulement legit. extra) |
| person / deadline / decision / action / observation | 0 | 0 | 0 | 0 | n/a | 0 | 0 | 0 | 0 | n/a |

`recallByFamily` et `precisionByFamily` de comparison.json renvoient `null` pour toutes les familles à `total=0` — notées n/a ci-dessus.

## Biais systématiques identifiés

**1. Contradiction Phase A / pipeline sur l'existence de non-conformités réelles — nuance, pas invalidation.** reference.json affirme qu'aucune non-conformité concrète ne figure dans le texte. La lecture directe du PDF montre que le corps de la grille, à 95 % générique et répétitif (« nous vérifions que... », « nous validons... », au présent, sans conclusion), contient 2 phrases qui rompent ce patron et sont verbatim réelles : une recommandation inconditionnelle de renforcement des trous d'ancrages (page 2) et une affirmation de non-conformité au passé composé sur la verticalité des colonnes (page 2, avec citation normative exacte [Art. 29.3.3 CSA S16-09] reprise fidèlement). Le diagnostic global de reference.json reste globalement exact (document très majoritairement vide) mais n'est pas entièrement exact sur ce point précis : la lecture Phase A a traité l'intégralité du corps de la grille comme générique/méthodologique sans repérer ces 2 exceptions.

**2. Écart de fidélité factuelle sur la proposition « plate washer ».** Le texte source distingue une vérification conditionnelle (« nous vérifions SI les trous... ont été agrandis par oxycoupage ») d'une recommandation énoncée sans condition explicite. La description MemorIA transforme cette condition en fait accompli (« ... suite à l'agrandissement par oxycoupage des trous dans les plaques de base... »), ajoutant une certitude causale que le texte n'établit pas explicitement. La recommandation elle-même n'est pas inventée ; c'est l'articulation causale qui est resserrée à tort.

**3. Couverture très étroite du périmètre normatif (E03, PARTIAL).** La référence regroupe en un seul élément tout le périmètre normatif du gabarit (boulons d'ancrages, fabrication/montage, assemblages boulonnés/soudés, tablier métallique, revêtements d'acier, ancrages chimiques/mécaniques, goujons, dessins structuraux, normes CSA S16-09/W59-13/W47.1-09, spécifications CANAM/HILTI). MemorIA n'en extrait qu'une seule proposition, fidèle et verbatim, sur les dessins structuraux (page 4, avec la référence [art.4 de la CSA S16-09]) — tout le reste de ce périmètre (plusieurs dizaines de lignes de texte générique de structure similaire) n'est capturé par aucune proposition.

**4. Métadonnée de rôle d'entreprise erronée (mineur).** La proposition company porte `source_payload.companyRole="AMO"` (Assistance à Maîtrise d'Ouvrage) alors que le document décrit une firme d'inspection/contrôle technique indépendante (vérificateur, pas gestionnaire pour le compte du maître d'ouvrage). Mislabeling du sous-champ de rôle uniquement, sans conséquence sur la famille elle-même ni sur le recall/precision.

## Doublons internes à MemorIA

Aucun doublon détecté (`duplicateProposalsWithinMemoria` absent de ce run).

## Photos

Référence : 1 photo, décorative (logo/pictogramme « Conformtech » répété en pied de pages 2, 3, 4 — aucune photographie de constat ou de chantier). MemorIA : 0 evidence image ; les 4 evidence produites sont toutes de type `text_excerpt`. Cohérent : le seul visuel de la référence est un logo de marque non probant, hors périmètre de comparaison photo détaillée.

## Éléments manqués

**1 seul.** E02 — phrase méthodologique du Sommaire (page 1) : « Prendre note que les interventions sont à la base arbitraire à moins d'être mentionné autrement. » Aucune proposition ni evidence MemorIA ne reprend ce passage (les 4 evidence texte du run ne couvrent que les pages 1 en-tête, 2×2 et 4).

## Synthèse

Document minuscule (3 éléments de référence) conçu comme test négatif : un gabarit d'inspection quasi vierge. Le pipeline ne survalorise pas le document (0 faux positif, aucune non-conformité ni personne inventée sans base réelle) et identifie correctement l'unique entreprise nommée. Il rate en revanche une phrase méthodologique (E02) et ne couvre qu'une fraction étroite du périmètre normatif regroupé dans E03. Le point le plus notable dépasse le scoring strict : la lecture directe du PDF a montré que reference.json (Phase A) sous-estime légèrement la richesse réelle du document — 2 phrases de non-conformité/recommandation existent bel et bien, et le pipeline les a correctement extraites en `reservation` (classées LEGITIMATE_EXTRA ici faute d'élément de référence correspondant), même si l'une d'elles ajoute une certitude causale non explicite dans la source.