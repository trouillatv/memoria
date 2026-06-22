# Recette intégrale — changements des 6 derniers jours (2026-06-17 → 06-23)

> 227 commits · migrations **114 → 157** (44). Ce document : (1) ce qui a changé par
> thème, (2) un parcours de test de bout en bout qui exerce TOUT, (3) les régressions
> à vérifier en priorité (les gros fixes). Prérequis : `npm run db:push` à jour
> (prod = déjà appliqué sur `memorianc.vercel.app`).

---

## 1. Ce qui a changé, par thème

### A. Compte-rendu de chantier (PV) — le plus gros chantier
- Génération **PV/CR depuis une réunion** (transcript → décisions *proposées*, actions
  + échéances qualifiées, participants, risques). Garde-fou anti-invention.
- **Écran de validation = hub** (`/meetings/[id]/pv/validation`) : parcours numéroté
  ①→⑥, gate de sévérité, points à confirmer classés (🔴/🟠/🟢), blocs éditables
  (participants + statut présence I/P/AE/AN/D, actions, décisions, remarques, **photos** :
  couverture/ordre/légendes/exclusion), **aperçu PDF vivant**.
- **Template Word BECIB** = source de vérité (docxtemplater) + export **.docx éditable** ;
  PDF haute fidélité (logo client variable) ; **version finale diffusée** (preuve, jamais
  écrasée) vs **référence générée** ; historique documentaire.

### B. Sujets — l'unité de mémoire centrale (mig 124, 143-145)
- **Vue Sujet** + historique chronologique daté ; **sujet vivant** (état / cause+confiance
  / énergie / dernière évolution / prochaine étape) ; promesses ≠ échéances ; récurrence ;
  **dépendances** « A bloque B » ; anomalies/points au fil ; décisions reliées.
- **Recherche par sujet** + santé de rattachement (KPI interne).
- **Vue Sujet enrichie** (« 5 secondes » : état/depuis/cause/dernière trace/sources/à faire),
  **bloc Vigilance**, **« À l'échelle de l'organisation »** (causes / facteurs de réussite / impact).

### C. Obligations chantier — objet prescriptif (mig 146-147, 151)
- Objet **Obligation** V1, criticité/responsable/cause, santé **« négligée »**, détecteur
  briefing, lien obligation↔document + référence libre.
- **Pont engagement → obligation** avec **provenance** (mig 154-156).

### D. Dossiers de démarrage / AO — fiabilisation + engagements + provenance
- **Analyse AO fiabilisée** : sortie de `after()` → requête HTTP (`maxDuration=300`),
  **unpdf** (au lieu de pdf-parse), Zod tolérant, imports dynamiques, timeouts, barre de
  progression, libellés génériques, scope orgId, diagnostic d'échec visible.
- **Engagements** : extraction (budget 8000, sanitize, anti-throw), **typage** (objectif/
  obligation/livrable/contrôle/pénalité, mig 153), **regroupement** nature/thème, curation,
  compteur sidebar, **promotion Atelier → engagement**.
- **Confrontation expérience (A3)** : sujet canonique via glossaire, **causes récurrentes**,
  **facteurs de réussite observés**, **impact** (jours de retard).
- **Provenance navigable** : 3 niveaux de confiance (exact/section/approximate), **jamais
  de fausse page** (marqueurs `[[page N]]`), **paragraphe complet**, **occurrences**,
  **audit documentaire**, conversion AO→contrat. Upload encadré, glissière, tooltips élargis.

### E. QR entreprises / preuve (mig 148, 157)
- **Carnet d'actions QR** (`/a/[token]`), statut du lot **Envoyé→Lu→Rempli**, **dossier de
  preuve** consolidé, **export ZIP** « propriété des données ».
- **Inbox « Nouveau depuis hier »** (déclarations QR fraîches) sur le dashboard.

### F. Mémoire de réunion / audio / briefing (mig 139-142)
- **Audio de secours multi-sources** + **santé de la mémoire** ; ré-analyse non destructive ;
  corpus pondéré par durée. **Réécouter / relancer / supprimer** une source audio.
