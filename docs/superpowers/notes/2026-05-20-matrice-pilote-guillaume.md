# Matrice pilote Guillaume — v3 (consolidée)

**Date :** 2026-05-20 (v3 — intégration des PARTIES 3-10 du recadrage Vincent)
**Statut :** Document maître de pilotage. Mini-études par partie (1 paragraphe / tableau dense), synthèse P10 à la fin.

---

## A. Cadre (gravé)

**5 piliers** : Sites · Contrats · Interventions · Équipes · Atelier IA — cf. [[noyau-memoria-5-piliers]]
**3 axes** : Mémoire opérationnelle · Preuve & capitalisation · Copilote sobre
**Refus** : cf. [[refus-erp-rh-pointage-gps]]
**Doctrine alertes légère** : cf. [[alertes-doctrine-legere]]
**Pivot page personne option B** : cf. [[page-personne-option-b]]

---

## B. Les 5 demandes Guillaume verbatim × cadre

| Demande                                          | Pilier dominant | Axe              | État doctrine                | Effort |
|--------------------------------------------------|-----------------|------------------|------------------------------|--------|
| **G1 — AO**                                      | Atelier IA      | Preuve           | ✅ acquise (B1/B2 livrés)     | M      |
| **G2 — Log temps agents + connaissances**        | Équipes         | Mémoire          | 🟡 ouverture page-personne B | L      |
| **G3 — Nature contrats agents**                  | Équipes         | Mémoire          | 🟡 limite (non-comparatif)   | S      |
| **G4 — Quel agent sur quel site (historique)**   | Sites + Équipes | Mémoire          | 🟢 site-side OK              | M      |
| **G5 — Extension mémoire (plus de sources)**     | Atelier IA      | Mémoire + Preuve | 🟡 spec cold start            | XL     |

---

## C. Livré cette session (commits)

| # | Item                                                            | Commit                  |
|---|-----------------------------------------------------------------|-------------------------|
| 1 | Heures réelles + purge créneau                                  | `a8186a4`               |
| 2 | Ordre vue semaine par planned_start                             | `f474120`               |
| 3 | Vigilance rouge en haut /dashboard, /semaine, /aujourdhui, /m   | `90b4885` + `dff364d`   |
| 4 | Doctrine alertes légère + pivot page personne option B          | mémoire dédiée          |
| 5 | Matrice pilote Guillaume v3 (ce document)                       | (commit en cours)       |

---

## D. Mini-études par PARTIE (recadrage Vincent)

### PARTIE 3 — Contrats (vraie couche)

**Champs nécessaires** : client · sites · volume horaire · date début/fin · fréquence · prestations · documents · alertes expiration · AO liés · historique.

**Questions Vincent + réponse de pilotage** :
- *Faut-il un contrat parent multi-sites ?* → **Oui**, mais l'existant le supporte déjà (contrat → sites N:1, missions → sites N:1). Renforcer la VUE plutôt que la donnée.
- *Faut-il une notion de « mission récurrente contrat » ?* → Existe (`intervention_templates`). À mieux exposer dans l'UI contrat.
- *Comment relier heures ↔ contrat ?* → Via `interventions.planned_start/end` + `mission.contract_id`. Donnée existe. Vue à construire.
- *Comment calculer consommation horaire ?* → Agrégat `SUM(planned_end - planned_start) WHERE contract_id = X AND scheduled_for IN [période]`. **Sujet = contrat, jamais agent.** Garde-fou [[refus-erp-rh-pointage-gps]].

**Verdict** : pas de nouvelle table, surface contrat à enrichir (4 widgets : volume consommé / échéance / preuves récentes / AO liés). Effort M.

### PARTIE 4 — Historique agent (continuité opérationnelle)

**Ce qu'on veut** (Vincent) : quels sites un agent connaît · historique passages · historique contrats · volume heures · compétences implicites · mémoire terrain.
**Ce qu'on REFUSE** : scoring humain · ranking · productivité individuelle · surveillance comportementale.

