# Qualification QHSE_004 — PPSPS ECHAFAUDAGE 95 (Avrainville/Igny)

Comparaison entre la reference independante Phase A (`reference.json`, lecture directe du PDF, 23 elements + 2 photos) et la sortie reelle du pipeline de production MemorIA Phase B (`memoria-output.json`, 28 proposals + 29 evidence texte, 0 evidence image).

## Nature du document

Ce PPSPS n'est pas un compte-rendu de visite : tres peu de faits dates propres a un evenement de chantier, beaucoup de contenu procedural standard (secours, tableaux risques/prevention) repete d'un PPSPS a l'autre. Le document contient une incoherence interne assumee : la page de garde designe le chantier "Maison centrale de Poissy / refection du clocher" tandis que le corps (pages 3-4) designe "57 rue du Bas d'Igny / refection d'etancheite" -- signe d'une trame reutilisee sans mise a jour complete. MemorIA a correctement conserve les deux versions sans trancher, comme la reference.

## Resultats par famille

| Famille | Elements ref. | Recall | Proposals MemorIA | Precision |
|---|---|---|---|---|
| person | 5 | **100 %** (5/5 MATCHED) | 5 | **100 %** |
| company | 3 | **100 %** (3/3 MATCHED) | 11 (8 legitimate_extra) | **100 %** |
| deadline | 1 | **100 %** (1/1 MATCHED) | 1 | **100 %** |
| knowledge_fact | 13 | **46 %** (5 MATCHED, 2 PARTIAL, 6 MISSED) | 11 | **100 %** |
| decision | 1 | **0 %** (1 MISSED) | 0 | N/A (aucune proposal) |
| action / observation / reservation | 0 | -- | 0 | -- |

**Global** : recall pondere ~= **65 %** (14 MATCHED + 2 PARTIAL sur 23) . precision ~= **100 %** (20 vrais positifs / 20, 0 faux positif, 8 legitimate_extra exclues du calcul).

## Faux positifs

**Aucun.** Toutes les propositions non appariees a un element de reference correspondent a du contenu reellement present dans le PDF (annuaire d'organismes de prevention page 3 et 5, confirme par les `evidence.text_excerpt`) -- classees `LEGITIMATE_EXTRA`, pas hallucinees. La reference Phase A n'avait simplement pas juge cet annuaire administratif generique digne d'un element dedie.

## Elements manques importants

Le recall knowledge_fact (46 %) s'effondre presque entierement **apres la page 4** :

- **E15** -- consigne de secours generique (numeros Police/Pompiers/SAMU, procedure de signalement d'accident, page 5) : totalement absente.
- **E16** -- protocole detaille de premiers soins (yeux, brulures, saignement de nez, plaies, pages 6-7) : seul le contact SOS Main est repris (PARTIAL), le reste du protocole manque.
- **E17** -- respect des consignes de securite/circulation vis-a-vis des autres entreprises (page 7) : absente.
- **E19** -- tableau de prevention "Manutentions" (page 7) : absent.
- **E20** -- tableau de prevention "Amene et dechargement des materiaux" (page 8) : absent.
- **E21** -- risques de chutes d'objets aux acces/sous echafaudages (page 8) : absent.
- **E22** -- consignes generales au personnel + signalement de defaut materiel (page 8) : absent.
- **E23** -- validation/signature du PPSPS (decision, page 8) : absente ; **la famille `decision` est totalement vide (0/28 proposals)** sur ce document alors qu'un element decision existe dans la reference.
- **E06** (PARTIAL) -- nature des travaux, materiel et amarrages sont bien captures, mais l'obligation de port des EPI mentionnee dans le meme paragraphe (page 4) ne l'est pas.

## Biais recurrents

1. **Chute de couverture apres la page 4.** Tout ce qui precede (page de garde, tableau de renseignements generaux page 3-4, effectif, personnes) est tres bien capture (100 % sur person/company/deadline). Tout ce qui suit (consignes generiques et tableaux risques/prevention des pages 5-8) est quasi systematiquement manque. Hypothese : le pipeline priorise les blocs structures/tabulaires de debut de document et sous-echantillonne le contenu procedural repetitif de fin de PPSPS.
2. **Famille `decision` non detectee.** Aucun bloc de signature/validation n'a ete reconnu comme `decision` sur ce document, alors que ce type de contenu (date + nom + fonction + mention "Fait a... Le...") est un motif standard des PPSPS.
3. **Sur-generation de `company` sur des organismes administratifs generiques** (CRAMIF, OPPBTP, DIRECCTE, medecine du travail) que la reference ne retient pas comme elements -- pas des hallucinations, mais un signal de bruit potentiel si ces entites se retrouvent poussees comme "acteurs du chantier" dans les surfaces produit.
4. **Doublons d'entites non resolus.** 4 organismes apparaissent chacun deux fois dans le document (page 3 sommaire + page 5 annuaire detaille) et donnent lieu a **8 proposals distinctes pour ~4 organismes reels**, sans deduplication : CRAMIF/C.R.A.M., OPPBTP (x2), APMT-BTP-RP/APST BTP RP, DIRECCTE UC1/D.D.T.
5. **`proposalEvidenceLinks` vide** (0 lien pour 28 proposals / 29 evidence) : le rattachement proposal->evidence a du etre reconstitue manuellement via les champs `source_page`/`source_excerpt` portes directement par certaines proposals, plutot que via la table de jointure prevue a cet effet -- plusieurs proposals (notamment les `company` d'organismes de prevention) n'ont meme pas ces champs renseignes (`null`).

## Photos

Reference : 2 photos, toutes deux `decorative` (logo d'en-tete, cachet/signature) -- aucune photo de chantier reelle dans ce document. MemorIA : 0 evidence de type image. Coherent, rien a signaler.

## Limite methodologique

La verification directe du PDF (pages 3 et 5) n'a pas pu etre effectuee dans cet environnement (outils `pdftoppm`/`pdftotext` absents). La classification `LEGITIMATE_EXTRA` des organismes de prevention s'appuie sur la coherence entre les `evidence.text_excerpt` de Phase B (extraction Gemini reelle sur le vrai PDF) et le format standard d'un tableau d'organismes de prevention en PPSPS, sans relecture visuelle directe.