- **« Préparer la réunion »** : bibliothèque de détecteurs déterministes (retards, décisions
  non appliquées, acteur absent, réserves, **obligations négligées**, **actions récurrentes
  à reprendre**) + questions à poser. **Capture passive** des corrections (instrumentation).

### G. Casting du chantier (mig 137-138)
- `companies` / `company_contacts` / `site_intervenants` : **rôle → entreprise → contact**,
  historique intervenants.

### H. Terrain / mobile (`/m`)
- Bouton **note/photo** sur la page chantier ; **déclaration de livraison/évacuation** en
  mobile (+ photo) ; **prendre en charge une intervention non affectée** pour la démarrer.

### I. Glossaire métier (mig 150, 152)
- Terme / définition / **alias** / catégorie ; **correction de transcription** (alias→terme) ;
  **sujet canonique** ; glossaires de démarrage **seedés** (BECIB VRD, AGP propreté).

### J. Sous-périmètres / scopes (mig 117-119)
- `memory_scopes` (bâtiment/zone) ; actions/anomalies/photos **scopables** ; KPI « % rattaché ».

### K. Planning / actions / continuité (mig 121, 145)
- Actions : **type** (ponctuelle/échéance/récurrente), **narration de durée**, planifier
  avec équipe, badges. Briefing repliable par site. Semaine groupée par site. **Passation
  enrichie** (réserves/actions/décisions). **Réserve = mini-dossier** + PDF.

### L. Recherche / documents (mig 120, 122-123)
- Corpus de recherche **étendu** (actions, décisions, réserves, PV, documents/CCTP).

### M. Infra / sécurité / admin (mig 114-116)
- **RLS org-scope**, org catalog, **monitoring AO**, **cron sweep** AO coincés, cron backup,
  **mode rôle simplifié**, onboarding chantier-centric, comptes pilote BECIB.

---

## 2. Parcours de test intégral (de bout en bout)

> À dérouler sur un compte manager/admin (desktop) + un accès terrain (mobile). Suivre
> la colonne vertébrale : **AO → engagement → obligation → sujet → réunion → QR → preuve**.

### Pré-requis
- [ ] Connexion ; au 1er login, **changement du mot de passe** provisoire.
- [ ] **Glossaire** (`/glossaire`) : les termes de démarrage sont là (DOE, PAQ…) ; ajouter/éditer un alias.
- [ ] **Mode simplifié** (barre latérale) : bascule, puis « Tout afficher ».

