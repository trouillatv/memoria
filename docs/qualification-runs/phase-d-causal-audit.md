# Audit causal — biais de typage, échecs totaux, faux positifs (lecture seule, aucune correction appliquée)

Fait suite à `phase-d-final-synthesis.md` (baseline 25 documents, commit `a7af1eb9`). Ce document explique le **pourquoi** des trois anomalies identifiées dans la baseline. Aucun fichier de code n'a été modifié pendant cet audit.

## 1. Cause racine du biais dominant (190 MISCLASSIFIED, absorption vers `knowledge_fact`)

**Verdict : ce n'est ni un bug de code, ni un défaut de schéma. C'est un déséquilibre de rédaction du prompt.**

- **Remapping post-LLM (cause code) — écarté.** `lib/documents/extract-historical-pv.ts:307` persiste `p.family` tel que renvoyé par Gemini, sans coercition : `proposal_family: p.family as DocumentProposalFamily`. Aucune logique de code ne change la famille après la réponse du modèle.
- **Schéma structurel — écarté.** L'enum `family` (`historical-visit-extractor.ts:17` et `:60`) liste les 8 familles à plat, sans valeur par défaut ni poids implicite vers `knowledge_fact`.
- **Prompt — cause confirmée.** Le bloc de définitions de familles (`historical-visit-extractor.ts:190-208`) traite `knowledge_fact` très différemment des 4 autres familles concernées :
  - `decision` (ligne 194), `observation` (ligne 195), `reservation` (ligne 192) tiennent chacune en **une seule phrase**, sans critère de détection vérifiable.
  - `knowledge_fact` (lignes 197-206) est au contraire assortie de **règles prioritaires explicites** qui court-circuitent les autres familles, notamment :
    - Ligne 200 : *« Règle prioritaire : toute section intitulée "PRÉVISIONS", "PROGRAMME", "TRAVAUX PRÉVUS"... → extraire chaque item comme knowledge_fact avec thematic_category='forecast', même sans responsable ni date explicite. Ne jamais classer un item d'une section PRÉVISIONS comme observation ou action. »*
    - Ligne 180 : *« un travail décrit au passé ou comme terminé (« déblais terminés », « purge exécutée ») → knowledge_fact avec statusAtDocumentDate='réalisé', jamais une action ou observation. »*
    - Ligne 147 : exception « MOYENS HUMAINS ET MATÉRIELS » → knowledge_fact systématique.
  - `action` (ligne 193) contient elle-même un fallback explicite qui alimente une partie de l'absorption inverse : *« Créer une action UNIQUEMENT si un responsable est explicitement nommé... OU si un délai précis est mentionné. Sans ces deux conditions → observation. »*

Ces règles ne sont pas fausses individuellement — mais elles sont plus détaillées et plus prioritaires que les définitions des familles qu'elles avalent, ce qui explique un biais structurel et reproductible plutôt qu'un bruit aléatoire.

### Détail par famille source

| Famille source | Recall | Destination dominante | Mécanisme confirmé (citation) |
|---|---|---|---|
| **observation** (19,6 %) | 🔴 | knowledge_fact | Règle ligne 180 (« terminé → knowledge_fact, jamais observation ») + exception ligne 147 (moyens humains/matériels). Exemples : LRM_CR07-E27/E28 (constats d'hypothèse/absence classés knowledge_fact), MEL_CR03-E33/E38 (« En attente », « Visite effectuée le… » classés knowledge_fact). |
| **decision** (39,7 %) | 🔴 | knowledge_fact (solutions techniques actées) / action (décisions avec acteur nommé) | Absence de critère de détection propre (ligne 194) face à la règle prioritaire « PRÉVISIONS » (ligne 200) et au test `action` (ligne 193, responsable nommé). Exemples : LRM_CR04-E38/E39/E40/E43 (solutions retenues → knowledge_fact), LRM_CR04-E41 (« Prévoir un petit chéneau en plomb » → action, acteur+impératif). |
| **deadline** (59,1 %) | 🟡 | knowledge_fact.forecast (plages/tranches sans date calendaire ponctuelle) / action (échéance avec acteur nommé) | Ligne 200, clause de distinction : une plage (« Tranche ferme : 7 mois – Sept 2014/Mars 2015 ») sans date ponctuelle bascule en knowledge_fact.forecast même si la référence humaine la garde en `deadline`. Exemples : LRM_CR04-E34/E35. |
| **action** (67,5 %) | 🟡 | knowledge_fact (action au passé/conditionnel) / observation (pas d'acteur syntaxiquement explicite) | Même mécanisme ligne 180 pour le sens action→knowledge_fact ; fallback explicite ligne 193 pour action→observation (écrit noir sur blanc dans la règle elle-même). Exemples : LRM_CR07-E46 (« l'entreprise indique déposer… » → knowledge_fact), LRM_CR07-E48/MEL_CR03-E43 (pas de responsable syntaxique → observation). |
| **reservation** (46,6 %) | 🟠 | action (réserve avec acteur d'investigation nommé) / knowledge_fact (réserve formulée en état conditionnel) | Définition la plus courte du bloc (ligne 192, une phrase, aucun critère de distinction vs action/knowledge_fact). Exemples : LRM_CR07-E24 (« A charge du BET de déceler… » → action), LRM_CR04-E71/E74 (formulation d'état → knowledge_fact). |

**Précision par contraste** : `person` (91,1 %) et `company` (85,1 %) n'ont **aucune** règle prioritaire concurrente dans le prompt qui pointe vers `knowledge_fact` — cohérent avec leur bonne performance et renforçant le diagnostic (le défaut est localisé aux 5 familles qui entrent en collision avec les règles `knowledge_fact`/`action`, pas un problème général d'extraction).

