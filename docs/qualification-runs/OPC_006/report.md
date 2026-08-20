# Rapport de qualification — OPC_006

## Verification tolerance zero : FAIL (ce n'est pas un cas de tolerance zero)

OPC_006 a produit 0 proposition cote MemorIA (proposalsTotal=0, 1 evidence image, 0 evidence texte) sur un document dont la lecture independante (Phase A) retient 38 elements reels : 8 entreprises/organismes nommes, 10 personnes nommees, 1 decision datee, 19 knowledge_fact. Le recall global est donc 0/38 = 0 %.

Ce cas est structurellement different de BTP_008 (Phase C, cas de non-hallucination volontaire valide PASS) :

| | BTP_008 | OPC_006 |
|---|---|---|
| Reference (Phase A) | 0 element (document gabarit vide) | 38 elements reels (personnes, societes, 1 decision, 27 connaissances) |
| MemorIA (Phase B) | 0 proposition | 0 proposition |
| Interpretation | Convergence legitime : rien a trouver, rien trouve -> PASS zero-tolerance | Divergence totale : 38 elements existants, 0 trouves -> echec de recall (0 %) |

Confondre les deux reviendrait a valider une perte de recall totale comme une preuve de robustesse anti-hallucination. Le critere de tolerance zero ne s'applique qu'aux documents dont la reference independante est elle-meme vide ; ce n'est pas le cas ici. zeroToleranceCheck.pass = false.

## Nature du document

OPC_006 (OPC_006_OGBTP_reunion_chantier_office.pdf, 10 pages) n'est pas un compte-rendu de reunion de chantier d'un projet reel. C'est une note methodologique generique publiee par l'Office du BTP Drome-Ardeche (OBTP 07/26), validee en Conseil d'Administration le 17/06/2008, proposant des bonnes pratiques pour la conduite des reunions de chantier en general. Le nom de fichier est trompeur : « office » renvoie a l'organisme editeur, pas a un chantier nomme « Office ».

Structure reelle :
- p.1-2 : page de garde / contexte, liste des membres du groupe de travail redacteur (architectes, entrepreneurs, economiste, bureaux d'etudes) et des deux signataires de validation (Presidents de l'Office du BTP et de la Federation du BTP Drome-Ardeche) ;
- p.3 : Fiche 2 « la reunion de chantier : ses objectifs » ;
- p.4 : Fiche 3 « le deroulement d'une reunion de chantier » ;
- p.5 : Fiche 4 « le compte-rendu de reunion », avec une section dediee « SI OPC » (la plus pertinente pour la famille documentaire OPC/coordination testee) ;
- p.6-10 : annexes (abreviations, glossaire d'une vingtaine de termes techniques).

Chaque fiche est presentee en tableau a 3 colonnes (Constats / Preconisation / Outil). La Fiche 1 « Preparation de chantier », annoncee au sommaire, est absente du contenu effectif — possible page manquante a la numerisation, sans lien avec l'echec d'extraction constate ici.

Ce format differe fortement du gabarit CR de chantier habituel du corpus : pas de tableau de presence date (present/absent par entreprise), pas de section par lot avec avancement/reserves/actions a echeance, pas de date de reunion, pas de nom de chantier ni d'operation. Les seules dates du document sont la validation CA du 17/06/2008 (repetee en pied de page) et l'absence totale de date de reunion de chantier.

## Comparaison element par element

38/38 elements de reference MISSED, 0 MATCHED, 0 PARTIAL. Repartition :
- company (8/8 manques) : Office du BTP Drome-Ardeche, Federation du BTP Drome-Ardeche, SOBRABO, TRAVERSIER, UNTEC, BETREC IG, BET MATHIEU, PEYRIN/MOUNIER.
- person (10/10 manques) : Noel CESSIEUX, Frederic REYNIER, Jean-Claude MICHEL, Yvon TIXIER, Bruno LESAGE, Maurice TRAVERSIER, Yves SARRION, C. VUYLSTEKE, SOULAT, Pierre MOUNIER.
- decision (1/1 manque) : validation du document en CA le 17/06/2008.
- knowledge_fact (19/19 manques) : l'ensemble des preconisations et regles methodologiques des Fiches 2 a 4 (classees permanent_instruction/general_knowledge par la reference).

unmatchedProposals = [] : aucune proposition MemorIA a classer en FALSE_POSITIVE ou LEGITIMATE_EXTRA, puisque le pipeline n'a rien produit.

## Rappel / precision par famille

| Famille | Elements ref. | Recall | Propositions MemorIA | Precision |
|---|---|---|---|---|
| company | 8 | 0 % (0/8) | 0 | N/A |
| person | 10 | 0 % (0/10) | 0 | N/A |
| decision | 1 | 0 % (0/1) | 0 | N/A |
| knowledge_fact | 19 | 0 % (0/19) | 0 | N/A |
| deadline / action / observation / reservation | 0 | -- | 0 | -- |

Global : recall = 0/38 (0 %), precision non calculable (aucun vrai/faux positif, base de propositions vide).

## Hypothese de cause (non verifiee par execution, non corrigee)

L'evidence cote MemorIA contient bien 1 image detectee en page 1 (le logo de couverture, img-p1-1.png, caption « Logo O »), ce qui exclut un echec de lecture/parsing pur du PDF : le pipeline a bien acces au contenu d'au moins la page 1. Le probleme se situe donc en aval, au niveau de la generation de propositions a partir du texte, pas en amont au niveau de l'ingestion.

Hypothese structurelle : l'etape d'extraction/classification du pipeline semble attendre des signaux caracteristiques d'un CR de chantier classique (tableau de presence date, ordre du jour, points par lot avec avancement/reserves/actions) pour declencher la generation de propositions. OPC_006 n'a aucun de ces signaux — c'est un document methodologique en fiches, sans date de reunion ni chantier nomme — ce qui a pu conduire a un classement implicite du document comme « sans contenu extractible », alors qu'il contient en realite du texte riche, des personnes et des societes nommees sur 10 pages.

Cette hypothese repose sur la comparaison structurelle reference.json / memoria-output.json et sur les readerNotes de la Phase A ; aucune trace d'execution du pipeline (logs Gemini, prompt reel envoye, reponse brute du modele) n'a ete consultee, et aucune modification du pipeline, du prompt ou du modele n'a ete effectuee dans le cadre de cette tache (lecture seule).

## Photos

Reference : 4 photos, toutes role=decorative (logo institutionnel repete en en-tete des pages 1, 3, 4, 5). MemorIA : 1 evidence image (page 1), coherente avec le logo de couverture. Convergence correcte sur ce point isole — les logos decoratifs ne generent a juste titre aucune proposition des deux cotes.

## Conclusion

OPC_006 est un FAIL de recall (0 %), pas un cas de tolerance zero. Contrairement a BTP_008 (reference vide, resultat vide, PASS legitime), OPC_006 a une reference non vide (38 elements reels et nommes) mais un resultat MemorIA vide : c'est une vraie perte de recall, tres probablement liee au format atypique du document (note methodologique en fiches, sans les signaux structurels d'un CR de chantier classique) plutot qu'a un deficit generique du pipeline sur ce type de contenu. Aucune correction n'a ete appliquee ; ce constat est a verser a la synthese transversale de la Phase D comme un cas de sensibilite au format documentaire.
