# Manuel Technique — Architecture IA de MemorIA

*Comment fonctionne réellement MemorIA, de la donnée brute jusqu'à la décision opérationnelle.*

> Ce document représente la **vérité technique** de MemorIA. Objectif : permettre à un
> nouveau développeur (ou aux créateurs eux-mêmes dans deux ans) de comprendre comment
> tout s'articule, **même si personne n'est là pour l'expliquer**.

---

## ⚙️ MAINTENANCE DU MANUEL ARCHITECTURE IA

Ce document est une **base de connaissances vivante**. Il ne se réécrit pas : il se
**rafraîchit**. À chaque évolution importante :

**1. Scanner**
- schéma base de données (`supabase/migrations/`), agents IA (`services/ai/agents/`),
  prompts (`services/ai/prompts/`), pipelines (`lib/tenders/`, `services/pdf/`),
  services IA (`services/ai/`), moteurs de recherche, moteur Sujet (`lib/db/subjects.ts`),
  moteur Engagement/Obligation (`lib/db/engagements.ts`, `lib/db/obligations.ts`),
  moteur d'expérience (`lib/db/ao-experience.ts`), preuve/provenance.

**2. Répondre d'abord (rapport d'écarts, AVANT toute modification)**
- *Architecture* : quels nouveaux objets / disparus / relations changées ?
- *IA* : quels agents ajoutés ? quels prompts modifiés (versions) ? quels flux changés ?
- *Données* : quelles tables/migrations ont modifié le modèle ?
- *Mémoire* : le rôle du Sujet, le moteur d'expérience, le glossaire ont-ils changé ?
- *Utilisateur* : quels nouveaux parcours existent ?

**3. Mettre à jour UNIQUEMENT les sections concernées.** Conserver structure et
numérotation. Marquer l'obsolète `[OBSOLÈTE DEPUIS …]`. Ne jamais réécrire en entier.

> Commande type : *« Rafraîchis le Manuel Architecture IA. Analyse migrations, base,
> agents IA, routes et services. Détecte les évolutions depuis la dernière version.
> Produis d'abord un rapport d'écarts. Puis mets à jour uniquement les chapitres impactés. »*