## 2. ENV_001 et OPC_006 — où disparaît le contenu

**Confirmé par les logs (`phase-b-retry-batch2.log`, `phase-d-run-out.log`)** : le texte traverse intégralement le rendu PDF et l'extraction (23 952 caractères pour ENV_001, 16 670 pour OPC_006), atteint l'appel Gemini (`step_llm_analysis`), et Gemini répond un JSON valide avec `proposals: []` et `evidence: []`, sans erreur ni troncature. La disparition se produit **dans la réponse du LLM elle-même**, pas dans une perte technique en amont ou en aval (persistance vérifiée correcte).

**Cause probable (hypothèse forte, non prouvable sans log du raisonnement Gemini)** : les deux documents ne sont pas des PV de visite de chantier réels.
- **ENV_001** = charte contractuelle environnementale générique (clauses type NF HABITAT HQE), sans nom de chantier, de personne ni d'entreprise réelle — confirmé par les `readerNotes` de la référence humaine elle-même.
- **OPC_006** = note méthodologique publiée par un office professionnel du BTP sur « comment mener une réunion de chantier », sans événement daté sur un site réel — même constat des `readerNotes`.

Le prompt contient une doctrine d'exclusion explicite et volontaire de ce type de contenu (`historical-visit-extractor.ts:126-127` « règles génériques applicables à tous les chantiers → ne rien créer » ; ligne 132-133 « si retrouvable dans 80 % des PV d'autres chantiers → ne rien créer »). Gemini applique vraisemblablement cette doctrine avec un excès de zèle sur des documents qui sont *entièrement* composés de ce type de contenu — la doctrine anti-bruit, conçue pour filtrer quelques lignes génériques au sein d'un vrai PV, aboutit à un rejet intégral quand le document entier est générique.

**Ce n'est donc pas un défaut isolé du même type que le biais §1** : c'est soit (a) un cas limite du corpus de stress-test (ces deux documents ne sont pas des PV au sens où le pipeline est conçu pour en traiter), soit (b) un vrai angle mort produit — l'absence de tout signal de sortie autre que « 0 proposition, statut ready_for_review », indiscernable d'un vrai PV vide, qui empêcherait de distinguer en production un rejet légitime d'un échec silencieux.

**Point secondaire, non causal** : les 14 images ENV_001 sont des scans pleine page (couverture ~100 % de la page), pas des photos de chantier — le filtre `MIN_PAGE_COVERAGE` (`extract-images.ts:25`) ne fait pas la distinction. Sans impact sur le résultat 0-proposition puisque ces evidences sont orphelines (jamais référencées).

## 3. Les 4 faux positifs (0,39 % — à préserver)