### Bloc 1 — Dossier de démarrage (AO)
- [ ] `/tenders/new` : **zone d'upload encadrée** (glisser-déposer), déposer un **PDF** → **barre de progression**.
- [ ] L'**analyse aboutit** (pas de hang, pas d'échec) → Synthèse (score, risques, contraintes, sources `[doc:id]`), Analyse détaillée, Mémoire technique.
- [ ] `/tenders/[id]/engagements` : engagements **typés** + **regroupés** (bascule Nature/Thème) ; **compteur** dans la sidebar.
- [ ] Encart **« Ce que dit votre expérience »** (vide si pas d'historique — normal).
- [ ] **Provenance** : sur un engagement → « ↳ origine » → page source : **extrait d'abord**, paragraphe complet, occurrences ; niveau de confiance correct (**jamais de fausse page**).
- [ ] **Audit documentaire** (`/tenders/[id]/audit`) : PDF + liste navigable, glissière, **« Retour au dossier »** fonctionne.
- [ ] **Atelier IA** : sous une réponse d'agent, **« Transformer en engagement »**.
- [ ] **Conversion** (`/tenders/[id]/convert`) : créer le contrat.

### Bloc 2 — Chantier & obligations
- [ ] Créer un **site** sous le contrat ; sur `/sites/[id]/obligations` : **« Transformer en obligations »** (depuis les engagements) → obligations avec **« ↳ origine : CCTP p.X »** cliquable.
- [ ] Proposer la **bibliothèque d'obligations** standard ; vérifier statut/criticité/santé « négligée ».
- [ ] Créer des **sous-périmètres** (Bâtiment A/B…) et y rattacher des actions/photos.

### Bloc 3 — Terrain (mobile `/m`)
- [ ] `/m/site/[siteId]` : **Prendre une note / photo** ; **Déclarer une livraison/évacuation** (+ photo) → vérifier la remontée sur `/sites/[id]/livraisons`.
- [ ] Une **intervention non affectée** : « **Prendre en charge** » (chef → son équipe) ou « Affecter une équipe » (gérant) → **Démarrer** débloqué.

### Bloc 4 — Réunion & PV
- [ ] `/meetings` → nouvelle réunion ; ajouter un **audio** → **Santé de la mémoire** : **Réécouter**, **Relancer la transcription**, **Supprimer** une source ratée.
- [ ] **Curation** « Qui fait quoi » : accepter/modifier/ignorer des actions (type, échéance, durée).
- [ ] `/meetings/[id]/pv/validation` : parcours ①→⑥, points à confirmer, **photos** (couverture/ordre/légendes), participants (présence), **Générer** (PDF + **Word**), **téléverser la version finale**.

### Bloc 5 — QR entreprise & preuve
- [ ] Depuis la réunion, **confier des actions à une entreprise** (photo requise) → **QR/lien**.
- [ ] Ouvrir `/a/[token]` (sans login) : déclarer **Fait/Bloqué** + commentaire + **photo** + **signature**.
- [ ] Côté MOE : **statut du lot** (Envoyé→Lu→Rempli) ; **dashboard → « Nouveau depuis hier »** affiche la déclaration ; **Tout marquer comme vu**.
- [ ] `/sites/[id]/preuves` : la chaîne demande→déclaration→photo→**validation MOE**.

### Bloc 6 — Sujet & mémoire
- [ ] `/sites/[id]/subjects` : **digest « À surveiller en priorité »** ; ouvrir un sujet (ex. DOE) → **bloc Vigilance**, résumé 5 s, **historique** (avec l'origine en 1er événement), **« À l'échelle de l'organisation »** (si plusieurs chantiers).
- [ ] `/recherche` : taper « DOE » → résultats avec sources.

### Bloc 7 — Briefing & continuité
- [ ] `/meetings/[id]/briefing` (ou `/briefing`) : détecteurs (retards, obligations négligées, actions récurrentes) + questions à poser ; **envois WhatsApp** par chef.
- [ ] `/handovers` : générer un **passage de témoin** → `/h/[token]` (mobile, « C'est lu », PDF).

### Bloc 8 — Exports & admin
- [ ] **Export ZIP** d'un chantier ; **PDF** dossier de preuve / litige.
- [ ] `/admin/monitoring` (AO) ; `/admin/usage` (coûts IA + rangement scopes).

---

## 3. Régressions à vérifier en priorité (les gros fixes)

- [ ] **Analyse AO** : ne reste plus « en cours » indéfiniment ; aboutit ou échoue avec message clair (fix `after()`→HTTP, unpdf, timeouts).
- [ ] **Pages PDF jamais inventées** : un engagement sans page fiable affiche « référence approximative » (pas de bouton page), pas un faux « p.5 ».
- [ ] **Transcription** : un audio raté est **rattrapable** (relancer) ou **supprimable**, l'audio n'est jamais perdu.
- [ ] **Frontière client/serveur** : aucune page ne casse au build (cf. glossaire). `npm run build` vert.
- [ ] **Multi-org** : tout est scopé `organization_id` (RLS mig 114) — un compte ne voit que son org.

---

*Astuce : pour faire « parler » l'expérience (causes / facteurs / impact), il faut de la
matière réelle (plusieurs chantiers, réserves, réunions, sujets nommés via le glossaire).
Sur un compte neuf, ces écrans sont silencieux — c'est le comportement attendu.*