**Dernière synchronisation : 2026-06-22** (migrations jusqu'à 157).

---

## PARTIE I — Vision d'ensemble

### 1. Pourquoi l'IA existe dans MemorIA
L'IA ne fait pas tourner MemorIA — elle l'**accélère** à deux endroits : lire vite de la
matière brute (un CCTP de 30 pages) et retrouver des liens. Tout le reste (suivi, mémoire,
statistiques) est **déterministe**. L'IA est un assistant de lecture et de suggestion,
jamais un décideur.

### 2. Ce que MemorIA n'est pas
Pas un ERP, pas un drive, pas un gestionnaire de tâches, pas un RAG généraliste. C'est une
**mémoire opérationnelle** : elle transforme texte et terrain en obligations suivies et
prouvables.

### 3. Les principes fondateurs (gravés dans l'architecture)
1. **L'IA propose, l'humain valide.** Aucune écriture autonome ne fait foi.
2. **Déterministe d'abord, LLM ensuite.** Tout ce qui peut être calculé l'est.
3. **L'artefact terrain n'est jamais supprimé** (réversible, jamais effacé).
4. **Jamais inventer.** Pas de citation ni de page fabriquée ; on déclare la confiance.
5. **Le Sujet est l'objet central** ; tout y converge.
6. **Discipline de coût IA** : pré-calcul/async + retrieval borné, jamais « LLM live partout ».

### 4. Architecture globale
```
Documents → Extraction → Structuration → Mémoire → Sujets → Analyse → Actions → Preuves → Décisions
```
Chaque flèche est documentée en Partie IV.

---

## PARTIE II — Architecture des données

### 1. Les grandes entités (tables principales)
| Entité | Table | Rôle |
|---|---|---|
| Site / chantier | `sites` | l'unité de mémoire d'un lieu (rattaché à `contracts`) |
| Réunion / CR | `site_reports` | capture de ce qui se dit ; PV |
| **Sujet** | `subjects` | **l'histoire d'un problème dans le temps** (site-scopé) |
| Action | `site_actions` | événement à faire (`subject_id`, `ext_*` pour le QR) |
| Obligation | `site_obligation` | ce qui est dû (mig 146) ; `subject_id`, `origin_*` (provenance AO) |
| Réserve | `site_reserve` | défaut à lever |
| Décision | `site_decisions` | ce qui est tranché (mig 136) ; `subject_id` |
| Anomalie | `intervention_anomalies`, `report_added_points` | ce qui cloche |
| Document | `documents`, `tender_documents` | sources ; texte extrait |
| Engagement | `engagements` | promesse extraite d'un AO (mig 017) ; `kind`, `source_ref`, provenance |
| Dossier AO | `tenders`, `tender_analyses` | appel d'offres + résultat d'analyse |
| Distribution QR | `action_distributions`, `action_distribution_items` | carnet d'actions partagé (mig 148) |
| Glossaire | `glossary_terms` | terme + alias → sujet canonique (mig 150) |
| Fil « vu » | `user_feed_state` | last_seen_at par user (mig 157) |

### 2. Pourquoi le Sujet est l'objet central
Toutes les autres entités portent (ou peuvent porter) un `subject_id`. Le Sujet est le
**point de convergence** : actions, réserves, décisions, anomalies, obligations,
documents s'y rattachent. C'est ce qui permet `getSubjectTimeline()` (l'histoire complète)
et l'agrégation d'expérience cross-chantiers. Voir Partie V.

### 3. Relations entre objets
```
contracts ──< sites ──< site_reports (réunions)
                 │
                 ├──< subjects ◄── (subject_id) ─┬─ site_actions
                 │                                ├─ site_reserve
                 │                                ├─ site_decisions
                 │                                ├─ intervention_anomalies / report_added_points
                 │                                ├─ site_obligation ──(origin_*)──► tenders/engagements
                 │                                └─ documents (document_links target='subject')
tenders ──< tender_documents
        ──< tender_analyses
        ──< engagements ──(à la conversion)──► site_obligation
        ──< action_distributions ──< action_distribution_items ──► site_actions
```
*(Diagramme complet de la base : Annexe B.)*

---

## PARTIE III — Les agents IA

Localisation : `services/ai/agents/` (implémentations), `services/ai/prompts/` (prompts
versionnés), orchestration `services/ai/orchestrator.ts`. Provider via `services/ai/factory.ts`
(Gemini ; mode `mock` pour démo). Tracking coûts via `services/ai/tracking.ts`.

### Lecteur AO — `agents/lecteur-ao.ts` (prompt `lecteur-ao.v1.ts`, v4)
- **Entrée** : texte du CCTP (balisé `[[page N]]`).
- **Sortie** : `summary`, `constraints[]`, `risks[]`, `checklist[]`, chaque item avec
  `sources[]` (quote verbatim + page réelle).
- **Tier** : heavy. **maxOutputTokens** : 8000 (thinking désactivé sur sortie JSON).
- **Ne doit jamais** : inventer une clause ni une page. S'il n'est pas sûr de la page, il
  l'omet (cf. Partie IX, confiance).

### Extracteur d'engagements — `services/ai/engagement-extraction.ts` (prompt `engagement-extractor.v1.ts`)
- **Entrée** : texte AO + mémoire technique.
- **Sortie** : engagements `{ source_excerpt, source_ref(page/section), category, kind, … }`
  où **kind** ∈ objectif / obligation / livrable / controle / penalite.
- **maxOutputTokens** : 8000 (un CCTP dense produit 20-30 engagements → 2000 tronquait).
- **Filets** : tolérance Zod (`.catch`), salvage JSON tronqué, sanitisation des contraintes
  DB (short_label 3-100, source_excerpt 5-2000) avant insertion.
- **Ne doit jamais** : inventer une page (omettre si incertain) ni recopier les marqueurs.

### Agent Mémoire technique — `agents/memoire-technique.ts`
- **Entrée** : output du Lecteur + bibliothèque (`buildLibraryContext`).
- **Sortie** : mémoire technique markdown *grounded* sur la bibliothèque. Tier heavy, 2000 tokens.

### Agent Scoreur d'opportunité — `agents/opportunity-scorer.ts`
- **Entrée** : analyse complète. **Sortie** : score 0-100 + justification. Tier light, 256 tokens.

### Atelier IA — `services/ai/chat.ts` + `app/(dashboard)/tenders/[id]/atelier-actions.ts`
- Chat multi-agent sur un dossier AO. Contexte injecté : bibliothèque + chantiers du
  client + recall documentaire borné. Conversations nommées, slash-commands. **Promotion**
  d'un message → engagement (`promoteMessageToEngagementAction`).

### Agents stubs (non branchés)
`terrain`, `conformite`, `contradicteur`, `financier` : déclarés, lèvent une erreur si
appelés. Réservés au futur (Partie X).

---

## PARTIE IV — Pipeline complet des données

```
PDF AO (upload, bucket tender-documents)
  ↓  actions.ts (stocke, statut 'extracting', redirige)
Extraction texte — services/pdf/extract.ts (unpdf, PAGE PAR PAGE + marqueurs [[page N]])
  ↓  (OCR de secours Gemini si scanné)
Route /api/tenders/[id]/analyze (POST, maxDuration 300, déclenchée par le loader client)
  ↓  lib/tenders/run-analysis.ts (timeouts ; persiste le texte)
Orchestrateur — services/ai/orchestrator.ts (3 agents séquentiels + buildLibraryContext)
  ↓  validation des sources (services/ai/source-validation.ts)
tender_analyses (summary, constraints, risks, checklist, technical_memo, score, sources)
  ↓  extraction d'engagements (à la demande) → engagements (typés)
Validation humaine (curation : valider/éditer/rejeter, nature, destination)
  ↓  conversion AO → contrat (createContractAction) → site créé manuellement
Matérialisation — materializeEngagementsAsObligations(siteId) → site_obligation (+ provenance origin_*)
  ↓  find-or-create subject par nom court
SUJET (subjects) ── getSubjectTimeline() agrège décisions/actions/réserves/anomalies/obligations/origine
  ↓
Réunions · QR entreprises (action_distributions) · Photos · Réserves
  ↓
Preuves (dossier de preuve) → Clôture
```
**Points critiques** : (a) l'analyse tourne **dans la requête HTTP** (pas `after()`, coupé
par Vercel) ; (b) `unpdf` (pas `pdf-parse`) pour le serverless ; (c) marqueurs de page →
citations fiables ; (d) la conversion **ne crée pas** de site (créé ensuite) → le pont
obligation se déclenche depuis le site.

---

## PARTIE V — Le moteur de mémoire (le Sujet)

Localisation : `lib/db/subjects.ts`, `lib/db/ao-experience.ts`.

- **Sujet canonique** : `glossary_terms` (terme + alias) regroupe les variantes
  (« DOE » = « Dossier des Ouvrages Exécutés » = « documents de recollement »). Match par
  **frontière de mot** (`\bDOE\b`) → pas de faux positif sur acronymes courts.
- **find-or-create** : `findOrCreateSubjectByName(siteId, name, userId)` (ILIKE, par site).
- **Timeline** : `getSubjectTimeline(subjectId)` fusionne 8 sources datées + l'événement
  `origin` (provenance AO) en tête.
- **Insights dérivés** : `getSubjectInsights` (état, cause, âge, blocages, récurrence,
  échéances repoussées) — **déterministe, zéro IA**.
- **Histoire org** : `getSubjectOrgHistory(orgId, name)` = le même sujet canonique sur
  tous les chantiers.

---

## PARTIE VI — Le moteur d'expérience (apprendre sans ML)

Localisation : `lib/db/ao-experience.ts`. **Aucun machine learning, aucun LLM** — du
comptage déterministe sur le vécu.

```
Sujet canonique
  ↓  loadCanonGroups (regroupe les sujets de l'org par terme canonique)
Occurrences (nb de chantiers)
  ↓  enrichGroups
Retards (actions échues) · Réserves · Clôtures
  ↓
Causes récurrentes (libellés réserves+anomalies comptés : « plans manquants (8) »)
  ↓
Facteurs de réussite OBSERVÉS (réussites vs ratés : « Obligation suivie 83% vs 40% »)
  ↓
Impact métier (jours cumulés de retard, réserves)
```
**Doctrine** : tout est **observé**, jamais **prescrit** (« voici ce qu'on observait sur
les réussites », jamais « fais ça »). Surfacé avec garde-fous (≥2 réussites ET ≥2 ratés).

---

## PARTIE VII — IA vs Déterministe (la frontière)

| Déterministe (calculé) | IA (proposé, à vérifier) |
|---|---|
| retards, % en retard, jours cumulés | résumés (Lecteur AO) |
| occurrences, causes, facteurs de réussite | extraction d'engagements |
| impact, historique, timeline | mémoire technique |
| santé d'obligation (négligée) | score d'opportunité |
| sujet canonique (glossaire) | réponses de l'Atelier |
| niveaux de confiance des citations | suggestions de la recherche |

**Pourquoi** : le déterministe est **explicable, gratuit, stable, vérifiable**. L'IA est
réservée à ce qui exige de la compréhension de langage. On ne paie pas un LLM pour compter
des retards.

---

## PARTIE VIII — Recherche et contexte (RAG borné)

- **Recherche par sujet** : `searchSiteSubjects` (nom OU contenu rattaché).
- **Contexte bibliothèque** : `buildLibraryContext(orgId)` (cookie-free, scopé org).
- **Recall documentaire** : `buildDocumentContext` borné, citable `[doc:id]`.
- **Confrontation AO ↔ expérience** : `getAoExperience` (Partie VI).

**Principe** : le contexte est **borné et scopé** (org, site), pré-calculé quand possible.
Pas de RAG généraliste non maîtrisé. **Limite assumée** : pas d'embeddings/recherche
sémantique avancée au cœur — le moat est l'**adressage déterministe** (sujet canonique),
pas le LLM.

---

## PARTIE IX — Sécurité et confiance

- **Sources obligatoires** : chaque contrainte/risque/engagement porte sa source verbatim.
- **Niveaux de confiance de citation** (`lib/engagements/citation.ts`) :
  `exact` (page fiable, via marqueur) / `section` (chapitre, pas de page) /
  `approximate` (concept seul). L'UI s'adapte : page → « ouvrir la page » ; sinon →
  « ouvrir le document » ou « référence approximative », **jamais de saut vers une fausse page**.
- **Provenance** : `site_obligation.origin_*` (tender, engagement, extrait, page, section).
- **Paragraphe / occurrences** : `lib/pdf/paragraph.ts`, `lib/pdf/occurrences.ts`
  (localisation déterministe dans le texte balisé).
- **Pourquoi MemorIA n'invente jamais volontairement** : une fausse page détruit la
  confiance au premier clic ; mieux vaut « approximatif » honnête que « page 148 » faux.

---

## PARTIE X — Futur de l'architecture

| Sujet | Statut |
|---|---|
| Assertions formelles (atome unifié) | **boussole, pas codé** — le sujet canonique donne 80-90 % |
| Multi-documents (un dossier = N PDF) | prévu, post-pilote |
| Contradictions inter-documents | prévu, dépend du multi-doc |
| Jumeau documentaire / carte du sujet | prévu (Niveau 3-4) |
| Contradicteur IA (LLM) | **refusé pour l'instant** : corpus trop pauvre, faux positifs |
| Priorisation auto des sujets coûteux | prévu, gated par la donnée réelle |
| Mémoire d'entreprise (cross-chantiers apprise) | vision, prérequis = volume + corpus propre |

---

## CHAPITRE SPÉCIAL — Pourquoi MemorIA est construit comme cela
*(Les décisions d'architecture qui valent le plus cher à transmettre.)*

**Pourquoi des Sujets, et pas des dossiers/tâches ?** Parce qu'un chantier est une
**histoire**, pas une liste. Le Sujet est la seule structure qui permet de répondre à
« où en est le DOE et pourquoi » sans tout relire. Sans lui, l'expérience se fragmente.

**Pourquoi pas un ERP classique ?** Un ERP gère des processus rigides et des personnes.
MemorIA gère de la **mémoire et de la preuve**, et refuse explicitement le pointage/RH.
Le marché des ERP chantier est saturé et tous échouent sur l'adoption ; le moat de MemorIA
est ailleurs (mémoire réutilisable).

**Pourquoi les engagements deviennent des obligations (et ne meurent pas dans le contrat) ?**
Parce qu'une promesse écrite sans suivi ne vaut rien. Le pont engagement → obligation →
sujet est ce qui transforme un document mort en réalité suivie et prouvable. C'est *la*
transformation produit.

**Pourquoi l'IA ne crée pas directement les actions/obligations ?** Parce que « l'IA
propose, l'humain valide ». Une obligation créée sans validation humaine serait une
décision autonome de la machine — exactement ce qui détruit la confiance métier (juridique).

**Pourquoi le déterministe est privilégié au LLM ?** Coût, stabilité, explicabilité,
vérifiabilité. Un retard se compte ; on ne demande pas à un LLM (cher, variable) de le
faire. Le LLM est réservé à la compréhension de langage. Cette frontière (Partie VII) est
une décision structurante, pas une commodité.

**Pourquoi ne jamais inventer une page ?** Parce que la promesse du produit est « l'IA
n'invente pas ». Un seul clic vers une fausse page et tout le module est discrédité. D'où
les marqueurs `[[page N]]` (page déterministe) + les niveaux de confiance.

**Pourquoi le QR ne modifie pas le suivi interne ?** Parce qu'une déclaration d'entreprise
est une déclaration, pas une vérité. Le maître d'œuvre garde la main ; sinon MemorIA
deviendrait un outil de pointage subi.

---

## ANNEXES (à compléter / générer depuis le code)
- **Annexe A — Glossaire technique** : termes du code (sujet canonique, provenance,
  citation level, materialize, find-or-create…).
- **Annexe B — Schéma de base de données** : à générer depuis `supabase/migrations/`
  (ne pas recopier à la main — risque d'écart ; produire depuis les fichiers de migration).
- **Annexe C — Flux complets des données** : versions détaillées des pipelines de la Partie IV.
- **Annexe D — FAQ développeur** : « pourquoi after() ne marche pas sur Vercel », « pourquoi
  unpdf et pas pdf-parse », « pourquoi le test vitest frappe une vraie Supabase »…

> *Les annexes A-D sont volontairement laissées en squelette : elles doivent être
> **générées depuis le code** lors d'un rafraîchissement, pas rédigées de mémoire, pour
> rester exactes.*