**Données à stocker** : déjà présentes (jointures interventions × user via `intervention_executions` ou audit log).
**Données à NE PAS stocker** : moyenne, écart, classement, score métier calculé.
**Surface UI** : **page personne option B** uniquement (auto-consultation + admin audité ; manager direct exclu). Cf. [[page-personne-option-b]].
**Limites doctrinales** : règle d'or « cet objet » (cf. étude page-personne §4) — toute string interdite si elle requiert « cette personne » comme sujet.

**Verdict** : feu vert SOUS condition des pré-conditions §F de cette matrice. Effort L.

### PARTIE 5 — Dashboard exploitation

**Questions métier** (Vincent) :
- Quels contrats arrivent à expiration ? → ✅ widget existe (AtRiskEngagements + ContractsUnderTension), rougie ce jour
- Quels sites sans preuve récente ? → à ajouter (donnée présente via `getOpenAnomaliesStats` + last_intervention_date)
- Interventions non documentées ? → ✅ widget existe (overdue / incomplete sur /m + /aujourdhui)
- Contrats dépassant les heures ? → à ajouter (P3 ci-dessus)
- Sites qui génèrent le plus d'anomalies ? → à ajouter, **sujet = site**, jamais agent
- Quelles équipes connaissent quels sites ? → P4 ci-dessus (page site, section historique)

**Verdict** : la zone vigilance rouge livrée ce jour est le squelette. Reste à coder **3 widgets manquants** :
1. « Sites sans preuve récente » (sujet site)
2. « Contrats dépassant les heures prévues » (sujet contrat — issu de P3)
3. « Sites avec anomalies répétées » (sujet site, seuil ≥ N occurrences)

⚠️ Ne PAS ajouter de KPI startup (taux de conversion, vélocité, etc.). Vincent l'a refusé explicitement.

### PARTIE 6 — Alertes

✅ **Déjà fait** :
- Matrice doctrine longue : `notes/2026-05-20-matrice-doctrine-alertes.md` (référence non bloquante)
- Doctrine légère : mémoire `alertes-doctrine-legere`
- Vigilance rouge en haut sur 4 surfaces (commits `90b4885` + `dff364d`)

Reste à coder : `lib/alerts/registry.ts` + 2 alertes pilotes (J-30 contrat / J+2 intervention).

### PARTIE 7 — Mobile terrain

**Impact UX horaires réels** : ✅ livré ce jour (purge créneau, ordre planned_start, conflit horaire chevauchement).
**Simplicité planning** : `/m` reste max-w-md, tap-friendly. ✅
**Vue journée** : déjà chronologique. ✅
**Scroll chronologique** : ordering par planned_start livré.
**Regroupement site** : actuellement par slot (matin/AM/soir). À changer en regroupement par site SI plusieurs interventions même site même jour — **TODO petit**.
**Saisie heure** : `<input type="time">` livré dans CreateInterventionDialog. ✅
**Démarrage/fin intervention** : actuellement bouton « Démarrer » → in_progress, bouton « Clôturer ». Pas d'horodatage exact saisi par le chef → la doctrine V6.1 dit que l'ancrage = prestation, pas pointage personne. **Garder ainsi**, ne pas demander à Guillaume « tu as commencé à quelle heure exactement ».

**Verdict** : mobile terrain est aux 80 %. Reste 1 ajustement (regroupement site quand pertinent).

### PARTIE 8 — IA : carte utile vs toxique

| IA UTILE                                 | IA TOXIQUE                              |
|------------------------------------------|------------------------------------------|
| ✅ Mémoire des sites (résonances, lecture)| ❌ Scoring humain                         |
| ✅ Résonances site (B1/B2 livré)          | ❌ IA RH (« cet agent est performant »)  |
| ✅ AO matching (Atelier livré)            | ❌ Prédiction employés (« va démissionner ») |
| ✅ Rapports synthèse (déjà partiellement) | ❌ Surveillance comportementale          |
| ✅ Centralisation connaissances (documents)| ❌ Comparaison inter-personnes           |
| ✅ Alertes contextuelles (matrice §3.1)   | ❌ Détection d'anomalie d'agent          |
| ✅ OCR / voice → texte (déjà)             | ❌ Sentiment analysis sur les notes      |
| ✅ Cold start (G5) — bootstrap historique | ❌ Recommandation d'affectation auto     |

