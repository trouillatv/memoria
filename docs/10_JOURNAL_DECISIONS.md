# Journal des décisions

Décisions architecturales et produit notables, avec leur contexte et leur raison. À compléter à chaque décision significative.

---

## 2026-06-15 — Doctrine vue agent : passage V6 → V7 (la frontière est la RH, pas les noms)

**Décision** : bascule du mode doctrinal `DOCTRINE_AGENT_VIEW` de **V6 → V7** dans `tests/doctrine/v67-brief-reprise.test.ts`. La **vue agent autonome** (`/intervenants/[id]` et assimilées : sites connus, contrats travaillés, interventions passées, continuité terrain) devient **autorisée**.

**Raison** : la doctrine d'anonymisation, forgée pour le nettoyage, était **trop sévère**. L'intention réelle n'a jamais été de masquer les personnes, mais de **ne jamais devenir un outil RH**. Montrer un nom et l'historique opérationnel d'un intervenant ≠ surveillance.

**Ce qui reste verrouillé (strate A, cœur non négociable, V6 ET V7)** : scoring/ranking/performance/productivité/comparaison entre personnes, routes `/<personne>/[id]/(performance|score|ranking|…)`, tables `*_performance`/`*_score`, générateurs IA personne→analyse hors événement, vocabulaire de jugement. Aucune de ces lignes rouges ne bouge.

**Correctif annexe** : faux positif du garde-fou « générateur personne→analyse » sur `acknowledgeHandoverBrief(id, userId)` — c'est un **accusé de réception** (mutation `acknowledged_by`), même famille que la traçabilité opérationnelle de l'ALLOWLIST. Ajout d'une exclusion des verbes consommateurs (`acknowledge|mark|read|get|…`) : une mutation/lecture ne génère pas d'analyse.

**Impact code** : `tests/doctrine/v67-brief-reprise.test.ts` (mode + heuristique). Aucune route n'est ajoutée ni supprimée — `/intervenants/[id]` existait déjà et devient conforme.

---

## 2026-05-27 — Passages de témoin : date d'effet obligatoire, suppression, audit board Lot A

