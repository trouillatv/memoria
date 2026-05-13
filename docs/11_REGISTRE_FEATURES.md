# Registre des features — sprints, reports, refus

Ce document trace toutes les features envisagées : ce qui est en cours, ce qui est reporté, ce qui est explicitement refusé. Il sert de référence anti-dérive : avant de coder une feature qui ressemble à un refus listé ici, relire la justification.

Source principale : audits board (5 rôles + 5 techniques) du 13-14 mai 2026.

---

## ✅ Sprints livrés

| Phase | Date | Contenu | Référence journal |
|---|---|---|---|
| **Sprint 0 — Sécurité urgence** | 2026-05-13 | Middleware must_change_password, RLS access codes, fallback mdp | `10_JOURNAL_DECISIONS.md` |
| **Phase 1 — Substrat de preuve** | 2026-05-14 | Hash SHA-256 photos, freeze PDF dossier intervention, audit trail atomique | Commit `f3c0a28` |
| **Phase 2 — Recherche mémoire** | 2026-05-14 | FTS tsvector, RPC search_memory, overlay ⌘K | Commit `cac83bb` |
| **Phase 3 — Mémoire du lieu** | 2026-05-14 | Extension site_notes (kind + active_until), vue `/sites/[id]`, ASavoirManager | Commit `79bea49` |
| **Phase 4 — Continuité contractuelle** | 2026-05-14 | proof_requirement, RPC contract_summaries enrichi, DossierConfidenceBadge | Commit `8aa42d4` |

---

## 🔥 Sprint A — Bugs critiques post-audits (en attente d'arbitrage pilote/code)

Issus des 5 tests-rôles + 4 audits techniques. **Doctrine-aligned** : renforcent la mémoire et la défendabilité, ne créent aucune surveillance.