**Règle d'or** : *l'IA travaille sur des LIEUX et des DOCUMENTS, jamais sur des PERSONNES en tant que sujets.* (cf. page personne option B où la personne consulte elle-même = exception balisée, pas une IA qui juge la personne).

### PARTIE 9 — Migration stratégie

**Ce qu'on a déjà construit** (à préserver) :
- Architecture V6.1 horaires précises (migration 071) ✅
- Backfill `planned_start` pour TOUTES les rows ✅
- Conflit horaire chevauchement ✅
- Vigilance rouge sur 4 surfaces ✅
- B1/B2 résonances site ↔ documents ✅
- Doctrine 5 piliers + 3 axes gravée ✅

**Risques de migration** :
1. **Coexistence créneaux ↔ heures** : le slot DB reste utilisé (tri, dégradé visuel). Pas un risque — c'est par design.
2. **Données legacy** : interventions avec planned_start = ancrage canonique (07h/14h/19h). `isPlannedStartPrecise` les détecte. Pas de migration de données nécessaire.
3. **Surfaces non encore migrées** : /aujourdhui groupe encore par SLOT_FR (matin/AM/soir). **Item ordre 1** de §E (1h).
4. **Tests doctrine** : tripwire `planned-time-no-rh-aggregation` actif. À étendre avec tripwire « libellé personne dans alerte ».
5. **Dette technique** : 2 tests `reassign-actions.test.ts` échouent (signalé en fin de purge créneau). À investiguer mais pas bloquant.

**Effort de migration restant** : faible (1-2 jours pour cohérence /aujourdhui + propagation residuelles).
**Coût technique réel** : zéro coût supplémentaire IA (pas de nouvelle requête LLM). Tout est déterministe.
**Ordre de migration recommandé** : finir la cohérence /aujourdhui d'abord (item 1 de §E), puis Guillaume avance sans dette résiduelle.

### PARTIE 10 — Synthèse stratégique honnête

**Ce qui est un TRÈS BON signal produit** :
- ✅ Les 5 demandes Guillaume sont alignées avec les 5 piliers — pas de dérive transverse
- ✅ Aucune demande ne casse les refus [[refus-erp-rh-pointage-gps]]
- ✅ G1 (AO) renforce l'AXE 2 (preuve & capitalisation) = le wedge premium
- ✅ G4 site-side renforce l'AXE 1 (mémoire opérationnelle) = l'ADN
- ✅ Vincent garde la discipline doctrinale (pivot page personne avec option B + garde-fous lourds, pas open bar)

