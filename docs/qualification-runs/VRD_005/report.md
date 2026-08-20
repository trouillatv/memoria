# Qualification VRD_005 — comparaison reference.json / memoria-output.json

Document : rapport de visite de chantier pédagogique (Master 1 Génie Civil, Université de Tlemcen, partenariat Erasmus+/Proemed), sortie du 17 décembre 2018 sur le chantier privé « Résidence Anes » (Oran, Algérie), réalisé par le groupe Hasnaoui (112 logements F4&F6 + centre commercial + parking, R+15). Document non contractuel : fiche d'identité du chantier (page 2) suivie de fiches techniques thématiques (chauffage, structure, murs extérieurs, murs intérieurs, ouvertures) illustrées de nombreuses photos, conclu par un bilan pédagogique. Ni décision, ni action à échéance, ni réserve n'y figurent.

- Référence (Phase A) : 26 éléments texte (4 person, 4 company, 7 knowledge_fact, 1 deadline, 10 observation) + 15 photos (5 decorative/document_context, 10 evidence)
- MemorIA (Phase B, pipeline de production réel) : 30 propositions (4 person, 4 company, 21 knowledge_fact, 1 deadline, **0 observation**) + 56 evidence (30 text_excerpt, 10 page_snapshot, 16 image), `proposalEvidenceLinks` vide

## Résultats par famille

| Famille | Éléments réf. | Recall | Propositions MemorIA | Precision |
|---|---|---|---|---|
| person | 4 | **100 %** (4/4 MATCHED) | 4 | **100 %** |
| company | 4 | **100 %** (4/4 MATCHED) | 4 | **100 %** |
| deadline | 1 | **100 %** (1/1 MATCHED) | 1 | **100 %** |
| knowledge_fact | 7 | **71,4 %** (5 MATCHED, 2 MISSED) | 21 | **20 %** (4 vrais positifs / 20, hors 1 legitimate_extra) |
| observation | 10 | **0 %** (0 MATCHED, 1 MISSED, 9 MISCLASSIFIED) | 0 | N/A (aucune proposition dans cette famille) |
| action / decision / reservation | 0 | -- | 0 | -- |

**Global** : recall = **14/26 MATCHED (53,8 %)**, 0 PARTIAL, 3 MISSED, 9 MISCLASSIFIED. Precision = **13/29 vrais positifs (44,8 %)** en comptant les 16 misclassified comme échec de precision (13/13 = 100 % si on ne regarde que la fidélité de contenu / fabrication). **0 FALSE_POSITIVE, 1 LEGITIMATE_EXTRA.**

## Le biais dominant : la famille « observation » a disparu

C'est le résultat le plus net de ce document. MemorIA n'a produit **aucune** proposition de famille `observation` (0/30), alors que la référence en identifie 10 sur 26 éléments (38 % du contenu du document). Il ne s'agit pas d'une perte de contenu : les 9 éléments concernés (R+15/avancement gros œuvre, système de chauffage installé par Hasnaoui, dalle, poteaux, enduit/finitions, murs extérieurs isolés, murs de séparation/cloisons BA13, fenêtres/portes aluminium, propreté et sécurité du chantier) sont tous capturés avec un excerpt fidèle et complet — mais systématiquement rangés en `knowledge_fact`. Seul le passage E17 (« nous avons eu l'occasion de voir toutes les étapes de construction [...] grâce au rapport photographique présenté par le chef de chantier ») est réellement absent, sans classification erronée possible puisqu'aucune proposition ne le couvre.

Ce biais de frontière de classification est cohérent avec celui déjà documenté sur VRD_002 (E13/E14/E15 : pratiques permanentes rangées en `action` au lieu de `knowledge_fact`/`permanent_instruction`) : MemorIA semble avoir une frontière `observation` vs `knowledge_fact` mal calibrée dès qu'un fait technique est formulé de façon déclarative-descriptive (« La dalle : c'est une dalle pleine en béton armé de 20cm ») plutôt qu'au style narratif de constat (« nous avons observé que... »). Ici, le rapport source est rédigé presque entièrement dans ce style descriptif technique, ce qui a fait basculer la quasi-totalité de la famille observation vers knowledge_fact.

**Impact chiffré** : precision de la famille knowledge_fact = 20 % (4 vrais positifs sur 20, hors 1 legitimate_extra) ; recall de la famille observation = 0 %. Aucun de ces 16 faits n'est pourtant perdu ou halluciné — c'est entièrement un problème de rangement, pas de contenu.

## Éléments manqués (3, hors observation)

