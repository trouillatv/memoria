# Rapport de qualification — VRD_002

Document : *Compte rendu de visite de chantier — Projet New Side, Garenne-Colombes* (rapport pedagogique HMONP ENSAPM, 15 pages). Ce n'est pas un PV operationnel classique : pas de liste de presence datee, pas de reserves formelles, pas d'actions a echeance/responsable explicite, pas de decisions actees nommement. La reference Phase A (lecture independante du PDF) ne contient donc que 3 familles : `company`, `knowledge_fact`, `observation`.

- Reference (Phase A) : 15 elements texte + 10 photos
- MemorIA (Phase B, pipeline de production reel) : 19 propositions + 27 preuves (evidence), dont 6 images

## Recall / Precision par famille

| Famille | Ref. | Propositions MemorIA | MATCHED | MISCLASSIFIED | LEGITIMATE_EXTRA | FALSE_POSITIVE | Recall | Precision |
|---|---|---|---|---|---|---|---|---|
| company | 3 | 3 | 3 | 0 | 0 | 0 | **100 %** | **100 %** |
| knowledge_fact | 10 | 11 | 7 | 3 (-> classees `action`) | 4 | 0 | **70 %** | **100 %** |
| observation | 2 | 0 | 0 | 0 | 0 | 0 | **0 %** | N/A (0 proposition) |
| action | 0 | 5 | 0 | 3 (contenu reel, famille erronee) | 2 | 0 | N/A (0 ref.) | **0 %** |

Aucune hallucination : les 19 `source_excerpt` des propositions ont ete verifies mot pour mot contre le PDF source (15 pages relues integralement) — tous correspondent a du texte reel.

## Biais principal : sur-classification en famille "action"

Le document ne contient aucune action datee a responsable/echeance (confirme par la reference independante). Pourtant MemorIA produit 5 propositions en famille `action`, toutes construites sur des phrases decrivant des **procedures permanentes** avec un acteur nomme mais sans instance datee :

- 3 correspondent a un contenu reel de la reference, mais classe `knowledge_fact`/`permanent_instruction` cote reference : fiches de visite architecturales (E13), reportage photo (E14), ordre de service sur modification (E15). Contenu capture fidelement (excerpt identique), **famille erronee**.
- 2 sont des extras legitimes avec le meme biais : "l'OPC etablit le calendrier general de synthese" (p.8), "la MOE doit produire une liste previsionnelle de plans" (p.6) — descriptions de missions recurrentes, pas d'actions ponctuelles.

Resultat : precision de la famille `action` = **0 %** sur ce document (0 vrai positif / 3, extras exclus). Le recall `knowledge_fact` (70 % au lieu de 100 %) s'explique uniquement par ce biais de famille, pas par une perte de contenu.

## Famille manquee : observation (0/2)

Deux constats de risque "doux" du document, sans entreprise ni responsable ni echeance nommes, ne sont couverts par **aucune** proposition MemorIA (dans aucune famille) :
- p.9 : "les entreprises ne soulevent pas forcement de vrais problemes... l'architecte se doit d'etre vigilant"
- p.13 : "les problemes de stockages lies a ce chevauchement des differentes phases... questions de securite"

## Elements manques

| Element ref. | Famille | Contenu |
|---|---|---|
| E07 | observation | Vigilance requise face aux fausses reclamations d'entreprises (p.9) |
| E12 | observation | Problemes de stockage / securite lies au chevauchement de phases (p.13) |

## Faux positifs / contenu douteux

Aucun `FALSE_POSITIVE` detecte. Point de vigilance mineur hors classification : la proposition company "Hines" (id `3c544975`) porte un champ structure `companyRole: "AMO"` incoherent avec sa propre description texte ("maitrise d'ouvrage deleguee") et avec le PDF (Hines = MOA deleguee, "responsable final de l'ouvrage" ; AMO designe une entite environnementale distincte page 5). Defaut de champ structure, pas de faux positif de contenu.

## Section dediee — Photos et legendes

Comparaison des 10 photos de reference (avec role/justification) contre les 6 `evidence_type="image"` produites par MemorIA.

### Couverture

| Photo ref. | Page | Role ref. | Statut MemorIA |
|---|---|---|---|
| P01 | 1 | document_context | MATCHED (caption vague) |
| P02 | 4 | document_context | MATCHED (caption vague) |
| P03 | 4 | document_context | MATCHED (caption hors-sujet, tronquee) |
| P04 | 7 | evidence | MATCHED (caption vague) |
| P05 | 7 | evidence | MATCHED (caption hors-sujet, tronquee) |
| P06 | 8 | document_context | MATCHED (caption hors-sujet, tronquee) |
| P07 | 11 | document_context (schema) | MISSED cote image ; capture en `page_snapshot` avec caption pertinente ("Diagramme de phasage type d'un projet architectural.") |
| P08 | 12 | evidence (temoin facade) | **MISSED** — aucune trace, perte de contenu reelle |
| P09 | 13 | evidence (interieur fini) | **MISSED** — aucune trace, perte de contenu reelle |
| P10 | 13 | evidence (palier ascenseurs) | **MISSED** — aucune trace, perte de contenu reelle |

### Constat n°1 — troncature positionnelle de l'extraction d'images

Les 6 images extraites couvrent exactement les pages 1, 4 (x2), 7 (x2) et 8 — les 6 premieres photos integrees du document, dans l'ordre. **Aucune image n'est extraite apres la page 8**, alors que le document contient encore un schema (p.11) et 3 photos reelles (p.12-13), dont deux illustrent directement le sujet central du "temoin/prototype de facade" (discute sur 4 elements de la reference : E08, E09, E10 et la photo P08 elle-meme). Ce n'est pas un probleme de selection/pertinence mais une troncature positionnelle (plafond de nombre d'images ou limite de pages traitees pour l'extraction visuelle) — a verifier cote pipeline d'extraction si ce cas se reproduit sur d'autres documents longs.

### Constat n°2 — legendes non descriptives sur 100 % des images matchees

Aucune des 6 captions generees ("Preparation", "Projet", "Pro", "Coordination", "Coord", "Re") ne decrit le contenu reel de la photo (perceuse/documents, rendus 3D de facade, gaines de ventilation, tuyauteries calorifugees, reunion en salle). Plusieurs sont des fragments tronques en fin de mot ("Pro" pour "Projet", "Coord" pour "Coordination", "Re" pour probablement "Reunion"), ce qui suggere une generation de legende derivee de titres de section proches plutot qu'une lecture du contenu visuel de l'image elle-meme. Qualite de legende sur les 6 images : 2 vagues, 4 hors-sujet ; 0 pertinente.

### Extra legitime hors perimetre image strict

Un `evidence_type="page_snapshot"` supplementaire (id `225935f0`) capture le second diagramme de la page 14 (non liste dans les photos de reference) avec une caption pertinente — contenu reel, extra legitime.

## Biais recurrents a surveiller sur les autres corpus

1. Sur-classification `action` des descriptions de procedures permanentes avec un acteur nomme mais sans instance datee.
2. Troncature de l'extraction d'images sur les documents longs (>8 pages) — verifier si le seuil est lie au nombre de pages ou au nombre d'images.
3. Legendes d'images non descriptives / tronquees, semblant derivees de fragments de titres de section plutot que du contenu visuel reel.
4. Famille `observation` (constats de risque doux, sans acteur/echeance) : 0 % de recall sur ce document — a confirmer sur d'autres cas avant de generaliser.