**Décision** :
- **Date d'effet obligatoire** sur tout passage de témoin (changement d'équipe + prise de site), saisie à toutes les portes (sélecteur `/handovers`, fiches, offboarding) ; affichée sur le brief, la page publique et le PDF.
- **Suppression** (soft-delete) d'un brief, distincte de l'**archivage** — qui, corrigé, ne masque plus le brief (il reste dans l'onglet « Archivé »). Donnée conservée, restaurable par admin, action tracée.
- Audit board `/handovers` → **Lot A** livré : complétude des anomalies scopée au site côté DB, garde-fous `deleted_at`/`status` sur share+acknowledge, self-exclusion appliquée au serveur, nom de fichier PDF neutre.
- `/h/[token]` : **PDF imprimable + QR** ; **sélecteur de personne** depuis `/handovers` (fin d'une fausse impasse vers la liste des intervenants).

**Raison** : un passage de témoin doit toujours dire à partir de quand il est effectif ; un brief créé par erreur doit pouvoir disparaître sans détruire la donnée ; un brief de continuité incomplet ou un nom qui fuite casse la confiance terrain.

**Alternative écartée** : date d'effet facultative (jugée moins bloquante par l'audit terrain) — arbitrage Vincent pour l'obligatoire partout (cohérence).

**Impact code** : `app/(dashboard)/handovers/**`, `lib/db/handover.ts`, migration `088`, `app/h/[token]/**`, `OffboardingDialog`.

## 2026-05-27 — Coût IA visible en XPF + temps mémoriel (Sprint D, moitié 1)

**Décision** :
- Coût IA affiché en **tooltip discret, en XPF** (ratio d'affichage stable USD→XPF, pas de FX live), basé sur la **moyenne observée** des dernières actions du même type — responsabilise avant le clic, visible managers+admins.
- **Temps mémoriel** : grammaire figée à **4 états humains** (Présent / En sommeil / Clos / Remplacé), déterministe, zéro score. Résolution explicite des résonances (statut `resolved`, réversible) + **supersession visible** sur les documents. Garde-fous CI.
- **Moitié 2 de Sprint D** (calibration de la décroissance, apparition adaptative) **gelée** jusqu'à l'usage réel de Guillaume.

**Raison** : transparence honnête du coût (devise du pilote = XPF) ; rendre le temps de la mémoire explicable sans sur-sémantiser ni introduire de score.

**Impact code** : `lib/memory/temps-memoriel.ts`, `lib/format/currency.ts`, `app/(dashboard)/documents/**`, `AiCostHint`, migrations `087`.

## 2026-05-27 — Gestion des collections documentaires

**Décision** : déplacer un document entre collections (glisser-déposer + menu), groupe « Sans collection », éditer une collection (renommer / réordonner / supprimer avec 2 modes : orphelin ou suppression des fichiers). `collection_id` devient nullable. Les rattachements document↔site/mission sont **préservés** quel que soit le rangement.

**Impact code** : `app/(dashboard)/documents/CollectionLibrary.tsx`, `lib/db/documents.ts`, migration `086`.

## 2026-05-20 — Niveau B : raffinements gravés sur B0 (verrou produit anti-hallucination)

**Décision** : Vincent ratifie B0 avec 3 raffinements **non négociables** intégrés au spec :
1. **Seuils NON figés comme doctrine** — un cosine n'est pas un fait ; mesurable, interne, ajustable par `algorithm_version`. Aucune constante 0.65 codée en dur comme valeur opposable. `internal_score` reste interne (verrou CI à prévoir : aucun import depuis `app/**`).
2. **Documents juridiques** (`litige/contrat/avenant/facture`) = zone à risque d'interprétation sensible. `visibility ≥ manager`, audit obligatoire, wording prudent (« pourrait », « à vérifier »), validation humaine avant toute exposition partagée (B3), tripwire structurel client_portal.
3. **Filtres critiques AND anti faux liens sémantiques** (un seul manquant = pas de candidat) : `document_links` + `document_type` (couples autorisés explicites) + `target_type` + `source_domain`. « Accès » matche sécurité/badge/informatique/portail/login → sans ces 4 filtres, β devient un moteur d'absurdités.

Ajouts B1 : **métriques internes obligatoires** (lectures générées, clic, dismiss, validé, faux positifs revus) — **gate B2 deux fois** (couverture α insuffisante démontrée *et* faux positifs B1 sous seuil défini par Vincent).

**Raison** : le verrou conceptuel central de B n'est pas la technique pgvector mais empêcher que « documents → mémoire du site » devienne un moteur d'hallucinations automatiques. MemorIA passe d'un système de stockage/retrieval/chat à un **système de mémoire opérationnelle contextualisée** ; la frontière est dangereuse, et les meilleurs systèmes mémoire **montrent très peu**.

**Impact code** : AUCUN. Spec amendée. Ratifications 1-3-5-7 ✅, 4 raffinée, 2 confirmée (scénarios B1), 6 ouverte (table dédiée vs extension `site_reading_candidates` — à trancher si B2 ouvert). **B1 peut démarrer sur feu vert explicite**.

**Lien** : Conversation Claude 2026-05-20, branche `feat/access-events`.

---

## 2026-05-20 — Niveau B documents : étude B0 livrée, ratifications avant B1

**Décision** : Niveau A clos et sain (baseline post-Niveau-A : 685/76/17 — 0 régression, `ensure-today` formellement disculpée par diff). Ouverture de **B0 = étude** (spec `2026-05-20-niveau-b-documents-memoire-relationnelle.md`), **zéro code**. Recommandation gravée : **approche α (lectures dérivées déterministes lien-fort) en B1**, **approche β (pont cross-store `cross_store_resonances` pré-calculé event-driven, seuil cosine 0.65, plafonds 3 lectures/site, 2/contrat)** en B2 *conditionnel* à mesure bruit/couverture de B1. **Approche γ (dupliquer chunks doc dans trace_embeddings) rejetée**. B3 preuves/rapports = consommation visibility-gated + validation humaine. B4 mémoire agents IA = Lecture 1 stricte, recall borné par requête (jamais d'historique gonflant le prompt).

**Raison** : `trace_embeddings` (site-scopé) et `knowledge_chunks` (tenant-scopé) sont 768-dim mais sans RPC cross-store ; faire dialoguer terrain/documents/AO/contrats/sites exige du **pré-calcul async** (pattern `site_reading_candidates` existant) borné structurellement par `document_links`, jamais un cross-product live. Le LLM génératif est interdit dans la production de lectures ; embeddings/cosine pgvector OK. `internal_score` reste **interne** (V6.4 : verrou CI).

**Garde-fous Niveau B (binding)** : pas de lecture sans source vérifiable (`[doc:id]` + `[trace:id]`), pas de vérité automatique, pas de scoring exposé, pas de fiche personne (V6.2/V6.8 + k=4 V6.7 sur résonances nominatives), visibility_level appliqué **deux fois** (indexation + render), pas de recalcul render, pas d'IA générative, plafonds anti-bruit, pas d'auto-exposition client (V6.6).

**Impact code** : **AUCUN**. Aucune migration, aucune table, aucun job. 7 décisions à ratifier (cf. spec §Décisions) avant ouverture B1.

**Lien** : Conversation Claude 2026-05-20, branche `feat/access-events`. Niveau A clos (commits `b92cc14`..`3d2d6cc`), Niveau B = études uniquement tant que les ratifications ne sont pas posées.

---

## 2026-05-19 — Option C + convergence knowledge_items→documents (planifiée, non exécutée)

**Décision** : (court terme, fait — `8b632fd`) une seule entrée menu « Bibliothèque » → `/documents` (expérience documentaire vivante) ; `/library` (savoir curé `knowledge_items`) reste **intacte** (route directe + lien contextuel AO), hors menu principal ; pipeline `knowledge_items` (`buildLibraryContext`, `matchAoToKnowledge`, embed, backfill, agents) **non touché** ; aucune migration. (moyen terme, **planifié non exécuté**) converger `knowledge_items` en `document_type='knowledge'` du système générique — spec `specs/2026-05-19-knowledge-documents-convergence.md`.

**Raison** : les deux systèmes finissent au même endpoint RAG (`knowledge_chunks`) → deux pipelines = dette (double embed/match, prompts dupliqués, double modèle mental). Fenêtre idéale = MVP (les deux quasi vides) ; migration douloureuse plus tard. Mais l'arc documents vient d'être livré stable/testé → pas de gros refactor immédiat (discipline : converger tôt, pas brutalement).

**Invariant gravé** : un seul magasin ≠ une seule politique d'injection. La convergence doit préserver **deux sémantiques de retrieval** — savoir curé (`type=knowledge`) = snapshot permanent Atelier ; document source uploadé = recall borné par question (discipline coût IA). La politique se décide par `document_type`, pas par le store.

**Déclencheur opposable** : converger dès `documents`>~50 OU `knowledge_items`>~30 OU besoin d'un 2ᵉ chemin embed/match, OU feu vert explicite. Sinon coexistence.

**Lien** : Conversation Claude 2026-05-19, branche `feat/access-events`.

---

## 2026-05-19 — Ratification A–K : architecture documentaire = pilier central

**Décision** : Vincent ratifie les décisions A–K de `specs/2026-05-19-document-lifecycle-design.md`. Le document devient un **nœud de la couche mémoire centrale** (pas un fichier attaché). Affinements gravés : (C) collection **obligatoire à l'upload** ; (G→**J**) accès non plus `admin/manager` rigide mais `visibility_level` gradué (`admin_only|manager|operations|field|client_portal`) propagé jusqu'au chunk metadata (le filtre vaut au recall RAG, pas seulement UI), audit obligatoire à tout niveau ; (I) états d'analyse explicites `pending→ocr?→extracting→chunking→ready|failed`, bouton « Réanalyser » obligatoire, chunk explorer prévu ; (**K**) bulk import + `content_hash` dédup prévus dès J1 (structure), implémentation roadmap.

**Raison** : éviter le piège « Google Drive + IA collée ». Refus du `*_documents` par entité (enfer architecture à 6 mois) → `documents` + `document_links` polymorphe. Réutilisation totale du RAG existant (`knowledge_chunks`, embeddings 768, OCR, retrieval, injection agents) : `source_domain += 'document'`. La bibliothèque documentaire devient le pilier produit (« gestion intelligente de mémoire opérationnelle documentaire et terrain »).

**Impact** : 073 débloquée. Phase 1 = migration 073 additive (`documents`, `document_links`, `document_collections`, bucket, RLS rôle + `visibility_level`, `analysis_status`, `content_hash`, enum `source_domain`) + `lib/db/documents.ts`. Discipline 071/072 : commitée avec le code, **appliquée sur feu vert explicite**. Discipline coût IA (entrée ci-dessous) opposable à toutes les phases.

**Lien** : Conversation Claude 2026-05-19, branche `feat/access-events`.

---

## 2026-05-19 — Discipline coût/perf IA : async pré-calcul, jamais « LLM live partout »

**Décision** : contrainte d'architecture transverse **opposable** (au même titre que les garde-fous doctrine). Toute proposition touchant l'IA (embeddings, OCR, voice, Atelier/agents, mémoire, documents) suit `écriture/analyse async → stockage → pré-calcul → lecture SQL pure` ; jamais `ouverture page → recalcul IA / prompts live / embeddings live / relecture documents`. Agents Atelier = retrieval **ciblé et borné** (question → k chunks pertinents → réponse), jamais « 7 agents × 20 docs × 10k tokens », jamais copilote permanent ni contexte non borné. Documents : analysés une fois, jamais relus en continu ; context budget agent plafonné et testé.

**Raison** : MemorIA s'enrichit (mémoire terrain, embeddings, voice, OCR, Atelier, biblio docs, matching AO, résonances, docs contrat). Le risque coût/perf n'est ni l'embedding (rare, peu cher) ni le MVP Guillaume — c'est le LLM live, les agents permanents, la relecture documentaire massive, les prompts non bornés. L'IA doit rester discrète, ciblée, async, capitalisante, faible coût, forte utilité — pas un SaaS « full agent » ni une UX dépendante du LLM.

**Impact** : gravé dans la mémoire projet (`ai-cost-discipline`) et opposable dans `specs/2026-05-19-document-lifecycle-design.md` (section dédiée + décision I : `analysis_status`, relance OCR explicite, chunk metadata riche, inspection chunks, context budget testé). Observabilité coût IA (par tenant/feature/OCR/voice/Atelier, tokens, embeddings, docs) ajoutée à la **roadmap différée explicite** (pas maintenant ; base `ai_usage` 008 existe déjà).

**Lien** : Conversation Claude 2026-05-19, branche `feat/access-events`. Cadre toutes les futures propositions IA.

---

## 2026-05-19 — Pilier V6.8 : vue Agent configurable V6↔V7 (raffinement enforcement)

**Décision** : Vincent raffine l'enforcement V6.7. Principe gravé : *on change la doctrine explicitement, jamais en contournant les tests*. Les verrous doivent protéger la philosophie (anti dérive RH/surveillance), pas empêcher l'évolution produit ni la traçabilité opérationnelle. Introduction du **Pilier V6.8** : la vue Agent n'est plus interdite définitivement mais **différée et configurable** via `DOCTRINE_AGENT_VIEW: 'V6' | 'V7'` (`tests/doctrine/v67-brief-reprise.test.ts`). Deux strates : (A) **cœur RH** — route/table/symbole/générateur/vocabulaire de scoring-ranking-jugement humain — interdit en V6 **et** V7 ; (B) **vue agent autonome** — refusée en V6 (défaut, refus V6.2 maintenu), autorisée en V7 sous contraintes de continuité opérationnelle (sites connus, contrats travaillés, interventions passées, habilitations, heures déclarées, documents, continuité).

**Raison** : besoin Guillaume réel — retrouver les agents par contrat, qui connaît quel site, heures par projet, rappeler les bonnes personnes. Le build-breaker total « aucune personne sujet » produisait des faux positifs et bloquait une évolution légitime. La bonne règle : *un humain peut être cité comme auteur d'un événement, jamais devenir le sujet d'une analyse/score/historique autonome.* Passer en V7 reste une décision doctrinale explicite (cette entrée + Pilier V6.8), pas un contournement.

**Garde-fous** : cœur RH rouge dans les deux modes ; conflit msg-1/msg-2 sur `/…/[id]/history` tranché explicitement en faveur de l'autorisation V7 (route = vue continuité ≠ table `*_history` = magasin RH, qui reste interdit) ; section **ALLOWLIST** testée garantissant que `created_by`/`taken_by`/`assigned_to`/auteur de note/clôturé par/audit/équipe/personne citée dans un événement ne cassent jamais le build ; build-breakers re-vérifiés par sondes (mordent sur le vrai interdit, pas sur la traçabilité).

**Impact code** : `tests/doctrine/v67-brief-reprise.test.ts` réécrit (15 tests, configurable + allowlist). Doctrine `exploitation-doctrine-V6.md` : Pilier V6.8 ajouté, section Enforcement reformulée. `applyContinuityKThreshold` (verrou k=4) inchangé.

**Lien** : Conversation Claude 2026-05-19, branche `feat/access-events` (suite directe de V6.7).

---

## 2026-05-19 — Règle de gouvernance : toute ouverture paie son coût structurel

**Décision** : élévation, en tête de `exploitation-doctrine-V6.md`, d'un principe de gouvernance opposable : toute ouverture/exception est recevable, mais une ouverture sans garde-fous exécutables est nulle ; les verrous (tests CI, interdits structurels) sont livrés dans le même changement que l'exception. Ajout d'une 6ᵉ question conditionnelle au Test consolidé V6.

**Raison** : V6.7 a prouvé que la doctrine peut s'ouvrir sans se dissoudre — mais uniquement parce que l'ouverture a payé son coût structurel. Sans règle gravée, la prochaine demande « le terrain le demande » rouvre le débat de zéro (dérive par concessions successives décrite dans `refusals-log.md`). Le principe est lui-même une ouverture de la couche gouvernance : il paie son coût en devenant opposable plutôt que conversationnel.

**Limite assumée** : le texte rend le principe citable, pas auto-appliquant. Son effet réel dépend d'exiger les tests dans la même PR que la feature, à l'usage.

**Lien** : Conversation Claude 2026-05-19 (suite directe de l'arbitrage V6.7 ci-dessous).

---

## 2026-05-19 — Doctrine V6.7 : réouverture bornée « reprise & continuité »

**Décision** : Vincent arbitre l'ouverture, dans `exploitation-doctrine-V6.md` (Pilier V6.7), de deux capacités jusqu'ici refusées : (1) surfaces de continuité site/contrat rendues **obligatoires** (intervenants en continuité, libellés non navigables) ; (2) **brief de reprise déclenché par événement** (départ/indisponibilité d'un intervenant) où la personne est un paramètre éphémère et le sujet du résultat est le site/contrat. Reste **refusé, inchangé** : toute route/page/recherche/index dont le sujet d'entrée est une personne (V6.2).

**Raison** : besoin terrain Guillaume réel et récurrent — anticiper la perte de continuité quand un porteur de mémoire part. Le strict V6.2 ne le servait que passivement (le site lit « continuité en baisse » *après* coup). Le brief déclenché-par-événement répond au besoin sans matérialiser un sujet-personne navigable.

**Garde-fous (six verrous simultanés, cf. Pilier V6.7)** : déclenchement-événement uniquement ; éphémère / zéro persistance ; sujet du résultat = site/contrat ; seuil k=4 anti-ré-identification (comble un trou laissé par V6) ; log d'audit obligatoire ; surfaces exploitation/admin only (jamais mobile/PDF/export/client). Retirer un verrou = retour au refus V6.2.

**Alternative écartée** : Option C (menu « Intervenants » + fiche personne limitée, même sans heures/score). Écartée : aucun bénéfice unique sur la version déclenchée-par-événement, et risque structurel SIRH — le critère « frontière techniquement infranchissable par accident » exigé par Guillaume lui-même l'interdit.

**Impact code** : Enforcement V6 étendu **livré** — `tests/doctrine/v67-brief-reprise.test.ts` grave les verrous 6-9 (déclenchement-événement, zéro persistance, seuil k, audit). Verrous 6/7/9 = tripwires structurels : verts sur le code actuel (feature *brief de reprise* toujours non construite), rouges dès qu'un générateur viole un verrou (vérifié par probes non-conformes). Verrou 8 = fonction pure testée `applyContinuityKThreshold` (`lib/db/site-cockpit.ts`, k=4 gravé) : le contrat importable que le futur brief DEVRA traverser. **Bornage assumé** : le helper k=4 n'est *pas* recâblé dans la surface site-first `HumanContinuityList` déjà livrée (V5.1.4, gouvernée V5.1.3) — étendre k=4 à cette surface est une décision produit/doctrine distincte, hors périmètre des verrous V6.7. Le brief lui-même reste non implémenté (cf. Séquence d'activation : interprétatif « jamais avant » le pilote).

**Lien** : Conversation Claude 2026-05-19 (session MemorIA, branche `feat/access-events`). Registre des refus mis à jour.

---

## 2026-05-13 — Monitoring admin : exception doctrinale assumée pour métriques per-user

**Décision** : `/admin/monitoring` conserve un tableau utilisateurs avec dernière connexion + nombre d'actions sur la période, ainsi qu'un feed nominatif de l'activité récente. Décision prise par le DG après audit doctrinal qui a identifié la violation de Doctrine V5.

**Raison** : le DG a un besoin réel d'hygiène opérationnelle (« qui s'est logué, pour faire quoi »). Le strict respect de la doctrine V5 sur cette surface empêcherait l'admin de diagnostiquer un compte abandonné, un chef d'équipe qui n'utilise pas l'outil, ou un manager qui ne fait pas son travail. Cette surface est admin-only et ne sort jamais vers les utilisateurs concernés.

**Garde-fous explicites** :
- Surface admin uniquement (RLS + check de rôle en tête de page)
- Aucune de ces données ne sort jamais en PDF, en export, vers un manager ou vers un client
- Pas de classement, pas de score, pas de comparaison inter-utilisateurs visible
- Le contexte du tableau reste « hygiène d'identité », pas « évaluation des performances »

**Alternative écartée** : version anonymisée par rôle (« 3 chefs d'équipe actifs, 47 actions »). Trop floue pour diagnostiquer des problèmes opérationnels concrets.

**Impact code** : commentaire d'avertissement en tête de `lib/db/admin-monitoring.ts` pour qu'aucun futur dev ne réutilise ces helpers ailleurs.

---

## 2026-05-14 — Discipline produit post-audits : verrou V6 + registre features

**Décision** : après les 5 audits de rôle (DG, Manager, Chef d'équipe, Cliente, Avocate) + 5 audits techniques sur les Phases 1-4 livrées, formalisation d'un **principe d'attention minimale** (verrou V6) et création d'un **registre des features refusées** pour éviter la dérive ERP.

**Raison** : les 9 audits ont identifié ~20 frictions réelles. Beaucoup de solutions paresseuses (push notifications, ticketing client, score de criticité, auto-distribution planning, portail extranet) ramèneraient MemorIA vers Progiclean/PROPRET. La discipline produit est désormais la principale source de différenciation.

**Impact code** :
- `docs/09_REGLES_DE_MODIFICATION.md` : nouveau verrou V6 « Principe d'attention minimale »
- `docs/11_REGISTRE_FEATURES.md` : nouveau document trackant sprints livrés, en cours, reportées (post-pilote), refusées (anti-doctrine)

**Features explicitement refusées et inscrites en registre** :
- Push notifications temps réel anomalies
- Tri par criticité avec champ severity
- Score d'urgence
- Auto-distribution planning
- Module ticketing client
- Portail extranet client
- Email auto multi-destinataires
- Suivi de qui a lu quoi (côté collaborateurs internes)

**Features reportées post-pilote réel** (à reconsidérer après retour terrain, pas avant) :
- Mode prise de poste
- Patterns récurrents
- Transmission silencieuse à l'archivage user
- Voix sur À savoir + anomalies

**Phrase produit consolidée** : *MemorIA = l'endroit où la mémoire opérationnelle survit aux humains, et tient juridiquement, sans demander leur attention.*

---

## 2026-05-14 — Mot de passe temporaire partagé `memoria2026` (revert)

**Décision DG (revert)** : mot de passe temporaire en dur, `memoria2026`, pour toutes les créations en mode temp_password et tous les resets. Pas de variable d'environnement, pas de dialog d'affichage à la création/au reset.

**Raison** : la version aléatoire à usage unique (livrée le 2026-05-13 suite à l'audit) ajoutait un dialog modal et un copier-coller manuel à chaque création/reset. UX trop friction pour le DG. La doctrine de l'app vise la simplicité opérationnelle.

**Garde-fous compensatoires conservés** :
- `must_change_password` flag posé en DB ET en `app_metadata.must_change_password` du JWT
- Middleware racine `middleware.ts` redirige toute requête authentifiée vers `/change-password` tant que le flag est actif — empêche un attaquant qui connaîtrait `memoria2026` d'utiliser un compte non encore initialisé sans changer le mdp
- L'attaque résiduelle reste : si un attaquant connaît l'email d'un user fraîchement créé/reseté et qu'il bat l'user à la première connexion, il peut prendre le contrôle du compte. Mitigation : prévenir l'user de la création par un canal différent (SMS/WhatsApp), et lui demander de se connecter rapidement.

**Impact code** : revert de `app/admin/users/actions.ts`, `CreateUserForm.tsx`, `ForcePasswordResetButton.tsx`, `page.tsx`.

---

## 2026-05-13 — Mot de passe temporaire aléatoire (annulé le 2026-05-14)

**Décision (annulée)** : génération aléatoire 96 bits par création/reset, affichée une fois dans un dialog admin.

**Annulé** : voir entrée 2026-05-14 ci-dessus. Le compromis UX/sécurité a été tranché en faveur de l'UX.

---

## 2026-05-13 — Défense en profondeur sur la lecture du rôle utilisateur

**Décision** : `getUserRoleById(userId)` tente d'abord le server client (RLS appliqué) pour les self-reads. Fallback admin client uniquement pour les lookups cross-user (admin lisant un autre user) ou les contextes sans session (scripts).

Ajout d'un `getCurrentUserRole()` pour le code neuf — API préférée, jamais d'admin par défaut.

**Raison** : audit a montré que toutes les `requireAdmin/requireManagerOrAdmin/requireFieldAgent` des 20 fichiers de server actions appellent `getUserRoleById` en bypass admin. La nouvelle stratégie ferme ce vecteur quand l'utilisateur lit son propre rôle (cas dominant), sans casser les call sites existants.

**Migration future restante** : la couche `lib/db/` utilise massivement l'admin client (~150 call sites). Migration progressive recommandée — priorité aux fonctions user-scope (`listInterventionsVisibleToUser`, `getSiteResumeContext`, etc.) qui devraient passer en server client + RLS. Les agrégats admin (dashboard, monitoring, audit log) gardent l'admin client à juste titre.

**Impact code** : `lib/db/users.ts` (transparent — aucun call site à modifier). `lib/auth/require.ts` ajouté comme point central pour le code neuf.

---

## 2026-05-13 — Middleware enforce must_change_password sur toutes les routes

**Décision** : création d'un `middleware.ts` racine qui vérifie le flag `app_metadata.must_change_password` du JWT et redirige vers `/change-password` toute requête authentifiée tant que le flag est actif.

**Raison** : audit sécurité a montré que `must_change_password` n'était vérifié qu'au login. Un utilisateur pouvait obtenir un JWT via cURL, sauter la redirection, et appeler n'importe quelle server action avec le mot de passe temporaire. Le middleware ferme cette porte.

**Impact code** :
- `middleware.ts` (nouveau, racine)
- `app/admin/users/actions.ts` : `createUserAction` (temp mode) et `forcePasswordResetAction` posent `app_metadata.must_change_password = true` via l'admin API
- `app/(auth)/change-password/actions.ts` : efface `app_metadata.must_change_password` via l'admin API après changement réussi

---

## 2026-05-13 — Monitoring admin : requêtes live, pas d'agrégats précalculés

**Décision** : le monitoring admin (`/admin/monitoring`) utilise des requêtes SQL directes à chaque chargement de page. Pas de table de métriques, pas de cron.

**Raison** : le volume d'une PME nettoyage (< 100 users, < 1000 interventions/mois) ne justifie pas une infra de métriques. Les requêtes live restent < 200ms sur ce volume.

**Alternative écartée** : table `admin_metrics_daily` calculée chaque nuit — infra supplémentaire, données décalées de 24h, complexité de maintenance.

---

## 2026-05-13 — Suppression page `/admin/preparation`

**Décision** : page supprimée car redondante avec la gestion des téléphones dans `/admin/users`.

**Raison** : la préparation des chefs d'équipe (WhatsApp 1-à-1) est accessible depuis la page users. Maintenir deux surfaces pour la même fonctionnalité créait de la confusion.

---

## 2026-05-13 — Archive avec motif pour les engagements actifs

**Décision** : les engagements `active` ne peuvent pas être supprimés (hard delete ou reject). Ils doivent être archivés avec un motif obligatoire (min 3 chars).

**Raison** : un engagement actif peut avoir des interventions liées. Supprimer brutalement casserait la chaîne Engagement→Mission→Intervention→Preuve. L'archivage préserve la traçabilité. Si des interventions sont déjà liées (`hasLinkedInterventions()`), l'archivage est bloqué.

**Implémentation** : `archiveEngagement(id, reason)` stocke `source_ref: { archived_reason, archived_at }`.

---

## 2026-05-12 — Doctrine V5 : pivot "organisation vs surveillance"

**Décision** : reformulation du principe directeur. Le produit organise la couverture terrain, il ne mesure jamais les humains. Toute feature qui attribue une performance à un individu est interdite.

**Test ultime** : "Est-ce que ce champ rend un humain anonyme ?" Si non → interdit.

**Impact code** : pas de `assigned_to` sur les interventions, pas de métriques par personne, affectation par équipe uniquement.

---

## 2026-05-13 — WhatsApp desktop via schéma URI `whatsapp://`

**Décision** : sur desktop (non-mobile), le bouton de partage tente `whatsapp://send?text=...` plutôt que `https://api.whatsapp.com/send`.

**Raison** : `whatsapp://` ouvre l'app desktop native si installée, sans passer par le navigateur. Le texte est aussi copié dans le clipboard comme fallback.

**Alternative écartée** : `https://api.whatsapp.com/send` — URL externe, risque de tracking, ne fonctionne pas si pas de navigateur par défaut configuré.

---

## 2026-05-XX — Récurrence paresseuse à 7j

**Décision** : les interventions récurrentes sont générées à la demande pour les 7 prochains jours uniquement, pas en masse.

**Raison** : éviter des milliers de lignes en DB pour des contrats longs. La vue semaine et le briefing déclenchent la génération pour leur fenêtre temporelle.

**Risque géré** : si personne ne consulte l'appli pendant > 7j, des interventions passées ne sont pas créées. Acceptable — si personne ne regarde l'appli, les interventions n'ont pas lieu non plus.

---

## 2026-05-XX — `engagement_ids[]` sur missions (pas de table de jonction)

**Décision** : la relation many-to-many Missions↔Engagements est stockée comme tableau `uuid[]` côté `missions.engagement_ids`, pas via une table de jonction `mission_engagements`.

**Raison** : simplification des requêtes de compliance. La majorité des lectures vont "d'un engagement → quelles missions le couvrent" ou "d'une mission → quels engagements". Avec un tableau, `contains('engagement_ids', [engagementId])` suffit.

**Limite** : pas de métadonnées sur la relation. Acceptable pour le cas d'usage actuel.

---

## 2026-05-XX — Multi-provider IA avec factory

**Décision** : l'IA est abstraite derrière une factory (`services/ai/factory.ts`). Le code produit ne référence jamais directement Anthropic ou Gemini.

**Raison** : les providers évoluent vite. Découpler permet de changer de provider sans toucher au code métier. Le provider `mock` permet des tests déterministes sans appel API.

**Sélection** : variable d'environnement `AI_PROVIDER` (mock | anthropic | gemini).

---

## 2026-05-XX — Soft delete systématique

**Décision** : toutes les entités métier utilisent `deleted_at` (soft delete). Aucun `DELETE` physique.

**Raison** : traçabilité et récupération en cas d'erreur. Les preuves, interventions et engagements doivent rester accessibles même après "suppression" (litige potentiel).

**Exception** : données de test (`__test`) — supprimées physiquement par le teardown Vitest.

---

## 2026-05-XX — Verrou V3 : "clôturé" pas "résolu"

**Décision** : le vocabulaire du dossier de preuve utilise "clôturé" (action irréversible), jamais "résolu" (jugement de valeur sur la situation).

**Raison** : "résolu" implique que le problème n'existe plus, ce qui peut être juridiquement faux. "Clôturé" est un acte documentaire neutre, défendable en cas de litige.

---

## Template pour nouvelles entrées

```
## YYYY-MM-DD — Titre court

**Décision** : ce qui a été décidé

**Raison** : pourquoi (contrainte, incident passé, préférence forte)

**Alternative écartée** : ce qu'on n'a pas fait et pourquoi (optionnel)

**Impact code** : fichiers ou patterns affectés (optionnel)
```
