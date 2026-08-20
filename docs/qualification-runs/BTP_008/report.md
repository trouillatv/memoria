# Rapport de qualification — BTP_008

## Verification tolerance zero : PASS

BTP_008 est un cas de test de **non-hallucination volontaire**. Le document source (`BTP_008_4_parisbelleville_moe.pdf`) n'est pas un compte-rendu de chantier reel : c'est un guide methodologique HMONP redige par Thierry Roussel (ENSA Paris Belleville, mars 2021), qui contient un modele de compte-rendu **vierge** en pages 5 a 9 (tableau des participants vide, champs date/lieu/operation non renseignes, rubriques du plan — avancement, securite, HQE, suivi financier — non remplies).

- **Reference (Phase A, lecture independante du PDF)** : 0 element metier retenu (`elements: []`). La note de lecture confirme explicitement qu'aucune personne, entreprise, reserve, action, decision ou echeance reelle n'est identifiable, y compris l'auteur du guide (mentionne uniquement en en-tete/pied de page, sans statut de presence a une reunion datee).
- **MemorIA (Phase B, extraction Gemini reelle en production)** : 0 proposition produite, toutes familles confondues (person, company, action, decision, deadline, observation, knowledge_fact).

Les deux cotes convergent sur zero element metier. Aucune hallucination detectee sur un document concu pour pieger un extracteur trop permissif (vocabulaire et structure de CR de chantier, mais rubriques vides). **Tolerance zero respectee.**

## Comparaison element par element

Sans objet : `referenceElementCount = 0`, donc aucun appariement a effectuer (`elementMatches: []`).

## Propositions MemorIA non appariees

Sans objet : `memoriaProposalCount = 0`, donc aucune proposition a classer en FALSE_POSITIVE ou LEGITIMATE_EXTRA (`unmatchedProposals: []`).

## Rappel / precision par famille

Non calculables (aucun element de reference, aucune proposition). Ce cas ne mesure pas la performance d'extraction du pipeline mais sa resistance a l'hallucination.

## Comparaison photo

1 preuve image de chaque cote :
- Reference : 1 photo (bandeau graphique de couverture, page 1, role `decorative`).
- MemorIA : 1 evidence de type `image` (page 1, meme zone).

Pas de comparaison photo dediee pour ce document (contrairement a VRD_002 ou JAR_01) — simple constat de coherence du decompte.

## Conclusion

BTP_008 est un **PASS** pour le critere de tolerance zero : sur un document gabarit sans contenu metier reel, ni la reference independante ni le pipeline de production MemorIA n'ont produit ou retenu d'element invente. Ce resultat corrobore la constatation de la Phase B (0 proposition) et valide que l'extraction Gemini ne sur-genere pas de faits a partir d'une structure de document qui ressemble a un CR de chantier sans en etre un.