| # | Fix | Source(s) | Effort |
|---|---|---|---|
| A1 | Photo rattachable à anomalie existante (FK + UI mobile) | Joseph (chef d'équipe), Product | 2-3h |
| A2 | proof_requirement saisissable dans EditForm engagement | Product, Avocat | 1h |
| A3 | Wizard `/litige` scope par contrat (pas seulement site) | DG, Avocat | 3-4h |
| A4 | Freeze PDF litige multi-interventions | Avocat, Juriste | 4-6h |
| A5 | Mobile `À savoir` : filtre kind='a_savoir' + active_until | Joseph, Product | 15min |
| A6 | Anomalies +3 jours visibles dans le briefing du soir (pas push) | DG, Manager — mode calme | 1h |
| A7 | Tooltip explicatif `DossierConfidenceBadge` | Product | 1-2h |

**Critère d'arrêt** : si une fix dépasse 4h, stop et arbitrage.

---

## ⏸️ Reportées (post-pilote réel)

Features valables, doctrine-aligned, mais qui ne doivent pas être codées avant un retour terrain réel. Risque sinon : construire pour un usage imaginé.

| Feature | Décision | Source | Quand reconsidérer |
|---|---|---|---|
| **Mode prise de poste** (vue site condensée pour nouveau chef) | Reportée | Stratégique 2026-05-14 | Après 1er retour terrain réel d'un remplacement de chef |
| **Patterns récurrents** (« humidité signalée 3× depuis février ») | Reportée | Stratégique 2026-05-14 | Après 6 mois de mémoire accumulée — sinon pas de signal statistique |
| **Transmission silencieuse à l'archivage user** | Reportée | Stratégique 2026-05-14 | Au premier vrai départ d'un chef d'équipe sur le pilote |
| **Voix sur À savoir + anomalies** | Reportée | Stratégique 2026-05-14 | Après retour pilote — si la friction texte est confirmée terrain |

**Note** : aucune de ces features n'a été conçue pour le moment. Ne pas commencer le développement avant retour d'expérience.

---

## ❌ Refusées (anti-doctrine — ne PAS coder)

Ces features ont été identifiées par les audits comme « manques apparents », mais elles sont **refusées définitivement** car elles ramènent le produit vers un ERP propreté classique (Progiclean / PROPRET). Si quelqu'un propose à nouveau l'une d'elles, relire la justification ci-dessous avant d'arbitrer.

### Notifications & alertes anxiogènes
- ❌ **Push notifications temps réel sur anomalies critiques**
  - *Pourquoi le refus* : Verrou V6 (attention minimale). Une anomalie remontée par un chef d'équipe doit apparaître dans le briefing du soir, pas interrompre la journée du manager. Si vraiment urgente, l'agent appelle son manager — c'est le bon canal humain. NetoIAge n'est pas un système d'alerte.
  - *Demandé par* : Manager (Maëva), DG (NetoNC)
  - *Alternative doctrine-aligned* : briefing du soir + dashboard quand on l'ouvre.

- ❌ **Tri par criticité avec champ `severity` sur anomalies**
  - *Pourquoi le refus* : créer un champ « gravité » obligerait l'agent à juger sur le terrain, et le manager à priorité-quer en réaction. Glissement vers ticketing. Le tri chronologique suffit.
  - *Demandé par* : Manager
  - *Alternative* : aucune. Garder le tri chronologique.

- ❌ **Score d'urgence calculé** sur intervention/anomalie/contrat
  - *Pourquoi le refus* : tout score est une note. Une note appelle une comparaison. La comparaison appelle la surveillance. Ligne rouge doctrine V5.
  - *Demandé par* : implicitement par Manager (« je ne sais pas par quoi commencer »)
  - *Alternative* : indicateur « Confiance du dossier » existant (3 niveaux qualitatifs, jamais un %).

### Mécaniques ERP classiques
- ❌ **Auto-distribution du planning** (algorithme qui assigne automatiquement les chefs aux interventions)
  - *Pourquoi le refus* : on n'optimise pas les humains. Le manager affecte par équipe à la main. C'est volontaire et structurel.
  - *Demandé par* : Manager (« le matin je drag chaque carte une par une »)
  - *Alternative* : drag-and-drop manuel reste la norme. Acceptable. Ajouter éventuellement un raccourci « copier semaine précédente » (non urgent).

- ❌ **Module ticketing client** (statuts workflow, SLA, assignations)
  - *Pourquoi le refus* : c'est Progiclean. Une réclamation client devient une note dans le rapport mensuel, pas un ticket avec statut.
  - *Demandé par* : Sylvie (cliente)
  - *Alternative* : note libre dans le rapport mensuel + lien explicite vers les anomalies de la période concernée.

### Surveillance déguisée
- ❌ **Portail extranet client** (compte client persistant avec login, historique multi-contrats, dashboard)
  - *Pourquoi le refus* : ce n'est pas notre métier. Une fois le portail créé, le client attend un service de support en ligne, des SLA, etc. Le lien magique pré-signé suffit pour son besoin réel (recevoir des preuves quand il le demande).
  - *Demandé par* : Sylvie (cliente)
  - *Alternative* : lien magique semestriel envoyable par le DG (à étudier post-pilote uniquement).

- ❌ **Email auto multi-destinataires** (envoyer le rapport mensuel à 8 clients en 1 clic, ou aux 3 chefs d'équipe en cascade)
  - *Pourquoi le refus* : Maxim 9 — communication 1-à-1, jamais broadcast. Le DG signe ce qui sort vers le client. Un envoi multi automatique = l'appli parle à la place du DG.
  - *Demandé par* : Manager (Maëva), DG
  - *Alternative acceptable* : `mailto:` pré-rempli (1 par destinataire), l'utilisateur orchestre.

- ❌ **Suivi de qui a lu quoi** (visible pour le manager, le DG, ou les chefs)
  - *Pourquoi le refus* : tracking de lecture = surveillance. Doctrine V5 absolue.
  - *Note* : `share_access_log` capture l'IP/UA des accès clients aux preuves partagées (utile en litige juridique, jamais surfacé en UI dashboard). C'est différent du suivi de lecture des collaborateurs internes, qui est refusé.
  - *Demandé par* : implicitement par Sylvie (« qui dans mon équipe a déjà lu ça ? »)
  - *Alternative* : aucune visualisation côté manager.

---

## 📐 Critère de discipline produit

Avant de coder une feature qui ressemble à un de ces refus, appliquer la grille :

1. **La feature mesure-t-elle des humains ?** Si oui → refus absolu.
2. **La feature gère-t-elle l'opération** (planning, facturation, stock) ? Si oui → refus.
3. **La feature ajoute-t-elle une demande d'attention non sollicitée ?** Si oui → refus (verrou V6).
4. **La feature nourrit-elle la mémoire défendable des lieux et des engagements ?** Si non → refus indirect.
5. **La feature crée-t-elle une saisie terrain supplémentaire ?** Si oui → justification très lourde requise.

Toute feature qui passe les 5 filtres est candidate au sprint suivant.

---

## 🔄 Procédure d'ajout au registre

Quand une feature nouvelle est proposée (par un audit, un utilisateur, une intuition) :
1. La placer **temporairement** dans « Reportées » avec la date de proposition et la source.
2. À l'arbitrage stratégique suivant, la passer en « Sprint en cours » ou « Refusées » avec justification.
3. Ne **jamais** coder une feature qui n'est pas explicitement listée en « Sprint en cours ».

Ce registre est la mémoire institutionnelle qui empêche la dérive ERP au fil du temps.