| Document | Famille | Fabrication | Mécanisme |
|---|---|---|---|
| LRM_01 | deadline | Date complète « 2014-09-01 » inventée à partir d'une source disant seulement « septembre 2014 » | Le schéma impose un format ISO complet pour `dueDate` ; le modèle comble la granularité manquante par un jour par défaut au lieu de laisser le champ vide |
| BTP_009 | company | Entité « bureau d'étude GO » créée à partir du sigle de lot « GO » (Gros Œuvre), avec rôle « maître d'œuvre » recopié de l'entité voisine (l'architecte) | Un sigle/rôle sans nom propre est traité comme une entité nommable ; contagion d'attribut depuis une entité voisine dans le texte |
| REC_001 ×2 | knowledge_fact / reservation | Deux cases à cocher lues à l'envers (« installations non repliées », « terrains non remis en état » — inverse de ce qui est réellement coché) | Le glyphe de case cochée (■/□) est perdu par l'extraction PDF→texte en amont de Gemini ; les deux options du formulaire arrivent concaténées et indiscernables, le modèle tranche au hasard (3/5 cases du même formulaire lues correctement, 2/5 à l'envers) |

**Garde-fous déjà en place à préserver explicitement** : ligne 176 (*« Ne jamais inventer des données absentes du texte — extraction pure, zéro inférence »*) et ligne 179 (*« Lorsque le texte source semble corrompu ou ambigu, ne pas affirmer plus que ce que le document permet »*). Ces deux règles expliquent déjà le taux de 0,39 % — toute correction doit les laisser intactes et ne pas introduire de mécanisme de complétion automatique (date par défaut, rôle hérité par proximité, résolution arbitraire d'un choix binaire ambigu).

## 4. QHSE_003 — rappel, hors périmètre de ce lot

Diagnostic déjà établi et non ré-audité ici : échec technique **persistant** (timeout Gemini répété, 3 tentatives, jusqu'à 233 985 ms), jamais résolu, document exclu de tout scoring. C'est un problème de robustesse infrastructurelle sur un document volumineux, indépendant des trois sujets ci-dessus. BTP_009, qui a rencontré le même symptôme mais a réussi au simple rejeu, confirme que ce n'est pas systématique — QHSE_003 reste un cas isolé à traiter séparément.

## 5. Lots de correction proposés (P0 / P1) — aucun code produit

### P0 — effet de levier maximal sur le défaut dominant

- **P0-1 — Rééquilibrer les définitions de familles dans le prompt.** Donner à `decision`, `observation` et `reservation` des critères de détection aussi explicites que ceux de `knowledge_fact` (actuellement une phrase contre un bloc de règles prioritaires), et clarifier explicitement l'ordre de priorité entre les règles concurrentes (section PRÉVISIONS vs decision ; « terminé » vs observation ; responsable nommé vs reservation/action). Modification **prompt uniquement**, pas de schéma ni de code. C'est le lot qui adresse directement les 3 familles les plus faibles (observation 19,6 %, decision 39,7 %, deadline 59,1 %).
- **P0-2 — Traiter explicitement le cas des documents non-PV (type ENV_001/OPC_006).** Décision produit à trancher : soit un signal de sortie distinct (ex. proposition unique de type « document hors périmètre chantier », ou un statut dédié) plutôt qu'un `ready_for_review` à 0 proposition indiscernable d'un vrai échec silencieux ; soit un ajustement de la doctrine d'exclusion pour qu'elle s'applique élément par élément plutôt qu'au document entier. Nécessite un arbitrage produit avant tout code (choix UX structurant entre options).

### P1 — corrections plus localisées, effet plus étroit

- **P1-1 — Granularité des dates `deadline`.** Autoriser une précision partielle (mois/année) sans forcer un jour ISO complet, à l'image de ce que fait déjà la référence humaine. Corrige à la fois une partie de l'absorption deadline→knowledge_fact.forecast (plages de tranches) et le faux positif LRM_01.
- **P1-2 — Garde-fou entité company.** Ne pas créer d'entité `company` à partir d'un sigle/rôle sans nom propre explicite, et ne pas hériter d'attributs (rôle) d'une entité voisine dans le texte. Corrige le faux positif BTP_009 ; portée étroite (1 cas observé dans ce corpus).
- **P1-3 — Préservation du glyphe de case à cocher en amont de Gemini.** Corriger l'extraction PDF→texte pour conserver ou signaler explicitement l'état ■/□ des cases à cocher, plutôt que de laisser Gemini deviner un choix binaire non résolu. Modification de code (couche d'extraction texte, en amont du prompt), pas du prompt. Portée étroite (documents à formulaire, 1 document dans ce corpus).
- **P1-4 — Filtre image scan pleine page vs photo réelle.** Affiner `MIN_PAGE_COVERAGE`/logique de filtrage dans `extract-images.ts` pour ne pas comptabiliser des scans pleine page comme des photos de chantier. Cosmétique, non causal au problème de fond, faible priorité.

## Arrêt volontaire

Aucune modification de prompt, de schéma, de modèle ou de code n'a été appliquée pendant cet audit. Les lots ci-dessus sont des propositions à arbitrer, pas des tickets prêts à coder — notamment P0-2 qui requiert une décision produit avant toute implémentation.
