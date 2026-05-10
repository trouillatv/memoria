# Doctrine Planning NetoIAge

> **Document de référence** — toute personne (humain ou subagent IA) qui touche au planning, aux missions, aux interventions, au calendrier ou à l'app agent terrain DOIT lire et appliquer cette doctrine.

**Date de validation** : 2026-05-10
**Statut** : doctrine produit verrouillée
**Portée** : missions, interventions, planning, calendrier, app agent (`/missions`, `/contracts/[id]/missions`, `/contracts/[id]/interventions`, `/m/*`)

---

## La phrase qui résume tout

> **« Le planning sert la preuve, pas la gestion des humains. »**

Si tu hésites face à une décision, reviens à cette phrase. Tout le reste découle.

---

## 1. Les 4 axes immuables

### Axe 1 — Mission-centric, pas human-centric

La boucle de référence est :
**Engagement → Mission (recette) → Intervention (instance) → Preuve.**

L'humain (agent, équipe) est **un attribut de l'intervention**, pas le sujet du système.

❌ Ne **JAMAIS** centrer une vue sur une personne (« le planning de Mehdi », « l'historique de Sofia »).
✅ Centrer sur la mission, le site, l'engagement.

### Axe 2 — Visualisation, pas optimisation

On affiche ce qui existe. On ne propose **JAMAIS** ce qu'il faudrait faire.

❌ Pas d'algorithme de tournée.
❌ Pas de heatmap.
❌ Pas de prédiction.
❌ Pas de suggestion automatique d'affectation.
✅ Liste, calendrier simple, filtres factuels.

### Axe 3 — Statuts opérationnels, pas mesures

4 états seulement pour les interventions :
`planned · in_progress · completed · validated`

**Aucune métrique** de durée, ponctualité, productivité visible.

### Axe 4 — Wording neutre toujours

Aucun mot qui implique un jugement sur la personne. La timeline est descriptive, pas évaluative.

---

## 2. Le test à appliquer à toute nouvelle feature

> **« Est-ce que cette feature aide directement à réaliser ou documenter une mission ? »**

| Réponse | Décision |
|---|---|
| ✅ Oui, directement | Go (ex: vue semaine, drag/drop affectation, template hebdo, duplication mission) |
| ⚠ Indirectement, mais mesure une personne | **Refuser** (ex: temps moyen agent, retard alerté) |
| ❌ Non, c'est de la RH/paie/optimisation | **Refuser net** (ex: pointage, tournée optimisée, calcul heures) |

**Refus par défaut** si la réponse n'est pas un OUI clair.

---

## 3. Glossaire wording — table verbatim

### ❌ Termes BANNIS

| Terme banni | Pourquoi | Remplacement |
|---|---|---|
| Retard | Implique un jugement | Mission non démarrée |
| Performance | KPI factory | Avancement |
| Productivité | Mesure individuelle | Suivi des missions |
| Pointage | Surveillance horaire | Démarrage / Fin (factuel) |
| Surveillance | Big Brother | Vue d'ensemble |
| Suivi agent | Tracking personne | Suivi des missions |
| Score | Notation | (rien — pas de score) |
| Classement | Comparaison | (rien — jamais) |
| Heures travaillées | Domaine paie | Plage de mission (factuel) |
| Tracker | Surveillance | (rien) |
| Temps de trajet | Optimisation tournée | (rien — pas calculé) |
| Productivité moyenne | KPI individuel | (rien) |
| Justification | Connotation négative | « Que s'est-il passé ? » / « Note rapide » |
| Non-conformité | Audit | Écart, à compléter |
| Audit | Big Brother | Revue, validation |

### ✅ Termes AUTORISÉS

| Terme | Quand l'utiliser |
|---|---|
| Mission planifiée / en cours / terminée / validée | États factuels |
| Avancement | % de tâches cochées dans une intervention |
| Mission | Recette opérationnelle |
| Intervention | Instance datée d'une mission |
| Affectation | Lien mission ↔ agent (factuel, non-évaluatif) |
| Couverture | % d'engagements couverts par missions |
| Prochaines missions | Vue future neutre |
| Historique | Vue passée descriptive |
| Note rapide | Champ texte court contextuel |

---

## 4. Demandes clients à refuser ou reformuler

Ces demandes vont arriver pendant les pilotes. **Réponse préparée = NON**, avec une reformulation possible vers un usage compatible.

| Demande probable client | Refus | Reformulation possible |
|---|---|---|
| « On peut pointer l'arrivée des agents ? » | ❌ | Le `started_at` de l'intervention existe déjà (factuel, jamais affiché comme un pointage). Pas d'extension RH. |
| « Voir qui est en retard ce matin ? » | ❌ | Vue « missions non démarrées ». Pas d'humain pointé. Si l'utilisateur veut savoir QUI, il ouvre l'intervention et voit `team[]` — c'est tout. |
| « Calculer les heures hebdo par agent ? » | ❌ | Export CSV des interventions, faites votre paie ailleurs (Skello, PayFit, autre). NetoIAge ne calculera jamais d'heures. |
| « Meilleure tournée pour mes 5 sites ? » | ❌ | Vous restez maître de l'ordre. Pas d'optimisation. |
| « Le planning de Mehdi cette semaine ? » | ❌ | Vue « missions du site X » filtrable. Vue centrée personne refusée. |
| « Notification quand un agent est en retard ? » | ❌ | Pas de notification. Vue dashboard async suffit. |
| « Dashboard RH avec présence/absence » | ❌ | Hors scope. RH = autre marché. |
| « Gérer les congés et absences » | ❌ | Hors scope. Outil RH dédié. |
| « Score de qualité par agent » | ❌ | **JAMAIS**. La qualité se mesure par engagement, pas par personne. |
| « Comparer mes agents entre eux » | ❌ | Refuser fermement. Toxique culturellement. |
| « GPS live des équipes terrain » | ❌ | Big Brother. CNIL/RGPD. Toxique. |
| « Alerte SMS/email si une intervention est en retard » | ❌ | Pas de notif urgente. Digest hebdo OK V1.1. |
| « Tableau croisé dynamique missions × agents » | ❌ | C'est de l'analyse RH déguisée. |

### Comment refuser sans casser la relation client

Toujours :
1. **Reconnaître le problème** sous-jacent (« Je comprends, tu veux savoir si l'équipe est ponctuelle »)
2. **Expliquer la doctrine** (« Notre produit est centré sur la preuve, pas le management individuel »)
3. **Proposer le contournement** (« Voici comment tu peux répondre à ce besoin avec ce qu'on a déjà »)
4. **Refuser fermement** la feature spécifique

Ne **jamais** dire « peut-être plus tard » sur ces demandes-là — c'est non, définitivement.

---

## 5. Données autorisées mais DANGEREUSES

Ces colonnes existent en DB pour la traçabilité de la preuve. Elles **ne doivent JAMAIS** être transformées en score individuel ou dashboard RH.

| Colonne | Pourquoi elle existe | Ce qu'on NE FAIT PAS avec |
|---|---|---|
| `interventions.started_at` | Timestamp de démarrage, factuel, oppose à la preuve | ❌ Pas de calcul de durée moyenne par agent |
| `interventions.executed_at` / `completed_at` | Timestamp de fin | ❌ Pas de classement « plus rapide » / « plus lent » |
| `intervention_photos.taken_at` | Timestamp serveur **opposable**, anti-fraude | ❌ Pas de mesure de fréquence par agent |
| `intervention_photos.taken_by` | Qui a pris la photo | ❌ Pas de score « % photos prises par X » |
| `intervention_checklist_items.done_by` | Qui a coché l'item | ❌ Pas de leaderboard « top tâches accomplies » |
| `intervention_checklist_items.done_at` | Timestamp du check | ❌ Pas de KPI temporel individuel |
| `intervention_validations.validated_by` | Superviseur ayant validé | ❌ Pas de classement validateurs |
| `intervention_anomalies.reported_by` | Agent ayant signalé une anomalie | ❌ Pas de « top reporters » (ferait peur, dissuaderait) |

### Règle ultime

Toute donnée individuelle est **agrégée par engagement, par mission, ou par site** — JAMAIS par personne.

Si une vue ou export commence à exposer un classement / score / metric individualisé, **refuser le merge**.

---

## 6. Featureset planning autorisé vs interdit (référence rapide)

### ✅ AUTORISÉ

- Vue jour/semaine des missions (lecture)
- Interventions planifiées listées chronologiquement
- Affectation simple via `interventions.team[]`
- Statuts : `planned · in_progress · completed · validated · skipped`
- Drag & drop léger pour replanifier (instance)
- Duplication d'une intervention
- Templates hebdomadaires de mission
- Filtres par site, par contrat
- Vue superviseur (read+write sur ses interventions)
- Vue agent (read+write sur ses propres interventions)
- Détection conflit basique (2 missions sur 1 agent en simultané) — **soft warning seulement**
- Export ICS/iCal read-only

### ❌ INTERDIT

- Pointage horaire
- Calcul d'heures travaillées
- Paie, cotisations, fiches de paie
- Temps de trajet
- GPS live, géolocalisation continue
- Optimisation algorithmique de tournée
- KPI productivité agent
- Classements / leaderboards agents
- Heatmaps RH
- Retards agressifs (notifications, alertes rouges)
- Dashboard de performance individuelle
- Gamification (badges, streaks, niveaux)
- Comparaisons inter-agents
- Vue planning « par personne » (vue par site/contrat OK)
- Notifications push « retard »
- Module gestion des congés
- Module gestion des absences

---

## 7. Composants existants — verdict

### ✅ Sains, à préserver

- `/contracts/[id]/missions` — visualisation pure des recettes
- `/contracts/[id]/interventions` — liste « À venir » / « Historique » sobre
- `/missions` (planning cross-contrats) — liste agréable
- `/m` (agent terrain) — liste perso sans mesure
- `/m/intervention/[id]` — checklist + photos + anomalies, jamais de score
- Cockpit Boucle de preuve (par engagement, jamais par personne)
- Dashboard direction (par contrat, jamais par individu)
- `intervention_validations` (validation factuelle, jamais évaluation)

### ⚠ À surveiller

- **`started_at` / `executed_at` / `completed_at`** : très facile de calculer un temps. Tant qu'on **n'EXPOSE PAS** de ratio par personne, c'est OK. Si une PR future commence à afficher « Sofia : durée moyenne 47 min », **refus immédiat**.
- **Notes d'intervention** (« Que s'est-il passé ? ») : champ libre OK car factuel et optionnel. **Ne pas** ajouter de catégorisation type « raison de retard » ou « cause de non-conformité ».

### ❌ Pièges futurs identifiés

Si quelqu'un propose un de ces écrans, **refuser direct** sans débat :

- Vue calendrier multi-agents avec lignes par personne
- Heatmap activité par jour
- Top/Flop missions terminées dans les délais
- Onglet « RH », « Équipes », « Pointage »
- Page agent avec son historique perso visible par admin (≠ son propre historique sur `/m`)
- Tableau Excel croisé agents × jours

---

## 8. Application aux subagents

Quand tu dispatches un subagent qui touche au planning :

### Inclure systématiquement dans le prompt

```
## Doctrine planning à respecter strictement

Lis docs/superpowers/doctrines/planning-doctrine.md avant de coder.

Règle cardinale : « Le planning sert la preuve, pas la gestion des humains. »

Ne JAMAIS implémenter (refuser même si demandé) :
- Pointage horaire
- Calcul d'heures travaillées
- KPI/score/classement par agent
- Notifications retard
- Optimisation tournée
- Vue centrée personne (« planning de X »)

Wording banni : retard, performance, productivité, pointage, surveillance,
score, classement, justification, non-conformité, audit.

Wording préféré : mission non démarrée, avancement, suivi des missions,
historique, couverture, note rapide.

Test à chaque feature : « Aide-t-elle directement à réaliser ou documenter
une mission ? » Si NON, refus par défaut.
```

### Vérification automatique en review

À chaque PR planning, faire ces grep checks :

```bash
grep -rin "retard\|productivité\|pointage\|score.*agent\|classement" \
  app/\(dashboard\)/missions/ \
  app/\(dashboard\)/contracts/ \
  app/\(field\)/ \
  | grep -v node_modules
```

Toute occurrence dans du code utilisateur-facing → **refus** ou refacto wording.

---

## 9. Évolution future planning

### Phase 4 planning hypothétique — règle de déclenchement

**Phase 4 ne sera lancée QUE si un pilote terrain réel montre une friction claire** sur la planification actuelle.

Pas d'anticipation. Pas de Google Calendar-like construit pour le plaisir. Pas de calendrier sophistiqué « parce que ça serait cool ».

> ⚠ **Avertissement** : la liste ci-dessous N'EST PAS une roadmap. C'est un **cap de scope** — les seules choses tolérables si la décision Phase 4 est un jour prise. Tout ce qui n'est pas dans la liste « inclus possible » ou est dans la liste « exclus définitivement » DOIT être refusé.

### Phase 4 hypothétique — version saine

**Goal** : améliorer la création et la lecture du planning, sans rien ajouter de RH-like.

#### ✅ Inclus possible (si demandé par 3+ pilotes terrain)

- Vue semaine type Google Calendar (mais en lecture, pas slot-by-slot)
- Templates hebdomadaires (« lundi-vendredi 8h-10h, équipe par défaut »)
- Duplication d'intervention (« mêmes paramètres demain »)
- Détection conflit basique (2 missions sur 1 agent en simultané) — soft warning seulement
- Filtre par site dans `/missions`
- Export ICS/iCal (read-only, pour intégration agendas externes)

#### ❌ Exclus définitivement, même en V5+

- Tout dashboard avec ratios par personne
- Tout suivi temps réel d'arrivée/départ
- Tout calcul d'heures cumulées
- Toute optimisation de tournée
- Toute notification « retard »
- Toute vue « qui fait quoi maintenant »
- Toute gestion d'absences/congés/plannings RH

---

## 10. Maxim 8 — ajout à la doctrine produit globale

Cette doctrine planning ajoute la **8e maxim** à la doctrine produit globale (les 7 maxims initiaux sont dans `engagement-cockpit-design.md` §10).

> **Maxim 8 :** Le planning sert la preuve, pas la gestion des humains. Toute donnée individuelle est agrégée par engagement, mission ou site — JAMAIS par personne.

---

## 11. Sanity check actuel (audit du repo au 2026-05-10)

| Élément | Verdict |
|---|---|
| `interventions.team` (uuid[]) | ✅ Sain — affectation factuelle |
| `intervention_validations.validated_by` | ✅ Sain — historique de qui valide |
| `intervention_photos.taken_by` | ✅ Sain — propriété de la preuve |
| `intervention_checklist_items.done_by` | ✅ Sain — qui a coché |
| `started_at` / `executed_at` / `completed_at` | ⚠ À surveiller — pas exposé en métrique individuelle aujourd'hui, ne JAMAIS le faire |
| Indicateur sync vert/jaune/rouge mobile | ✅ Sain — état de la photo, pas de l'humain |
| Cockpit Boucle de preuve | ✅ Sain — par engagement |
| Dashboard direction | ✅ Sain — par contrat |
| Vues `/missions`, `/contracts/[id]/*`, `/m/*` | ✅ Toutes saines |

**Aucune dérive détectée au 2026-05-10.** Le produit est aligné.

---

## 12. Maintenance de cette doctrine

- Toute modification de cette doctrine doit faire l'objet d'un commit dédié avec message commençant par `doctrine(planning):`
- En cas de pression client pour ajouter une feature interdite, **mettre à jour la section "Demandes à refuser"** plutôt que d'assouplir la doctrine
- Cette doctrine est **immutable** sur ses 4 axes principaux. Le glossaire et la liste de demandes peuvent évoluer.

---

**Validation** : doctrine validée par l'utilisateur le 2026-05-10. Verrouillée.
