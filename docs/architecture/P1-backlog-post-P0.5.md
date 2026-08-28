# MemorIA — P1 restant à traiter après P0.5

**Consolidation audit bureau + mobile — 28/29 août 2026.**
Roadmap P1 canonique (remplace l'ancien stub). Source : fichier de pilotage Vincent
`MemorIA_P1_restant_bureau_mobile_20260829_ACTUALISE`.

> Ce document ne liste que les points **encore ouverts** retenus pour **P1**.
> Il **n'inclut pas les corrections P0.5 déjà livrées** : header chantier uniforme ;
> retour en haut au changement de vue/sous-vue (restauration au retour d'une fiche) ;
> migration Historique → Suivi ; Relations = état vide compact / « Ajouter un lien ».

**Statut : MÉMORISÉ, NON DÉVELOPPÉ.** Ne rien coder avant réouverture explicite de P1.
P0.5 (occurrence-first, imports ≠ visites terrain, action « en retard » canonique,
nav/UX) est **gelé** et ne doit pas être rouvert pour ces points.

---

## 1. Transverse bureau + mobile

### P1.1 — Garder visible la pilule / l'onglet actif dans les barres horizontales
*(→ ABSORBÉ par P0.5 : `ScrollActiveRail`. Conservé comme critère de non-régression.)*
Après navigation, repositionner la barre sur l'élément actif ; la pilule active reste
visible, idéalement centrée. À distinguer du scroll vertical (P0.5).

### P1.2 — Rendre les contenus tronqués réellement explorables
*(→ ABSORBÉ par P0.5 pour « Ce que le chantier sait » : « Voir N de plus » / « Réduire ».)*
Les « … et 17 autres », « … et 7 autres », « +17 » de Patrimoine deviennent
interactifs (dépliage sur place + « Réduire »), sans nouvelle page. Vérifier qu'il ne
reste plus d'autre « +N » non dépliable dans Patrimoine.

---

## 2. Bureau — Suivi

### P1.3 — Revoir la carte « Sujets importants » lorsqu'elle est vide
Réduire fortement l'emprise de l'état vide, ou masquer la section quand elle n'apporte
rien. Ne pas inventer de sujet « important » pour remplir la carte.

### P1.4 — Alléger la vue Évolution
Conserver la valeur narrative, mais renforcer la lecture à deux niveaux (compréhension
immédiate puis détail). Éviter de devoir parcourir toute la chronique. Ne pas refaire
le moteur de vérité : travail de hiérarchie/restitution uniquement.

### P1.5 — Reconsidérer le graphique « Sujets opérationnels ouverts »
Sur Bella (2 points, ligne plate à 7) il apporte peu. Le conditionner à une vraie
valeur analytique ; pour un historique pauvre, indicateur compact ou masqué. Ne pas
supprimer la capacité graphique pour les chantiers à histoire riche.

### P1.6 — Vérifier la hiérarchie Synthèse / Attention / Évolution / Lignes de vie / PV
Doctrine à préserver : Synthèse = comprendre vite ; Attention = vigilance maintenant ;
Évolution = ce qui a changé dans le temps ; Lignes de vie = trajectoire détaillée ;
PV = lecture documentaire/source. Réduire les redondances de restitution **sans**
fusionner ces fonctions.

---

## 3. Mobile — Patrimoine / Synthèse

### P1.7 — Clarifier « ce que le chantier sait » vs « état du chantier aujourd'hui »
Patrimoine mélange faits mémorisés / intervenants / décisions / points de vigilance,
puis l'état opérationnel. **Patrimoine** = ce que MemorIA sait et peut prouver ;
**Aujourd'hui** = ce qui nécessite action/attention maintenant. Un point de vigilance
peut rester dans le patrimoine, mais son urgence est portée par les vues opérationnelles.

### P1.8 — Typologiser la liste « Sujets suivis » de Patrimoine
Aujourd'hui personnes / organisations / sujets chantier sont au même niveau, même icône
(ex. Stéphane LACHOQUE, CAPSE NC, Bureau Veritas, MIES, « Dégagement extérieur du Mall »).
Ne supprimer aucun élément sans occurrence ; montrer au minimum le type ; idéalement
séparer intervenants/organisations des autres sujets mémorisés.

---

## 4. Mobile — Sujets / fiche sujet

### P1.9 — Auditer la sémantique du statut « Ouvert » sur les situations récurrentes
Témoin : **Récupération des huiles usagées** (marqué `Ouvert` alors que c'est un
processus établi/récurrent). `Ouvert` = « problème non résolu » ou englobe-t-il une
obligation/pratique récurrente ? Auditer données + états canoniques **avant** tout
wording ; vérifier des sujets comparables (cas isolé vs limite du modèle d'état).

### P1.10 — Stabiliser la structure des fiches Sujet plutôt que la refondre
La fiche « Contrôle des installations électriques » a la bonne séquence (situation →
ce qui s'est passé → objets actifs → ligne de vie/preuves). Conserver cette grammaire ;
les corrections P1 visent les incohérences de contenu/état, pas une refonte visuelle.

---

## 5. Mobile — Visites / vérité affichée *(→ LIVRÉ en P0.5-Vérité, critères de non-régression)*

### P1.11 — [LIVRÉ P0.5] Imports historiques restitués comme visites terrain
Séparation stricte livrée : `origin ∈ planned|spontaneous|qr|gps` = visite terrain ;
`origin='import'` = PV/CR historique importé, jamais compté visite / première / dernière
visite, jamais « En cours », daté à `documents.effective_date`. Primitive partagée
`lib/field/visit-origins.ts` + convergence de 18 read-models. Imports conservés dans
mémoire/occurrences/sujets/Chronologie/Frise/PV.

### P1.12 — [LIVRÉ P0.5] Contradiction « Dernière visite : Aucune » / « 2 visites »
Même cause racine que P1.11, corrigée par la définition commune. Bella affiche
désormais 0 visite terrain / 2 PV-CR historiques / Dernière visite = Aucune (cohérent)
/ mémoire documentée depuis juillet 2024.

**Critères de recette (tenus) :** aucun import en « Visite historique » dans la liste
Visites ; aucun « En cours » sur `ended_at IS NULL` d'un import ; N visites / première /
dernière visite = terrain ; aucune date technique présentée comme date métier ; 2 PV/CR
visibles dans surfaces documentaires ; occurrences/sujets/preuves intacts ; Chronologie/
Frise 2024/2025 ; non-régression sites imports+terrain ; desktop+mobile ; corpus OCEF.

---

## 6. Points P1 antérieurs à garder au backlog

### P1.13 — Aperçu
Poursuivre l'audit : la hiérarchie répond d'abord aux questions opérationnelles avant de
proposer de la navigation supplémentaire.

### P1.14 — Préparer / non-mention
Une non-mention lors de la préparation d'une visite ≠ résolution/disparition. Le dernier
état prouvé reste la référence tant qu'aucune nouvelle preuve ne le remplace.

### P1.15 — Intervenants
Distinguer clairement identité, organisation/rôle et sujets métier, dans les surfaces où
ces objets sont aujourd'hui mélangés.

---

## 7. Complément recette PETRO ATTITI — reportés après P0.5

### P1.16 — Repenser la hiérarchie de l'Aperçu
Faire remonter attention, propositions/décisions à arbitrer, retard, évolutions
significatives ; reléguer les KPI secondaires sans décision. Hiérarchie, pas refonte.

### P1.17 — Réduire la densité de « Connaissances validées »
Lecture progressive (regroupements, compteurs, catégories, dépliage/réduction) sans
perdre aucune connaissance validée ; éviter la page à parcourir intégralement.

### P1.18 — Repenser le workflow « À confirmer »
PETRO : 13 propositions de natures différentes au même niveau → dette de validation.
Distinguer les types d'arbitrage (priorité, regroupement, gestes adaptés). Ne pas
dégrader l'extraction pour réduire le volume.

### P1.19 — Expliquer « dernière évolution réelle » vs « dernière observation »
Conserver les deux dates (`lastMeaningfulChangeAt` vs dernière observation), rendre leur
différence immédiatement compréhensible, sans fusionner les notions.

### P1.20 — Clarifier la chaîne VISITE → ACTION → PREUVE
Une « action clôturée » prouve son état de clôture, pas nécessairement le résultat
attendu. Distinguer origine / action / état / preuve / causalité, sans rouvrir le moteur
longitudinal.

### P1.21 — Améliorer l'état vide de l'onglet PV
PETRO a des visites terrain mais 0 PV historique. Expliquer que PV = lecture des PV
historiques ; orienter vers Évolution / Lignes de vie ; ne pas fabriquer de PV depuis
les visites. *(Cohérent avec P0.5-Vérité : imports ≠ visites.)*

### P1.22 — Raffiner Évolution + typologie des sujets après P0.5
Évolution reste témoin de non-régression pendant P0.5. Raffiner ensuite la hiérarchie
des changements + la typologie des sujets ; articuler avec P1.4/P1.6.

### P1.23 — Proposition/action « Finaliser la sécurisation du site (cadenas) »
**Audit P0.5 = verdict D** : deux objets réels distincts (action `714d040e` open +
action `50c306b1` done), même sujet canonique `6801ce5c`, provenances différentes — pas
un doublon. P1 = restitution : expliciter proposition source / action matérialisée /
sujet canonique ; empêcher l'impression de recréer une action existante ; ne pas masquer
une ambiguïté d'identité par du wording.

---

## Reclassement après la fermeture P0.5 (déjà livrés — non redéveloppés en P1)
- P1.1 — pilule/onglet actif visible ;
- P1.2 — contenus « +N autres » dépliables ;
- P1.11 / P1.12 — séparation imports historiques / visites terrain, compteurs et dates ;
- cohérence « actions en retard » Aperçu / Actions ;
- header chantier uniforme, scroll vertical, Historique → Suivi, Relations.

Ils restent ici comme historique de diagnostic + critères de non-régression ; leur
implémentation appartient à P0.5.

## Hors P1 / à ne pas rouvrir dans ce lot
Ne pas relancer : refonte générale de l'interface ; graphe/treemap/drag & drop des
relations ; écran global « Dépendances » ; convergence canonique déjà livrée ; lots
PWA/WhatsApp/Visites déjà livrés (hors anomalies constatées ci-dessus) ; refonte des
cartes/couleurs/espacements sans problème utilisateur démontré.

---

## Ordre recommandé
- **P1-A — Vérité / cohérence** : sémantique `Ouvert` des situations récurrentes (P1.9) ;
  non-mention / dernier état prouvé (P1.14). *(P1.11/P1.12 livrés en P0.5.)*
- **P1-B — Navigation et accès à l'information** : compléter l'exploration des contenus
  tronqués restants (P1.2). *(Pilule active livrée en P0.5.)*
- **P1-C — Hiérarchie de lecture** : Patrimoine vs état actuel (P1.7) ; typologie
  sujets/intervenants (P1.8/P1.15) ; carte « Sujets importants » vide (P1.3) ; allègement
  Évolution + conditionnement du graphique (P1.4/P1.5) ; redondances des 5 sous-vues Suivi (P1.6).
- **P1-D — Stabilisation** : conserver la grammaire des fiches Sujet (P1.10) ; recette
  croisée bureau + mobile sur Bella avant clôture du lot.