**Ce qui est DANGEREUX** :
- ⚠️ G2 (page personne) est la pente glissante. Même en option B avec auto-consultation, le moment où un admin voit la page sans audit pesant, on glisse. **Le tripwire CI + l'audit log ne sont PAS optionnels.**
- ⚠️ G3 (nature contrats) peut devenir un filtre de discrimination déguisé (« n'affecte pas les CDD aux clients premium »). Le wording de l'UI doit être strict : *non-comparatif, sert à l'affectation*, jamais affiché en classement.
- ⚠️ La tentation de remonter G2 en page accessible par manager direct sous pression terrain. Refuser, même si Guillaume insiste.

**Ce qui ferait dériver MemorIA vers un ERP générique** :
- ❌ Coder un module RH même léger (congés, paie, sanctions)
- ❌ Pointage horaire individuel obligatoire au démarrage d'intervention
- ❌ Comparaison inter-personnes (même sous prétexte « top contributor du mois »)
- ❌ Dashboard KPI startup (vélocité, taux de conversion, NPS)
- ❌ Notifications externes nominatives (« Joseph est en retard »)
- ❌ Ouvrir G2 sans pré-conditions §F

**Ce qui constitue le VRAI CŒUR DIFFÉRENCIANT** :
- 🟢 Mémoire des SITES qui survit au turnover (ADN unique du marché)
- 🟢 Preuves terrain réutilisables en AO (wedge commercial)
- 🟢 Doctrine anti-surveillance gravée (frontière techniquement infranchissable par accident)
- 🟢 Résonances « écho juste » (pas vérité, pas score)
- 🟢 5 piliers ultra clairs (Sites, Contrats, Interventions, Équipes-conteneur, Atelier IA)

**Les 3 axes prioritaires à construire MAINTENANT** :
1. **G3 + G4 site-side** (Équipes — Mémoire) — sans ouverture doctrinale lourde, livre une vraie valeur opérationnelle Guillaume en 1,5 jours.
2. **G1 AO surface + Atelier renforcé** (Atelier IA — Preuve) — c'est le wedge commercial. Investir là.
3. **Dashboard exploitation 3 widgets manquants** (Tous — Copilote) — pose les rails du pilotage sobre.

G2 (page personne option B) attend les pré-conditions §F. G5 (cold start) demande une étude dédiée.

**Ce qu'il faut REFUSER même si le client le demande** :
- ❌ Page d'un agent visible par son manager direct (= ouvrir G2 sans option B)
- ❌ Bouton « envoyer un rappel » sur la page d'un agent (= harcèlement déguisé)
- ❌ Notification WhatsApp nominative (« Joseph est en retard ») — cf. briefing pilote 2026-05-13 règle 1
- ❌ Score, ranking, classement de quoi que ce soit qui implique une personne
- ❌ Comparaison inter-personnes (jamais 2 personnes sur le même écran)
- ❌ Predictive : prédire qui va démissionner, qui va être absent, qui va sous-performer
- ❌ « Mode RH simplifié » même payant (= changer d'identité produit)

---

## D-bis. Backlog consolidé « à coder » (avec source)

Toutes les bonnes idées accumulées pendant la session, classées. **Ne rien jeter, ne rien coder sans validation Vincent.**

### Validé AO-1 (en cours — strict 4 livrables)
- [ ] L1 — Bandeau vigilance rouge : alerte si AO à rendre ≤ 7 jours
- [ ] L2 — Widget « Pipeline AO » compact, cliquable vers /tenders
- [ ] L3 — Sources `[doc:id]` cliquables (panneau ou lien)
- [ ] L4 — Capital client encart sur page AO (factuel, sans score)

### Validé Continuité terrain — Tranche 1 (en cours — audit avant code)
- [ ] CT-1 — Page/section « Continuité terrain » (sujet site, pas score)
- [ ] CT-2 — Bloc « Équipe qui connaît ce site » sur page site
- [ ] CT-3 — Aide affectation sobre (« connu par : X, Équipe Y »), pas recommandation forte

### Notées (priorisées) — attendent observation pilote
| # | Idée | Source | Statut |
|---|------|--------|--------|
| 1 | C — Réservoir de preuves intelligent (filtres + regroupement, pas génération) | Vincent ABCDE | priorité 1 post-AO-1 |
| 2 | A — Dossier de relève automatique (« voici ce que ce lieu dit ») | Vincent ABCDE | priorité 2 post-AO-1 |
| 3 | Atelier IA — Agent Contradicteur en encart permanent dashboard | Claude WOW + Vincent valid. | AO-2 |
| 4 | Atelier IA — Agent Terrain auto sur nouvel AO (retrieval déterministe) | Claude WOW | AO-2 |
| 5 | Atelier IA — Mode « Préparation finale » avant submission | Claude WOW | AO-2 |
| 6 | Mémoire vocale du closing (capter intuition DG) | Claude WOW #13 | AO-2 |
| 7 | D — Mémoire de décisions (champ `rationale` infra) | Vincent ABCDE | post-pilote, infra à poser tôt |
| 8 | Pre-flight check avant submission AO (checklist depuis CCTP) | mon ajout | AO-2 candidat |
| 9 | Mémoire d'arguments gagnants inter-AO | mon ajout | AO-3 candidat |
| 10 | Carte « Mémoire précédente » auto-suggérée sur AO entrant | Claude #2 | AO-2 candidat |
| 11 | Diff CCTP sémantique additif/modificatif | Claude #10 | post-pilote |
| 12 | Galerie visuelle preuves (mosaïque photos) | Claude #14 | candidat (redondant si C bien fait) |
| 13 | Bouton « Pass » + raison sur AO entrant | Claude #12 | post-pilote |
| 14 | Bandeau bleu suggestion (cible mémoire matin tenant) | déjà en partie | enrichir éventuellement |

### Notées (long terme, post 12 mois données)
- B — Mémoire temporelle (aggravation/saisonnalité/dérive) — demande historique long
- Cold start / import sources historiques (G5) — bouton admin avec ETA + coût visible
- Page personne option B — requiert pré-conditions §F (manifeste + info employés + accord juridique)
- Timeline site narratif (« histoire opérationnelle du lieu »)

### Dette ingénierie identifiée (à traiter avant nouveaux chantiers majeurs)
- [ ] Tests `reassign-actions.test.ts` — 2 échouent (signalé en fin de purge créneau)

### Discipline transverse à appliquer
- E — Moments mémoire : pour CHAQUE PR future, se demander quand/où/pourquoi/pour qui la mémoire doit apparaître

---

## E. Ordre d'attaque (mis à jour P10)

| Ordre | Item                                                                 | Demande G | Effort | Doctrine |
|-------|----------------------------------------------------------------------|-----------|--------|----------|
| **1** | Purger créneau aussi sur `/aujourdhui` (dette migration P9)          | (cohérence)| S (1h)  | ✅       |
| **2** | **G3** champ `users.employment_type` + filtre d'affectation          | G3        | S (½j)  | 🟡 wording |
| **3** | **G4** section « historique d'affectation » sur page site             | G4        | M (1j)  | 🟢 site-side |
| **4** | **G1** pipeline AO unifié + recall doc plus exposé                   | G1        | M (1j)  | ✅       |
| **5** | **Dashboard P5** 3 widgets manquants (sites sans preuve, heures contrat dépassées, sites anomalies répétées) | (Vincent P5) | M (1j) | ✅ |
| **6** | Mobile P7 — regroupement site quand pertinent                         | (Vincent P7) | S (½j) | ✅       |
| **7** | **G5** spec import historique (cold start) — étude courte d'abord    | G5        | XL      | 🟡 spec  |
| **8** | **G2** page personne option B — pré-conditions §F                    | G2        | L       | 🔴 lourd |
| **9** | **G2** page personne option B — code                                  | G2        | L (3j)  | 🔴 lourd |

**Engagement immédiat** : 1 → 2 → 3 → 4 = **2,5 jours**. Puis 5 → 6 = **1,5 jour**. Puis G5 étude + G2 pré-conditions.

---

## F. Pré-conditions G2 (rappel — non bloquantes pour items 1-6)

Cf. [[page-personne-option-b]] §Garde-fous CI obligatoires :
- [ ] Manifeste doctrinal (5 principes publiés en interne)
- [ ] Information préalable employés (1 page langage clair)
- [ ] Accord juridique (RGPD / droit du travail — consultation rapide)
- [ ] Tripwire CI lexical (libellés interdits : « lent », « bon », adjectifs qualificatifs)
- [ ] Server action 403 si requester.id ≠ target.id ET ≠ admin
- [ ] Audit log `personne_page_consulted` (requester, target, timestamp)

---

## G. Hors-jeu permanent (rappel [[refus-erp-rh-pointage-gps]])

- ❌ Manager direct consulte page personne d'un autre (G2 option B exclut ça)
- ❌ Ranking, classement, comparaison inter-personnes
- ❌ Scoring (« bon agent », « lent », adjectifs qualificatifs)
- ❌ Pointage pur cœur produit
- ❌ GPS, surveillance, productivité
- ❌ Notifications externes nominatives
- ❌ Module RH (congés, paie, sanctions, primes)
- ❌ Predictive employees
