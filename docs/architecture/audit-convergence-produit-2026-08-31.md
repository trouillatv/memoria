# Audit de convergence produit — post-P0.5, préparation P1

**Date** : 2026-08-31. **Mode** : AUDIT SÉRIEUX / READ-ONLY. **Statut** : diagnostic livré, **AUCUN CODE ÉCRIT**.
Exécuté via 7 agents parallèles en lecture seule sur le dépôt réel (code, migrations, docs d'architecture), en confrontation avec `docs/architecture/P1-backlog-post-P0.5.md` et la mémoire des recettes BELLA/PETRO/DOVANT.

**HARD STOPS respectés** : aucune modification de fichier, aucune activation de Dépendances, aucun contact avec le moteur de relations/`canonical_subject`/`canonical_subject_occurrence`, aucune donnée prod modifiée, aucun backfill.

---

## A. Inventaire des écrans audités

**Desktop** (`app/(dashboard)/sites/[id]/`) : Aperçu, Visites (liste + détail), Chronologie, Suivi (Synthèse/Attention/Évolution/Lignes de vie/PV), Dépendances (masqué), Planning (Vue d'ensemble/Travaux/Agenda/Échéances), Documents-preuves, Intervenants, Mémoire (3 sous-vues), Actions, Réserves, Explorer, Fiche sujet canonique, fiches Personne/Action/Décision (overlay).

**Mobile** (`app/(field)/m/site/[siteId]/`) : Synthèse, Sujets (À surveiller/En mouvement/En attente/Tout), Carte, Terrain, Explorer, Réserves, Actions, Visites, Photos, Réunions, Frise, Documents (conditionnel), Patrimoine, fiche sujet canonique, Préparer ma visite, recap post-visite.

**Code mort/orphelin découvert** (non demandé mais signalé, lecture seule) : `/sites/[id]/documents`, `/sites/[id]/memoire` (hub legacy), `/sites/[id]/subjects` (hub legacy), `/sites/[id]/chronicle` + `SiteDomainHub.tsx` — routables mais sans `SiteChantierNav`, plus référencées par aucun lien de nav actif.

---

## B. Tableau écran par écran

### B.1 Navigation globale + Aperçu

| Écran | Question utilisateur | État actuel | Ce qui fonctionne | Défaut réel | Existe déjà ailleurs ? | Modification recommandée | Priorité |
|---|---|---|---|---|---|---|---|
| Nav N1 | Cohérence desktop/mobile ? | PARTIEL | Même composant `ScrollActiveRail`/`aria-current` sur les deux rails N1. | Taxonomie divergente : desktop 11 entrées groupées (dont Suivi=5 sous-vues) vs mobile 13 entrées plates (`SiteTabsNav.tsx:5-34` vs `SiteTabs.tsx:29-43`). Aucune doc ne justifie la double architecture. | Non | Documenter l'écart si assumé (mobile=terrain, desktop=pilotage) ou fusionner ; arbitrage produit requis. | P1-C |
| Nav N1 (pilule active) | Reste-t-elle visible après navigation (P1.1) ? | OK | `ScrollActiveRail` recentre `[aria-current="page"]`, câblé N1 desktop et mobile. | — | — | Aucune | — |
| Nav N2 Suivi | `ScrollActiveRail` + `scroll={false}` cohérents avec Planning/Mémoire ? | BUG | Pattern déjà présent sur `PlanningSubTabs.tsx`/`MemoireSubTabs.tsx`. | `historique/page.tsx:244-263` (5 sous-onglets Suivi) n'a ni `ScrollActiveRail`, ni `aria-current`, ni `scroll={false}` → recharge en haut de page à chaque changement, contrairement à Planning/Mémoire. | Oui, 2 fichiers frères | Ajouter `ScrollActiveRail`/`aria-current`/`scroll={false}` sur `viewHref()`. | P1-B |
| Fiche overlay | Un seul mécanisme d'ouverture de fiche ? | DOUBLON | `PersistentFicheSheet` (Lot 2) documenté comme solution canonique. | Un second mécanisme concurrent (routes interceptées `@fiche/(.)action|decision|intervenant`, qualifié « PROTOTYPE Lot 3 » dans son propre commentaire) est en réalité utilisé par la quasi-totalité des liens réels (`actions/page.tsx`, `SiteMemoryQuery.tsx`, fiche sujet, `IntervenantFiche.tsx`, Explorer). | Oui, les deux coexistent | Trancher lequel devient canonique — le code lui-même signale le doute. | P1-B |
| Header chantier | `SiteChantierNav` sur toutes les routes ? | PARTIEL | Présent sur Aperçu/Actions/Réserves/Suivi. | Absent sur 3 routes legacy orphelines (`documents`, `memoire`, `subjects` hubs) — probablement mortes mais encore routables. | Le composant existe | Supprimer si mort, sinon y poser `SiteChantierNav`. | P2 |
| Aperçu | Hiérarchie opérationnelle avant navigation (P1.13) ? | À POLIR | Read-model unique `getSiteOverview`, vide-safe partout. | « Ce qui demande votre attention » arrive en 6ᵉ position du DOM, après Copilote et Dernière visite. | Population complète déjà dispo sur Suivi›Attention | Envisager de remonter la section Attention — nécessite validation terrain, pas un simple réordonnancement technique. | P1-A (reformulé) |
| Aperçu | KPI secondaires reléguées (P1.16) ? | À POLIR | 4 `StateCard` déjà colorées par sévérité. | Poids visuel identique qu'il y ait 0 ou N items — une carte verte occupe le même espace qu'une carte rouge. | Non | Réduire la densité des tuiles à 0/vert. | P1-C |
| Aperçu | Hero card duplique des CTA ? | DOUBLON | Composants réutilisés tels quels (`SiteBriefButton`, `QuickActionButton`). | 3 doublons confirmés : « Préparer ma visite » (hero ET carte « Prochaine étape »), « Planifier » (hero ET repli « Prochaine étape »), « Créer une action » (`QuickActionButton` ET `SiteAddMenu`). | Les deux exemplaires existent déjà | Retirer un exemplaire de chaque paire. | P1-B |
| Aperçu | S'adapte à chantier pauvre/riche ? | OK | Toutes les sections à forte densité sont conditionnelles, aucun état vide cassé. | — | — | Aucune | — |

### B.2 Suivi (5 sous-vues) + Dépendances

| Écran | Question utilisateur | État actuel | Ce qui fonctionne | Défaut réel | Existe déjà ailleurs ? | Modification recommandée | Priorité |
|---|---|---|---|---|---|---|---|
| Synthèse › Sujets importants | Qu'est-ce qui compte ? | À POLIR | Scoring déjà filtré (seuil 12, plafond 6). | État vide toujours rendu en carte pleine taille (`SyntheseView.tsx:156-209`). | Non | Réduire le poids visuel de l'état vide. | P1-C |
| Synthèse › Sujets à surveiller | Quels sujets stagnent ? | DOUBLON partiel | `computeWatchlist()` autonome et propre. | Deux moteurs distincts non prouvés convergents avec Attention (`deriveCanonicalAttentionItems`). | Oui, Attention | Ne pas fusionner les moteurs (hors périmètre) ; vérifier/documenter la divergence. | P1-C |
| Synthèse › Histoire récente | Que s'est-il passé récemment ? | DOUBLON | Affiche 5 derniers PV. | Chevauche Évolution › Chronique complète. | Oui, Évolution | Réduire à un rappel court + lien. | P1-C |
| Synthèse › Delta depuis dernier PV | Qu'est-ce qui a changé ? | DOUBLON partiel | Vocabulaire de transition cohérent. | Chevauche la période la plus récente d'Évolution › Chronique. | Oui, Évolution | Conserver dans Synthèse (résumé immédiat = sa fonction), vérifier qu'Évolution ne réaffiche pas le même delta en tête. | P2 |
| Attention | Vigilance maintenant ? | OK | Population strictement alignée sur l'Aperçu. | — | — | Aucune | — |
| Évolution › Moments charnières | Vue d'ensemble en un coup d'œil ? | OK | Filtrage par score déjà en place (lecture niveau 1). | — | — | Aucune | — |
| Évolution › Courbe de tension | Amélioration/dégradation générale ? | À POLIR | Rendu SVG propre. | Aucun seuil de valeur analytique — s'affiche même sur historique plat à 2 points (cas Bella). | Non | Ajouter un seuil de richesse avant affichage complet. | P1-C |
| Évolution › Chronique complète | Détail PV par PV ? | OK | Niveau 2 déjà séparé du niveau 1. | Chevauchement partiel avec Synthèse › Histoire récente (côté Synthèse à corriger, pas ici). | — | Aucune | — |
| Lignes de vie | Trajectoire détaillée d'un sujet, avec outillage ? | OK | Fonctions propres (fusion, regroupement, suggestions IA) non redondantes en usage. | Structure de grille commune avec PV (chevauchement visuel, pas fonctionnel). | Partiel | Aucune fusion ; clarifier le sous-titre si confusion terrain confirmée. | P3 |
| PV (lecture documentaire) | Que disent les PV sources ? | OK | États d'activité documentaires simples, distincts des visites terrain. | Grille visuellement proche de Lignes de vie, risque de confusion « laquelle consulter ». | Oui, structure partagée | Renvoi croisé si confusion terrain confirmée. | P3 |
| Dépendances (onglet global) | Quels sujets dépendent d'autres ? | EXISTE MAIS MASQUÉ | Masquage assumé (corpus quasi nul), deep-link `?view=deps` fonctionnel non-discoverable. | Le composant lit `subject_thread_links` (legacy cooccurrence), pas `canonical_subject_links` (preuve obligatoire, dormant). | — | **HARD STOP : ne pas réactiver.** | — |
| Dépendances (fiche sujet) | Liens confirmés/suggérés de ce sujet ? | EXISTE MAIS MASQUÉ (partiel) | `RelationsSection` sur la fiche sujet reste active, non masquée, permet confirmer/rejeter. | Même écart de vérité (legacy vs moteur dormant). | Oui — canal légitime actuel | **HARD STOP : ne pas toucher.** Documenter que c'est le canal actuel. | — |

### B.3 Fiche sujet canonique

| Écran | Question utilisateur | État actuel | Ce qui fonctionne | Défaut réel | Existe déjà ailleurs ? | Modification recommandée | Priorité |
|---|---|---|---|---|---|---|---|
| Fiche sujet | « Ouvert » = problème ou pratique récurrente (P1.9) ? | MANQUANT | Moteur tri-state honnête (`open/resolved/unknown`), jamais de fabrication d'état. | Aucune dimension « récurrence normale » dans le modèle — un sujet routine s'affiche identique à un sujet bloqué. | Partiel, cadrage inverse (`insights.recurring` = signal négatif) | Auditer les données AVANT tout wording ; pas de nouvelle colonne sans cadrage produit. | P1-A |
| Fiche sujet (desktop) | Même grammaire pour tout sujet (P1.10) ? | OK | Séquence fixe en dur, quel que soit `kind`/`primaryFamily`. | — | — | Conserver telle quelle. | — |
| Fiche sujet (desktop vs mobile) | Même histoire sur les deux plateformes ? | PARTIEL / DOUBLON | Même read-model (`getCanonicalSubjectLife`), mêmes faits. | Mobile ajoute `ActorIdentityBlock` absent du desktop ; labels (`STATUS_LABELS` etc.) dupliqués mot pour mot dans les 2 fichiers, aucune source commune. | — | Extraire les constantes de libellé dans un module partagé ; trancher `ActorIdentityBlock` cross-plateforme (choix produit). | P2 |
| Fiche sujet — occurrences/fil métier | Non-mention = disparition (P1.14) ? | OK | Gaps modélisés explicitement (`isGap:true`), dérivation d'état ignore les `unknown`, jamais de recul d'état ; UI l'affiche en toutes lettres. | — | — | Aucune. | — (déjà livré) |
| Fiche sujet — Relations | Ce qui bloque, visible même vide ? | PROBLÈME DE DONNÉES, PAS D'UI | `RelationsSection` toujours rendue, dégrade proprement. | Incohérence mineure : `WhyThisSubjectSection` masquée silencieusement à 0 lien, `RelationsSection` affiche un placeholder pour la même absence — deux traitements différents. | — | Cosmétique seulement, le vrai verrou = peuplement des données (hors périmètre). | P2 |

### B.4 Mémoire + Actions + Réserves

| Écran | Question utilisateur | État actuel | Ce qui fonctionne | Défaut réel | Existe déjà ailleurs ? | Modification recommandée | Priorité |
|---|---|---|---|---|---|---|---|
| Mémoire desktop › Connaissances validées | Lecture progressive possible ? | MANQUANT | Groupement par catégorie déjà en place. | Rendu intégral sans dépliage — cas PETRO 13+ items en un bloc. | Oui — pattern dépliage déjà livré côté mobile (`MemoryReviewPanel`) | Porter le pattern mobile vers `MemoireConfirmer.tsx`. | P1-C |
| Actions/Réserves › « À confirmer » | Même type d'arbitrage pour toutes les propositions ? | MANQUANT | Badge de famille + score de pertinence déjà affichés. | Aucun sous-type d'arbitrage (nouvelle action/regroupement/priorité/geste) — CTA identique pour tout. | Non | Ajouter un champ de type d'arbitrage. | P1-C |
| Actions — chaîne VISITE→ACTION→PREUVE | Origine/état/preuve distincts ? | OK | Origine par FK réelles, distinction preuve `current`/`previous`. | Aucun texte ne distingue « clôture actée » de « résultat obtenu ». | — | Texte explicite si un cas terrain le justifie. | P3 |
| Actions — cas « cadenas » (P1.23) | Doublon ou 2 objets liés au même sujet ? | EXISTE MAIS MASQUÉ | Lien « Voir l'historique du sujet » correct quand projeté. | Le pont de promotion ne réplique pas systématiquement `canonical_subject_id` (`50c306b1` = `BRIDGE_AVAILABLE_NOT_PROJECTED`, `PHASE-A-AUDIT.md`) → asymétrie entre cartes sœurs. | Documenté, non vérifié en base live | Projeter systématiquement `canonical_subject_id` à la promotion. | P1-C |
| Extraction historique — sur-segmentation (P1.25) | Synthèse ≠ nouvelle action ? | MANQUANT | Règle de consolidation déjà en place pour `knowledge_fact`. | Règle jamais étendue à la famille `action`. | Non | Étendre la règle ou dédoublonner à la restitution. | P1-D |
| Onglet « Travail » | Toujours présent ? | Dette code | `SITE_TABS` ne référence plus `travail`. | `TravailView`/`WorkWorkspace.tsx` restent dans le dépôt, inatteignables — code mort. | — | Supprimer le code mort. | P3 |
| Actions mobile — badge « en retard » | Même sémantique partout ? | **BUG (régression P0.5)** | Desktop utilise le prédicat canonique `classifyActionUrgency`/`isActionOverdue`. | 2 écrans mobiles comparent `due_date < today` naïvement, ignorant `due_date_status` — une échéance IA non confirmée s'affiche en rouge comme confirmée. | Oui, prédicat déjà utilisé desktop | Brancher le mobile sur le prédicat canonique. | **P1-A (urgent)** |
| Réserves desktop | Statut/preuve/lien sujet ? | PARTIEL | Statut + preuve photo avant/après bien affichés. | `canonical_subject_id` existe en base (mig 347) mais jamais surfacé ; fiche lit encore l'ancien `subject_id`/`subjects` legacy. | Existe en base, masqué en UI | Afficher et migrer vers le lien canonique. | P2 |
| Réserves mobile | Idem ? | MANQUANT | Statut/label/localisation/date affichés. | Aucune preuve photo, aucun lien fiche, aucun geste « Lever ». | Oui, desktop porte l'interaction | Aligner a minima en lecture. | P2 |
| Réserve ↔ Action | Le lien croisé est-il visible dans les 2 sens ? | DOUBLON (lien à sens unique) | Réserve→Action affiché dans la fiche réserve. | Action→Réserve absent (`reserve_id` non sélectionné dans `readSiteActionSummaries`). | Le sens inverse existe | Sélectionner `reserve_id`, badge « Réserve liée » sur la carte action. | P2 |
| Réserves — bug bloquant | Puis-je lever une réserve / ajouter une action / lier un document ? | **BUG (P0, hors HARD STOP)** | — | `reserveOnSite()` interroge la table inexistante `site_reserves` (pluriel) au lieu de `site_reserve` (singulier, mig 110) → les 3 gestes échouent systématiquement avec « Réserve introuvable » depuis le commit `3def2052` (22/07/2026). | — | Corriger le nom de table — **signalement urgent, impact fonctionnel direct, à traiter indépendamment de P1.** | **P0** |

### B.5 Planning (gap) + Chronologie

| Écran | Question utilisateur | État actuel | Ce qui fonctionne | Défaut réel | Existe déjà ailleurs ? | Modification recommandée | Priorité |
|---|---|---|---|---|---|---|---|
| Planning ↔ Chronologie (échéances) | Même liste des deux côtés ? | OK | Même read-model `listSiteDeadlines`, même filtre. | — | — | Aucune | — |
| `listSiteDeadlines` | Import historique jamais présenté comme engagement actif ? | OK | Filtre `OPERATIONAL_DEADLINE_SOURCE_FILTER` confirmé. | — | — | Aucune | — |
| Planning — liens Vue d'ensemble → sous-onglets | Cohérents ? | OK | Génération/lecture des query params alignées bout en bout. | — | — | Aucune | — |
| Aperçu › « Prochaine étape » | Le CTA ouvre-t-il le Planning du chantier ? | À POLIR | — | Route vers `/semaine` (agenda global multi-chantiers), jamais vers `?tab=planning` (Travaux/Échéances V1-D livré le 2026-08-30). Deux « planning » sans lien croisé. | Oui, `?tab=planning` fonctionne | Faire pointer vers le Planning du chantier quand pertinent. | P2 |
| Planning › Travaux (`site_planning_items`) | Visible ailleurs qu'en Planning ? | EXISTE MAIS MASQUÉ (volontaire) | Séparation documentée : « 3 lectures distinctes du temps, jamais fusionnées ». | Aucun signal (icône/compteur) dans Chronologie/Suivi quand des jalons documentaires existent. | Non | Signal minimal envisageable sans dupliquer le rendu. | P3 |
| Suivi › PV, cas type PETRO (visites, 0 PV) | L'état vide explique-t-il les visites ailleurs ? | À POLIR / PARTIEL | Un texte d'orientation existe déjà au-dessus du tableau. | Il est neutralisé par le message générique de `ActivityMapView` juste en dessous, qui ne mentionne pas les visites — correspond exactement à P1.21. | Oui, Lignes de vie | Remplacer le message générique par un état dédié avec lien réel. | P1-A |
| Fiche sujet — LMCA vs dernière observation (P1.19) | Distinction lisible ? | OK | Labels explicites + microcopy dédiée (commit `d1d26df1`, 2026-08-30), répliqué mobile. | — | — | Aucune. | — (déjà livré) |
| Chronologie/Évolution/`/chronicle` | Combien de surfaces « ce qui s'est passé » ? | DOUBLON | Chronologie et Évolution ont un contrat clair, non redondant. | `/sites/[id]/chronicle` (« Journal du chantier ») est une 3ᵉ surface proche de Chronologie, non intégrée au nav unifié, accessible seulement par URL directe — code mort en pratique depuis le lot Nav du 29/08. | — | **Décision produit à valider** : supprimer ou réintégrer consciemment. | P2 |
| Chronologie, cas PETRO | État vide trompeur ? | OK | `hasEvents` inclut les visites — pas d'état vide générique trompeur. | — | — | Aucune. | — |

### B.6 Visites + Préparer + Après-visite

| Écran | Question utilisateur | État actuel | Ce qui fonctionne | Défaut réel | Existe déjà ailleurs ? | Modification recommandée | Priorité |
|---|---|---|---|---|---|---|---|
| Visite détail desktop | Visite en cours ? | **BUG (régression P0.5)** | Gate `isImport` utilisé partout ailleurs sur la page. | `visites/[visitId]/page.tsx:366` : `{!visit.ended_at && <span>visite en cours</span>}` non gardé par `isImport` — un PV importé sans `ended_at` (cas Bella) affiche « visite en cours ». | Le gate existe déjà dans le même fichier | Ajouter `!isImport &&`. | **P1-A (urgent)** |
| Recap mobile — reprise de visite | Puis-je reprendre cette visite ? | **BUG fonctionnel (régression P0.5)** | Gate `isImportedVisit` utilisé ailleurs sur la même page. | `recap/page.tsx:233` : bouton « Reprendre » non gardé → `reopenVisit()` n'a aucun filtre `origin` → un PV importé peut être basculé en collecte terrain live via « Ouvrir sur mobile » (lien inconditionnel côté desktop). | Le gate existe déjà dans le même fichier | Ajouter le garde + garde défensif dans `reopenVisit()`. | **P1-A (urgent, fonctionnel pas seulement cosmétique)** |
| Liste Visites desktop/mobile | Comptage correct ? | OK | Filtre `TERRAIN_ORIGINS` confirmé sur les deux read-models. | Code mort inoffensif (`ORIGIN_LABEL['import']`, badge « En cours » jamais atteints). | — | Aucune (cosmétique interne). | — |
| Frise chantier | Pas de doublon import/visite ? | OK | Skip explicite des imports dans la frise. | Constante `VISIT_TYPE_LABEL` avec entrée `import` déclarée mais jamais lue (code mort). | — | Retirer ou documenter. | P3 |
| Préparer ma visite | Que vérifier avant d'y aller ? | PARTIEL | Moteur P1-A figé bien branché sur le Copilote (5 tiers). | Une 2ᵉ liste statique indépendante (« Priorités proposées »/« Sujets à garder en tête », pré-P1-A) coexiste sur le même écran, hiérarchisation potentiellement différente. | Le moteur P1-A est le seul utilisé côté Copilote | Clarifier avec Vincent : fusion, remplacement, ou coexistence assumée (passif vs conversationnel). | P1-B |
| Préparer ma visite — non-mention (P1.14) | Disparition ou dernier état prouvé ? | OK | Absence de changement formulée explicitement comme information, jamais comme résolution. | Aucun contre-exemple trouvé. | — | Aucune modification de moteur nécessaire. | — |
| Documents › filtre PV | Où voir les PV historiques ? | À POLIR | Filtre lexical fonctionnel. | Aucun état vide dédié quand le filtre PV matche 0 — retombe sur message générique, n'explique jamais la distinction import/visite. | Le texte explicatif existe ailleurs (visite détail, patrimoine) | Message dédié + lien vers Évolution/Lignes de vie. | P1-A |
| Patrimoine mobile — compteur PV | Ce chantier a-t-il des PV ? | EXISTE MAIS MASQUÉ | Compteur correct quand `importedDocs>0`. | Masquage silencieux quand 0 — aucune explication (cas PETRO). | — | Ligne explicite plutôt que masquage silencieux. | P1-A |
| Après-visite — ledger par visite | Qu'a retenu MemorIA de cette visite ? | OK | Surface dédiée, actif/archivé séparés. | — | — | Aucune. | — |
| Après-visite — file d'arbitrage transversale | Qu'est-ce qui reste à confirmer, tout le chantier ? | OK | Population agrégée bien distincte du ledger par-visite. | — | — | Aucune. | — |

### B.7 Mobile (transversal)

| Écran | Question utilisateur | État actuel | Ce qui fonctionne | Défaut réel | Existe déjà ailleurs ? | Modification recommandée | Priorité |
|---|---|---|---|---|---|---|---|
| Navigation N1 mobile | Où est l'équivalent de « Suivi » ? | PARTIEL | Sujets/Frise/fiche sujet couvrent une partie des fonctions de Suivi. | 13 onglets plats, aucun regroupement « Suivi », pas d'onglet PV/Évolution dédiés. | Oui, desktop | Consigner l'écart pour arbitrage (fusionner ou assumer). | P1-C |
| Intervenants mobile | Point d'entrée dédié ? | MANQUANT | Identité/rôle visibles une fois dans la fiche sujet acteur. | Aucun onglet N1 « Intervenants » mobile (existe desktop). | Oui, desktop | Clarifier si un point d'entrée dédié est nécessaire. | P1-C |
| Patrimoine › Sujets suivis | Typologisé (personne/organisation/sujet) ? | PARTIEL | Liste cliquable, données réelles. | Icône uniforme (`Brain`), aucune distinction de type. | Oui — `SujetsList.tsx` sait déjà typologiser | Réutiliser `getKindGroup()`/`durableKind`. | P1-C |
| Patrimoine › « Sujets qui reviennent » | Cohérent avec « Sujets suivis » ? | DOUBLON | Fréquence réelle calculée. | 2 listes « sujets » sur la même page, sources différentes (`subjects` legacy sans `kind` vs `canonical_subject`), aucun lien explicite entre elles. | Partiel | Clarifier laquelle fait foi avant P1. | P1-C |
| Fiche sujet acteur — actions terminées | Toutes visibles ? | BUG | 3 premières affichées. | Au-delà, texte statique non cliquable « +N autres ». | Oui — motif dépliable déjà livré (`MemoryReviewPanel`) | Appliquer le même motif. | P1-B |
| Fiche sujet opérationnel — relations | Toutes visibles ? | BUG | 4 premiers liens affichés, cliquables. | Au-delà, « +N autre(s) » statique non dépliable. | Oui, même motif | Dépliage sur place. | P1-B |
| Fiche sujet — libellés d'occurrence | Tous visibles ? | BUG (plus sévère) | 2 premiers `additionalLabels` affichés. | Au-delà, troncature **silencieuse** — aucun compteur, perte totale d'information. | Non | Au minimum un compteur, idéalement dépliable. | P1-B |
| Fiche sujet — grammaire opérationnel vs acteur | Cohérente ? | OK | Séquence attendue respectée pour les sujets opérationnels ; divergence acteur documentée en commentaire, assumée. | — | — | Aucune. | — |
| Actions/Réserves mobile — listes | Complètes ? | OK | Rendu sans troncature. | — | — | Aucune. | — |
| Point d'entrée IA — fiche chantier | Unique (« Demander à MemorIA ») ? | OK avec nuance | Bouton compact et secondaire, seul point sur la fiche chantier. | Un second point d'entrée vocal (« Parler à MemorIA ») existe dans le shell global (bottom-sheet ➕) — cohérent avec le Copilote mobile/Siri en conception, pas un vestige. | — | Clarifier le cadrage (fusion vs deux modes) dans le chantier Copilote mobile déjà en cours — ne pas coder ici. | Hors P1 formel |
| Fiche sujet — statut Ouvert récurrent | Cas Bella (huiles usagées) confirmé en données ? | NON VÉRIFIABLE (lecture code seule) | Label centralisé et cohérent. | Aucune distinction sémantique dans le code. | — | Nécessite requête DB, hors périmètre de cet audit. | P1-A |

---

## C. Fonctionnalités déjà construites mais masquées

1. **Dépendances / Relations** — écran global masqué (assumé), mais le canal légitime actuel est la section Relations de la fiche sujet (`RelationsSection`), non masquée, lisant `subject_thread_links` (legacy). Le moteur `canonical_subject_links` (preuve obligatoire) reste dormant, branché mais jamais activé. **Ne pas toucher (HARD STOP).**
2. **Dépliage progressif** (`MemoryReviewPanel`, « Voir N de plus »/« Réduire ») — livré côté mobile Patrimoine, jamais porté vers `MemoireConfirmer.tsx` desktop, ni vers 3 zones de la fiche sujet mobile qui tronquent encore silencieusement ou statiquement.
3. **Typologie `kind` des sujets** (`getKindGroup()`/`durableKind`) — existe et fonctionne dans `SujetsList.tsx` (mobile), mais Patrimoine (mobile) sélectionne les sujets sans jamais lire ce champ.
4. **`canonical_subject_id` sur les réserves** — colonne en base depuis la migration 347, jamais sélectionnée ni affichée en UI (desktop ou mobile).
5. **Pont de promotion proposition→action** — `canonical_subject_id` n'est pas systématiquement projeté sur l'action matérialisée (cas documenté `50c306b1`), créant une asymétrie entre cartes sœurs du même sujet.
6. **Lien Réserve→Action** — existe dans un sens (fiche réserve affiche l'action corrective) mais pas dans l'autre (`reserve_id` non sélectionné côté Actions).
7. **`ActorIdentityBlock`** — présent sur la fiche sujet mobile pour les sujets `kind='actor'`, absent du desktop (asymétrie non documentée comme un choix produit).
8. **Second mécanisme de fiche overlay** (routes interceptées `@fiche/(.)action|decision|intervenant`) — qualifié « prototype » dans son propre commentaire, mais utilisé par la quasi-totalité des liens réels de l'app, concurrent du mécanisme `PersistentFicheSheet` officiellement documenté comme solution.
9. **Routes/hubs legacy** (`documents`, `memoire`, `subjects` en top-level, `/chronicle` + `SiteDomainHub`) — encore présents et routables, sans header uniforme, apparemment supplantés mais jamais nettoyés.

---

## D. Vrais trous produit (après dédup)

Regroupés par nature, en excluant tout ce qui est déjà couvert en section C (masqué, pas manquant) ou en section E (bug de régression) :

- **Modèle de données incomplet** : aucune dimension « récurrence normale » sur le statut des sujets (P1.9) ; aucun type d'arbitrage sur les propositions (P1.18).
- **Restitution non typologisée** : listes de sujets/intervenants au même niveau visuel sans distinguer personne/organisation/sujet métier, à 2 endroits mobiles (Patrimoine « Sujets suivis », Patrimoine « Sujets qui reviennent ») (P1.8).
- **Redondances de restitution confirmées** (3, précises, distinctes de la doctrine générale P1.6) : Synthèse›Watchlist vs Attention (deux moteurs non prouvés convergents) ; Synthèse›Histoire récente vs Évolution›Chronique ; Synthèse›DeltaBloc vs période récente d'Évolution.
- **Seuils de pertinence manquants** : courbe de tension affichée même sur historique plat (P1.5) ; carte « Sujets importants » pleine taille même vide (P1.3).
- **États vides non pédagogiques** (P1.21, 3 surfaces distinctes) : onglet PV/filtre Documents, liste Visites, compteur Patrimoine mobile — aucun n'explique explicitement la distinction PV historique importé / visite terrain quand le compte est à 0.
- **Troncatures non dépliables résiduelles** (P1.2, hors Patrimoine mobile qui est déjà correct) : 3 zones de la fiche sujet mobile, dont une troncature silencieuse sans compteur (la plus sévère).
- **Doublons de CTA** sur l'Aperçu (P1.16) : « Préparer ma visite », « Planifier », « Créer une action » chacun en double.
- **Deux mécanismes de fiche overlay concurrents**, jamais tranchés.
- **Divergence de taxonomie N1 mobile/desktop**, jamais documentée comme un choix assumé.
- **Absence de point d'entrée Intervenants dédié sur mobile** (P1.15).
- **Liens croisés manquants** : Aperçu›Prochaine étape ne pointe jamais vers le Planning du chantier ; Action→Réserve absent en sens inverse.
- **`/chronicle` orphelin** : à trancher (supprimer ou réintégrer), pas un trou en soi mais un état intermédiaire non assumé.

---

## E. P0.5 résiduel (anomalies encore en prod)

**Deux régressions confirmées sur l'invariant central « import ≠ visite terrain » :**

1. **`visites/[visitId]/page.tsx:366`** (desktop) — badge « visite en cours » affiché sur un PV importé sans `ended_at` (le gate `isImport`, utilisé partout ailleurs dans le même fichier, a été oublié à cette ligne). Cas concret : Bella.
2. **`m/visite/[reportId]/recap/page.tsx:233`** (mobile) — bouton « Reprendre cette visite » affiché sur un PV importé (même oubli de gate). Conséquence **fonctionnelle, pas seulement cosmétique** : `reopenVisit()` (`lib/db/visits.ts:172-179`) n'a aucun filtre sur `origin` et peut faire basculer un enregistrement historique en session de collecte terrain live. Chemin d'accès confirmé : fiche visite desktop d'un import → lien inconditionnel « Ouvrir sur mobile » → recap mobile → bouton de reprise.

**Un bug distinct découvert hors doctrine visite/import, à traiter indépendamment (P0, hors HARD STOP de cet audit) :**

3. **Réserves cassées depuis le commit `3def2052` (22/07/2026)** — `reserveOnSite()` (`app/(dashboard)/sites/[id]/reserves/actions.ts:24-28`) interroge la table inexistante `site_reserves` (pluriel) au lieu de `site_reserve` (singulier, migration 110). Les 3 gestes (lever une réserve, ajouter une action corrective, lier un document) échouent systématiquement avec « Réserve introuvable ». **Impact fonctionnel direct, à corriger sans attendre la réouverture de P1.**

**Un écart de cohérence transversal** :

4. **Badge « en retard » mobile non aligné sur le prédicat canonique desktop** (`classifyActionUrgency`/`isActionOverdue`) — 2 écrans mobiles comparent naïvement `due_date < today`, affichant en rouge une échéance IA non confirmée comme si elle était confirmée.

**Tout le reste des critères de non-régression P0.5-Vérité tient**, vérifié directement dans le code actuel : filtrage `TERRAIN_ORIGINS` sur les listes Visites (desktop+mobile), comptage N visites/première/dernière, frise chantier sans doublon import/visite, exclusion `created_from='historical_import'` dans `listSiteDeadlines`, convergence des 18 read-models catégorie A recensés dans l'audit P0.5.

---

## F. Verdicts P1 (croisés contre `docs/architecture/P1-backlog-post-P0.5.md`)

| Item | Verdict | Note |
|---|---|---|
| P1.1 | DÉJÀ LIVRÉ | Rails N1 seulement — extension N2 jamais demandée par l'item original, nouvelle observation (voir B.1). |
| P1.2 | À REFORMULER | Résidu hors Patrimoine (déjà correct) : 3 zones de la fiche sujet mobile, une troncature silencieuse. |
| P1.3 | TOUJOURS VALIDE | État vide pleine carte confirmé. |
| P1.4 | DÉJÀ LIVRÉ | Lecture 2 niveaux déjà en place dans Évolution. |
| P1.5 | TOUJOURS VALIDE | Aucun seuil de richesse, confirmé par le code. |
| P1.6 | À REFORMULER | 3 doublons concrets identifiés, à cibler précisément plutôt qu'audit générique. |
| P1.7 | TOUJOURS VALIDE | Confirmé desktop (implicite via Patrimoine légacy) et mobile. |
| P1.8 | À REFORMULER | Typologie existe déjà à certains endroits (`SujetsList`), absente à d'autres (Patrimoine). |
| P1.9 | TOUJOURS VALIDE | Aucune dimension de récurrence dans le modèle ; cas Bella non vérifiable sans requête DB. |
| P1.10 | DÉJÀ LIVRÉ (desktop+mobile grammaire opérationnelle) / À REFORMULER (portée cross-plateforme acteur) | `ActorIdentityBlock` absent desktop — asymétrie à qualifier. |
| P1.11/P1.12 | LIVRÉ P0.5, **régression partielle constatée** | Voir section E, points 1-2 — critères de non-régression tenus PARTOUT sauf ces 2 lignes précises. |
| P1.13 | À REFORMULER | Hiérarchie Aperçu, ordre du DOM identifié précisément. |
| P1.14 | DÉJÀ LIVRÉ (au niveau moteur) | Aucun contre-exemple trouvé dans fiche sujet ni préparation de visite. |
| P1.15 | TOUJOURS VALIDE | Aucun point d'entrée Intervenants mobile dédié. |
| P1.16 | TOUJOURS VALIDE + À FUSIONNER | 3 doublons de CTA identifiés en plus du problème de densité. |
| P1.17 | TOUJOURS VALIDE | Pattern de dépliage existe (mobile) mais pas porté sur `MemoireConfirmer.tsx`. |
| P1.18 | TOUJOURS VALIDE | Aucun type d'arbitrage dans le modèle de proposition. |
| P1.19 | DÉJÀ LIVRÉ | Labels explicites + microcopy, commit `d1d26df1` du 2026-08-30. |
| P1.20 | À REFORMULER | Structurellement livré ; ne reste que la nuance texte « clôture ≠ résultat ». |
| P1.21 | TOUJOURS VALIDE / À REFORMULER | Début de correctif neutralisé par un message générique plus bas — 3 surfaces concernées. |
| P1.22 | TOUJOURS VALIDE | Aucun travail de typologie post-P0.5 trouvé. |
| P1.23 | TOUJOURS VALIDE | Confirmé par `PHASE-A-AUDIT.md`, non vérifié en base live. |
| P1.24 | **NON AUDITÉ dans ce lot** | Item d'extraction (prompt `historical-visit-extractor.ts`), pas un écran — hors périmètre des 7 groupes d'agents dispatchés ; à auditer séparément si Vincent le souhaite. |
| P1.25 | TOUJOURS VALIDE | Règle de consolidation scopée à `knowledge_fact`, jamais étendue à `action`. |

---

## G. Ordre recommandé (5 lots)

### Lot 0 — Correctifs bloquants, hors P1, avant toute réouverture
- Corriger le nom de table `site_reserves`→`site_reserve` (réserves cassées, P0).
- Ajouter le garde `!isImport` manquant sur « visite en cours » (desktop, `page.tsx:366`).
- Ajouter le garde `!isImportedVisit` manquant sur « Reprendre cette visite » (mobile, `recap/page.tsx:233`) + garde défensif dans `reopenVisit()`.
- Brancher le badge « en retard » mobile sur `classifyActionUrgency`/`isActionOverdue` (aligner sur desktop).

### Lot P1-A — Vérité / cohérence
P1.9 (sémantique Ouvert récurrent, audit données d'abord) · P1.14 (déjà livré au niveau moteur, à confirmer par recette) · P1.21 (état vide PV, 3 surfaces) · confirmation terrain que la régression P0.5 du Lot 0 est bien résolue.

### Lot P1-B — Navigation et accès à l'information
P1.2 résiduel (fiche sujet mobile, 3 zones) · doublons de CTA sur l'Aperçu (P1.16 partiel) · arbitrage du mécanisme de fiche overlay (2 implémentations concurrentes) · cohérence scroll/rail N2 Suivi vs Planning/Mémoire · clarification « Préparer ma visite » (liste statique vs moteur P1-A).

### Lot P1-C — Hiérarchie de lecture
P1.3, P1.5 (seuils de valeur analytique) · P1.6 (3 doublons concrets Synthèse/Évolution/Attention) · P1.7, P1.8 (typologie Patrimoine + fusion des 2 listes « sujets » mobiles) · P1.13 (ordre Aperçu) · P1.17 (dépliage `MemoireConfirmer`) · P1.18 (types d'arbitrage propositions) · taxonomie N1 mobile/desktop (arbitrage : documenter ou fusionner) · point d'entrée Intervenants mobile (P1.15).

### Lot P1-D — Stabilisation et cohérence transversale
P1.10 (portée cross-plateforme `ActorIdentityBlock`) · P1.20 (nuance texte clôture/résultat) · P1.22 · P1.23 (projection systématique `canonical_subject_id` au pont de promotion) · P1.25 (étendre dédup synthèse/parties à `action`) · décision sur `/chronicle` (supprimer ou réintégrer) · nettoyage code mort (`Travail`, hubs legacy) · recette croisée bureau+mobile sur Bella avant clôture.

*(P1.24, non audité ici, reste à traiter en dehors de cet ordre — item d'extraction, pas un écran.)*

---

## HARD STOP

Ce document est un diagnostic. **Aucune ligne de code n'a été modifiée.** Avant tout passage en code :
- Le Lot 0 (bugs) peut être corrigé dès validation par Vincent — ce sont des corrections de régression ponctuelles, pas une réouverture de P1.
- Les lots P1-A à P1-D nécessitent un arbitrage explicite de Vincent sur l'ordre et le périmètre exact de chaque item avant tout code.
- Aucune activation de Dépendances, aucun contact avec le moteur de relations/`canonical_subject`, aucune migration de données proposée dans ce document ne doit être exécutée sans validation séparée.
