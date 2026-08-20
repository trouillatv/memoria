# Rapport de qualification — LRM_01

Document : compte-rendu de reunion de lancement de chantier (restauration eglise, tranche ferme + 2 tranches conditionnelles, 5 lots : maconnerie/pierre de taille, charpente/sculpture bois, couverture, decors peints/polychromie, coordination securite). CR de premiere reunion : listes de presence, CCTP par lot, calendrier des tranches, aucune reserve ni action a echeance.

- Reference (Phase A) : 25 elements texte + 1 photo (plan de phasage, decorative/document_context)
- MemorIA (Phase B, pipeline de production reel) : 55 propositions + 55 evidence texte, 0 evidence image, `proposalEvidenceLinks` vide

## Resultats par famille

| Famille | Elements ref. | Recall | Propositions MemorIA | Precision |
|---|---|---|---|---|
| person | 7 | **100 %** (7/7 MATCHED) | 8 (1 legitimate_extra) | **100 %** |
| company | 6 | **100 %** (6/6 MATCHED) | 6 | **100 %** |
| decision | 1 | **100 %** (1/1 MATCHED) | 1 | **100 %** |
| deadline | 0 (ref.) | N/A | 1 | **0 %** (1 faux positif) |
| knowledge_fact | 11 | **91 %** (10 MATCHED, 1 MISSED) | 39 | **100 %** |
| action / observation / reservation | 0 | -- | 0 | -- |

**Global** : recall = **24/25 MATCHED (96 %)**, 0 PARTIAL, 1 MISSED, 0 MISCLASSIFIED. Precision = **52/53 vrais positifs (98 %)**, 1 seul faux positif, 2 legitimate_extra exclues du calcul.

C'est, des 7 documents scores, le meilleur resultat du corpus sur les deux axes recall et precision.

## Faux positifs

**1 seul, mais net.** La proposition `deadline` "Demarrage du chantier" (id `86de5a8d`) encode `dueDate = 2014-09-01T00:00:00Z` — un jour calendaire precis — alors que le texte source ("le chantier ne debute qu'en septembre 2014") ne donne qu'un mois/annee. La reference Phase A avait explicitement laisse ce champ vide pour ne pas inventer un jour. C'est en outre un doublon inter-famille : le meme fait (report du chantier a septembre 2014) est deja capture fidelement par la proposition `decision` correspondante — un seul evenement metier a genere deux objets, dont un avec une date fabriquee.

## Elements manques

**1 seul.** E19 — clause administrative de fin de CR ("Sans remarque des parties sous 8 jours, le present compte-rendu est considere comme approuve") : aucune proposition MemorIA ne couvre ce passage. Impact mineur (clause type, non specifique au chantier), mais a noter comme angle mort systematique possible sur les mentions de validation/approbation de CR.

## Legitimate extra

2 propositions correspondent a du contenu reel du document que la reference Phase A n'avait pas isole :
- Phrase d'ouverture "La reunion avait pour but le lancement du chantier."
- M. PHILIPPE, contact de l'entreprise Lefevre figurant dans le tableau des entreprises (distinct de M. Palaric, present physiquement en reunion).

## Biais recurrents

1. **Sur-fragmentation systematique des CCTP/listes a puces.** 6 elements de reference (E17, E20-E23, E25) qui regroupent plusieurs puces sous un meme titre sont eclates par MemorIA en 34 propositions distinctes (une par phrase du CCTP, un item par lot). Aucune perte de contenu, mais forte multiplication des objets et des `subject_thread` potentiels pour un seul paragraphe source — meme schema que sur les autres documents a CCTP detaille du corpus.
2. **Fabrication de precision temporelle.** Le seul faux positif du document consiste a transformer un mois/annee en date exacte (jour = 01). Meme famille de biais que documente ailleurs dans le corpus (cf. doctrine prompts sans faits fictifs) : le moteur comble un champ structure (`dueDate`) meme quand la source ne fournit pas la granularite necessaire.
3. **Duplication inter-famille sur un meme fait.** Le report de demarrage est extrait a la fois comme `decision` (fidele) et comme `deadline` (avec date fabriquee) — deux objets pour un seul evenement metier.

## Photos

Reference : 1 photo (plan de phasage des tranches, role `document_context`, non prioritaire). MemorIA : 0 evidence de type image, 55 evidence toutes `text_excerpt`. Coherent avec l'absence de photos de chantier dans un CR de premiere reunion ; ce document n'est pas dans le perimetre de comparaison photo detaillee (reserve a VRD_002 et JAR_01).