- **E15** : métadonnée de contexte de la visite (date exacte, composition de la promotion). Impact mineur, similaire à la clause administrative manquée sur LRM_01 — angle mort probable sur les mentions de méta-contexte documentaire.
- **E17** : mention du rapport photographique présenté par le chef de chantier. Seul élément réellement perdu de la famille observation.
- **E25** : bilan pédagogique de conclusion (« a permis de répondre à beaucoup de questionnement [...] importance d'une étude thermique »). Contenu réflexif de fin de document, non technique.

## Faux positifs et legitimate extra

**0 FALSE_POSITIVE.** Aucune fabrication détectée : les 30 `source_excerpt` correspondent mot pour mot au texte réel du PDF, vérifiés page par page. Point notable positif : la proposition `deadline` « Fin des travaux » (Sept. 2019, mois/année seulement dans la source) ne porte aucun champ `dueDate` structuré fabriqué — contrairement au biais de fabrication de précision temporelle documenté sur LRM_01, MemorIA n'invente pas de jour ici.

**1 LEGITIMATE_EXTRA** : « Projet Résidence Anes, Oran » (titre/localisation, page 1), contenu réel non isolé comme élément propre par la référence Phase A.

## Complétude et fragmentation

Schéma classique de sur-fragmentation, mais cette fois concentré sur le sous-ensemble mal classé : E18 (chauffage) est éclaté en 4 propositions, E16/E21/E23/E24 chacun en 2. À l'inverse, E09+E10 (programme du projet) sont **consolidés** en une seule proposition MemorIA — l'inverse du biais habituel, sans perte de contenu dans les deux sens.

## Photos — comparaison détaillée (axe de test prioritaire, fort volume d'images)

Référence : 15 photos (4 logos institutionnels/décoratifs page 1-2, 1 photo de groupe `document_context`, 10 photos `evidence` à valeur de preuve technique, pages 3 à 6).

MemorIA extrait les preuves visuelles par **deux mécanismes distincts et non reliés entre eux** (`proposalEvidenceLinks` vide) :

1. **`page_snapshot` (10 items)** : couvre exactement les 10 photos `evidence` de la référence (P06 à P15), recall = **100 %**, avec des légendes d'**excellente qualité** qui reprennent quasi mot pour mot les légendes réellement imprimées dans le document (« Tuyaux pour chauffage central posés sur la dalle » vs référence « Tuyaux pour chauffage central posés à terre » ; « Menuiserie aluminium pour porte » identique à la légende source ; etc.). C'est un résultat nettement meilleur que VRD_002, où les légendes étaient vagues/tronquées et l'extraction s'arrêtait après la page 8.
2. **`image` (16 crops bruts)** : capture des fragments de ces mêmes photos en quasi-doublon positionnel (bounding boxes très proches par paires sur presque toutes les pages 3 à 6 — probablement un artefact de rendu PDF, image + son cadre/bordure capturés comme deux objets raster distincts). Les légendes de ce canal sont systématiquement tronquées à 1-2 mots ou absentes (« Tuy », « Fa », « Image non », caption `null`, ou « Cloisons » vraisemblablement mal attribué à une photo voisine) — aucune valeur descriptive autonome, mais aucun contenu fabriqué : toutes les pages et positions sont cohérentes avec le PDF réel.

Les 4 logos décoratifs de la page de garde (Université de Tlemcen, Erasmus+, Proemed, groupe Hasnaoui) sont correctement **exclus** de l'extraction — cohérent avec leur rôle non-prioritaire. La photo de groupe (P04, `document_context`) n'est captée que par le canal `image` brut, avec une légende vague (« Visite »), sans `page_snapshot` descriptif équivalent.

**Point de vigilance** : `proposalEvidenceLinks` reste vide sur l'ensemble de l'extraction, y compris pour les 10 `page_snapshot` pourtant nommément corrélables aux observations techniques correspondantes (E16-E24) via leur `nearby_text` — la mise en relation preuve↔proposition reste entièrement implicite (page + texte voisin), pas de lien structurel exploitable en aval.

## Biais récurrents à surveiller sur le reste du corpus

1. **Disparition de la famille observation au profit de knowledge_fact** sur un document au style technique-descriptif dense — biais principal et le plus sévère observé sur ce document, à corréler avec le biais symétrique déjà vu sur VRD_002 (observation/knowledge_fact→action).
2. **Duplication positionnelle du canal `image` brut** (crops quasi-identiques par paires) avec légendes tronquées à 1-2 caractères — même famille de biais que les légendes génériques de VRD_002, mais ici compensée par un second canal `page_snapshot` de très bonne qualité qui couvre correctement le contenu.
3. **`proposalEvidenceLinks` structurellement vide** sur tous les documents qualifiés à ce jour (LRM_01, VRD_002, VRD_005) — aucune preuve rattachée formellement à une proposition, quelle que soit la qualité de l'evidence.
