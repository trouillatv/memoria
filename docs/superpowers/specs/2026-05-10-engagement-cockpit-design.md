# Cockpit Engagement — Design philosophy & visualisation signature

**Date :** 2026-05-10
**Statut :** Design validé — complète et corrige le spec principal `2026-05-10-engagement-loop-design.md`
**Posture :** Senior Product Designer / UX Architect + Director of Operations
**Scope :** Lifecycle exact, modèle de compliance, visualisation cockpit, anti-bureaucratisation

---

## 0. Pourquoi ce sous-spec existe

Le spec principal a posé l'architecture de la boucle Engagement. Mais après revue produit, **trois zones critiques restent sous-spécifiées** :

1. La distinction entre **état contractuel** d'un engagement (lifecycle) et **santé opérationnelle** (compliance)
2. La visualisation cockpit qui doit devenir **signature produit**, pas tableau ERP
3. Le risque de **bureaucratisation progressive** — MemorIA doit rester un *outil de preuve*, pas un *outil de contrôle*

Ce document corrige et complète le spec principal sur ces 3 axes.

---

## 1. La séparation State / Health — correction du spec principal

### Le problème dans le spec principal

Le spec original mélangeait deux concepts dans le même champ `status` :

```
status = 'extracted' | 'curated' | 'active' | 'completed' | 'breached' | 'archived'
```

`breached` n'a rien à faire ici. Ce n'est pas un état contractuel, c'est un **jugement de qualité**. Cette confusion a 3 conséquences toxiques :

1. Un engagement temporairement « en difficulté » devient marqué « breached » de manière permanente
2. Le mot a une connotation juridique anxiogène que le client/superviseur perçoit comme une menace
3. La donnée d'état est polluée — impossible de filtrer par « contrats actifs » sans inclure les « breached »

### La correction architecturale

**Deux dimensions indépendantes** :

#### A. Lifecycle (état contractuel) — *sticky, slow-moving, formel*

```
extracted → curated → active → ┬─→ completed   (succès, contrat terminé OK)
                               ├─→ archived    (remplacé / déprécié / AO amendé)
                               └─ (resté actif jusqu'à fin du contrat)
```

**4 états finaux** :
- `extracted` : IA a proposé, AO non encore gagné
- `curated` : humain a validé, AO non encore gagné
- `active` : opérationnel pendant la durée du contrat
- `completed` : contrat terminé sans incident bloquant
- `archived` : remplacé/déprécié pendant ou après contrat

**Pas de `breached`. Jamais.** Un engagement n'est pas un défendeur dans un tribunal.

#### B. Health (santé opérationnelle) — *dynamic, daily, qualitatif*

Calculé en temps réel depuis les 5 dimensions de compliance, **non stocké en DB**.

```
health = computed_function(promis, planifie, execute, prouve, valide, recent_anomalies)
       → 'green'   (≥ 90% sur tous les axes, pas d'anomalie récente)
       → 'amber'   (70-90% sur ≥ 1 axe, ou 1-2 anomalies récentes)
       → 'red'     (< 70% sur ≥ 1 axe, ou 3+ anomalies récentes)
       → 'unknown' (< 4 semaines de données, pas assez pour juger)
```

> **Règle d'or** : la `health` n'est jamais persistée en DB. Elle est calculée à la demande à partir des aggregates des 5 ratios + récence des anomalies. Une journée meilleure rétablit le green. Aucun stigma.

### Schéma DB révisé

```
engagements
─────────────────────────────────────
  status text
    CHECK status IN ('extracted', 'curated', 'active', 'completed', 'archived')
    -- 'breached' RETIRÉ de l'enum
  -- pas de colonne 'health' (calculé view-side)
```

### Tracking des écarts (sans punir)

Si on veut tracer l'historique des moments difficiles, on le fait via une table d'événements :

```
engagement_events    (NEW, optionnel V1.2)
─────────────────────────────────────
  id, engagement_id, event_type, severity, detected_at, resolved_at?
  event_type: 'low_proof_rate' | 'missing_validation' | 'recurring_anomaly'
  severity: 'info' | 'attention' | 'critical'
```

Ces événements sont **résolvables** — ce n'est pas un casier judiciaire. Quand l'engagement revient au vert, l'événement passe en `resolved`.

### Pourquoi cette séparation est cruciale

| Mélange (mauvais) | Séparation (bon) |
|---|---|
| « Cet engagement est breached » (permanent) | « Cet engagement est actif, en santé amber cette semaine » (temporaire) |
| Un PB ponctuel marque l'engagement à vie | Le PB est un événement, l'engagement reste neutre |
| Le superviseur a peur de signaler | Le superviseur signale sans drame |
| L'utilisateur juridique panique | L'utilisateur opérationnel agit |

---

## 2. Le modèle de Compliance Health — vocabulaire et seuils

### Les 5 dimensions (rappel)

```
PROMIS  →  PLANIFIÉ  →  EXÉCUTÉ  →  PROUVÉ  →  VALIDÉ
```

Chaque dimension produit un ratio entre 0 et 1.

### Calcul de health (proposition concrète)

```
def compute_health(p, pl, e, pv, v, recent_anomalies, weeks_of_data):
    if weeks_of_data < 4:
        return 'unknown'
    
    min_ratio = min(p, pl, e, pv, v)
    
    if recent_anomalies >= 3 or min_ratio < 0.70:
        return 'red'
    if recent_anomalies >= 1 or min_ratio < 0.90:
        return 'amber'
    return 'green'
```

### Wording adapté à chaque état

| Health | Mot UI | Couleur | Connotation |
|---|---|---|---|
| `green` | « En bonne progression » | sage / sky / emerald subtil | sécurisant, positif |
| `amber` | « Demande attention » | amber / warm | informatif, pas alarmant |
| `red` | « À reprendre » | rose / soft red | urgent mais pas accusateur |
| `unknown` | « En cours de mesure » | slate neutre | patient, pas sceptique |

> **Règle anti-bureaucratique** : aucun chiffre rouge sans accompagnement textuel. Toujours « 76% — 14 traces manquantes » plutôt que « 76% NON-CONFORME ».

### Vocabulaire produit — la liste à respecter

#### ❌ Mots à BANNIR (vocabulaire ERP/audit)

| Mot toxique | Pourquoi |
|---|---|
| « Conforme / Non-conforme » | ISO 9001 vibe, anxiogène |
| « Manquement » | Reproche implicite |
| « Violation » / « Breach » | Juridique, hostile |
| « Audit failed » | Punitif |
| « Performance » | KPI factory |
| « Score » utilisé seul | Jugement sec |
| « Pénalité » | Contractuel agressif |
| « Défaut » | Connotation mécanique négative |
| « Surveillance » / « Monitoring » | Big Brother |

#### ✅ Mots à PRÉFÉRER (vocabulaire cockpit)

| ❌ Avant | ✅ Après |
|---|---|
| « Compliance: 76% » | « Progression : 76% » ou « 14 traces manquantes » |
| « Non-conforme » | « Demande attention » |
| « Violation détectée » | « Écart relevé » |
| « Audit raté » | « Élément non documenté » |
| « En attente de validation » | « Validation à venir » |
| « Breach event » | « Période de tension »  |
| « Performance baisse » | « Tendance sur 4 semaines » |
| « Surveillance terrain » | « Vue terrain » |
| « Score qualité » | « Capital qualité » (cumulatif positif) |
| « Engagement breached » | « Engagement à reprendre cette semaine » |

> **La règle qui résume tout** : *« Préfère un verbe d'action, évite un adjectif de jugement. »*

---

## 3. La visualisation signature — la « Boucle de preuve »

### L'objectif produit

Créer **un visuel reconnaissable instantanément** qui devient la signature de MemorIA. Comme :
- Stripe → la facture pointillée
- Linear → l'issue ID format
- Apple Health → les anneaux concentriques

MemorIA → **la Boucle de preuve à 5 segments**.

### Anatomie visuelle

#### Format compact (multi-contrat, dashboard direction)

```
●━━●━━●━━◐━━●     ← 5 dots reliés, le 4ème (PROUVÉ) à moitié
                    indique : « tout va bien sauf les preuves »
```

Lecture instantanée. Pas de chiffres, juste la forme. Si tu vois `●━━●━━●━━●━━●` → tout va bien. Si tu vois `●━━●━━○━━○━━●` → quelque chose dérape sur l'exécution.

#### Format détaillé (vue contrat ou engagement)

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   PROMIS    PLANIFIÉ    EXÉCUTÉ    PROUVÉ    VALIDÉ              │
│     ●━━━━━━━━●━━━━━━━━●━━━━━━━━◑━━━━━━━━●                       │
│    100%     100%      100%      76%      100%                    │
│                                  ↑                               │
│                         13 traces manquantes                     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Le segment endommagé est entre PROUVÉ et son adjacent. La phrase explicative apparaît sous l'élément faible. Pas de message d'erreur générique. **L'œil est guidé directement vers l'action utile.**

### Principes graphiques

| Principe | Détail |
|---|---|
| **5 nœuds reliés** | Suggère une chaîne, une boucle. La métaphore visuelle = chaque maillon dépend du précédent |
| **Remplissage progressif** | Chaque nœud est plus ou moins « rempli » selon son ratio (0%-100%). Pas un tableau de chiffres |
| **Couleur par segment** (V1.2 polish) | PROMIS = sage / PLANIFIÉ = sky / EXÉCUTÉ = indigo / PROUVÉ = amber léger / VALIDÉ = emerald subtil |
| **Trait de liaison** | Continu si tout va bien, en pointillés si rupture entre deux nœuds |
| **Pas de couleur agressive** | Pas de rouge éclatant, pas de vert pomme. Tonalité musée moderne. |
| **Animation subtile** | Au chargement, les nœuds se remplissent en cascade (300-500ms total). Pas spectaculaire, élégant. |

### Règles de monochromie / accentuation

- **Vue d'ensemble** (multi-contrat) → palette en niveaux de gris + 1 accent par état problématique
- **Vue détail** (un engagement) → palette colorée par segment, accent renforcé sur le maillon faible
- **Rapport client** → impression-friendly (pas de gradient, pas de transparence — sinon le PDF est moche)

### Variations selon le contexte

#### 1. Capsule dashboard direction (compact)

```
CHU Toulouse  ●●●●●  4.7/5
École JJ      ●●●●●  4.5/5
Banque        ●●●◐●  4.2/5  ← maillon faible visible
Médiathèque   ●●○○○  3.8/5  ← clairement en difficulté
```

#### 2. Carte engagement (medium)

```
┌─────────────────────────────────────────┐
│ Sanitaires 2x/jour avec écolabel        │
│                                         │
│ ●━━━━━●━━━━━●━━━━━◑━━━━━●               │
│ 100%  100%  100%   76%  100%            │
│                                         │
│ → 13 traces photos manquantes           │
│ [Voir interventions concernées →]       │
└─────────────────────────────────────────┘
```

#### 3. Vue détaillée (full breakdown)

```
┌───────────────────────────────────────────────────────────────┐
│ Sanitaires 2x/jour avec écolabel                              │
│ Source : Mémoire technique §3.2 · Catégorie : frequency       │
│                                                               │
│  ●━━━━━━━━━━━━━●━━━━━━━━━━━━━●━━━━━━━━━━━━━◑━━━━━━━━━━━━━●   │
│                                                               │
│  PROMIS         PLANIFIÉ       EXÉCUTÉ       PROUVÉ      VAL  │
│  100%           100%           100%          76%         100% │
│                                                               │
│  Engagement     12 sites       106/106       93/106     93/93 │
│  actif sur      couverts       interventions photos    valid. │
│  ce contrat     par missions   réalisées     prises    sup.   │
│                                                               │
│  Tout est au vert sauf les preuves photos :                   │
│  → 13 interventions terminées sans photo joint.               │
│                                                               │
│  [Voir 13 interventions sans preuve →]                        │
└───────────────────────────────────────────────────────────────┘
```

### Comment ça devient signature produit

- Utilisé **partout** dans MemorIA : dashboard, page contrat, page engagement, rapport mensuel, démo, marketing
- Apparaît dans les **emails** de récap hebdo
- Est le **logo silencieux** : si quelqu'un voit cette boucle quelque part, il pense MemorIA
- En 12 mois, c'est aussi reconnaissable que les anneaux Apple Health

---

## 4. Architecture de drilldown — strict 3 niveaux max

### La règle d'or

> Au-delà de 3 niveaux de drilldown, tu construis un ERP. MemorIA doit s'arrêter à 3.

### Les 3 niveaux

```
LEVEL 1 — Direction (multi-contrats)
  Question : « Quels contrats demandent mon attention ? »
  Affichage : liste de contrats avec capsule cockpit + note + alertes
  Drill-down : click sur un contrat → Level 2

LEVEL 2 — Contrat (un seul contrat)
  Question : « Quels engagements sont faibles dans ce contrat ? »
  Affichage : liste d'engagements avec capsule cockpit + 1 ligne contexte
  Drill-down : click sur un engagement → Level 3

LEVEL 3 — Engagement (un seul engagement)
  Question : « Quel maillon casse, et comment je le répare ? »
  Affichage : visualisation full + liste interventions concernées
  Drill-down : ARRÊT. Pour aller plus loin → vues spécialisées (gallery photos, anomalies)
```

### Ce qu'on REJETTE explicitement

- ❌ Level 4 « Détail audit log par engagement » (= ERP)
- ❌ Per-agent breakdown (« Mehdi performe 23% sous la moyenne ») — refusé psychologiquement (cf. §6)
- ❌ Heatmap calendrier d'activité par superviseur
- ❌ Comparatif historique multi-périodes complexe (« compliance Q3 vs Q4 vs Q1 »)
- ❌ Drilldown jusqu'à la photo individuelle depuis le dashboard direction
- ❌ Time-series infinie pour chaque dimension

Si l'utilisateur veut creuser plus loin, il **change de vue** (rapports, gallery, anomalies). Pas de creusement infini dans la même nav.

### Architecture navigation détaillée

```
[Dashboard direction] ─────────────► /dashboard
   │
   │ click contract row
   ▼
[Page contrat] ───────────────────── /contracts/[id]
   ├── Vue d'ensemble (engagements + cockpit)
   ├── Onglet Sites
   ├── Onglet Missions
   ├── Onglet Interventions
   └── Onglet Rapports
   │
   │ click engagement
   ▼
[Détail engagement] ──────────────── /contracts/[id]/engagements/[id]
   ├── Visualisation cockpit full
   ├── Liste interventions concernées
   └── Liens vers vues spécialisées
        │
        ├─→ /contracts/[id]/photos?engagement=xxx (gallery)
        ├─→ /contracts/[id]/anomalies?engagement=xxx (incidents)
        └─→ /contracts/[id]/interventions/[id] (intervention spécifique)
```

> **Le saut Level 3 → vues spécialisées** est délibéré. Il évite l'effet « j'me perds dans des sous-menus de sous-menus ».

---

## 5. Anti-bureaucratisation — les 12 anti-patterns à bannir

### Le risque psychologique réel

Le superviseur est l'utilisateur le plus fragile. Si MemorIA l'angoisse, il sabote la donnée. S'il sabote la donnée, le moat s'écroule. **Toute la stratégie produit dépend de son vécu psychologique.**

### Les 12 anti-patterns interdits

#### Anti-pattern #1 — Le compteur de honte
❌ « Vous avez 47 éléments en attente de votre validation »
❌ « 23 anomalies non traitées »

Le compteur permanent crée une **dette psychologique** qui ne va jamais à zéro. Le superviseur se sent débordé.

✅ **Préférer** : « 3 validations à votre rythme cette semaine » ou pas de compteur du tout, juste une liste consultable on-demand.

#### Anti-pattern #2 — Le mail quotidien de récap
❌ Email « Votre rapport quotidien — 12 anomalies, 4 retards, 18% sous-performance »

Le mail quotidien crée un cycle d'anxiété matinal. Le superviseur ouvre l'app par peur, pas par valeur.

✅ **Préférer** : récap **hebdomadaire** (vendredi soir) avec tonalité positive (« Cette semaine : 247 interventions réalisées, 412 photos preuves accumulées, capital qualité +12% »). Daily digests bannis.

#### Anti-pattern #3 — Workflows d'approbation bloquants
❌ « Cette intervention nécessite une justification avant validation »
❌ « Le superviseur doit fournir une raison pour cette anomalie »

Les formulaires obligatoires forcent la rédaction défensive. Personne n'est honnête quand il sait qu'il sera audité.

✅ **Préférer** : commentaires **toujours optionnels**. Le superviseur ajoute du contexte s'il veut. Sinon, action enregistrée sans frottement.

#### Anti-pattern #4 — Le ranking entre superviseurs
❌ « Top performers ce mois : Sofia (+12%), Mehdi (-3%) »

Le ranking active la peur, pas la motivation. Toxique sur le long terme.

✅ **Préférer** : seulement des **agrégats équipe**, jamais d'individu. Si métriques individuelles : personnelles, privées, accessibles uniquement par soi-même.

#### Anti-pattern #5 — La gamification toxique
❌ Badges « Champion qualité du mois », streaks, points, compétitions

Gamification = surveillance déguisée. Sentiment d'être un employé jugé, pas un professionnel respecté.

✅ **Préférer** : reconnaissance **factuelle** (« 18 mois d'exécution sans incident sur ce contrat ») sans pseudo-trophées.

#### Anti-pattern #6 — Le rouge agressif partout
❌ Dashboard avec 15 indicateurs rouges clignotants

Le rouge omniprésent désensibilise. Tout devient urgent → rien n'est urgent.

✅ **Préférer** : neutralité par défaut. Rouge **rare et significatif** (réservé aux écarts > 70%). Amber pour 70-90%. Reste = neutre.

#### Anti-pattern #7 — Le langage juridique
❌ « Violation de l'engagement contractuel détectée »
❌ « Manquement constaté »
❌ « Non-conformité réglementaire »

Le vocabulaire juridique active le mode défensif. Personne ne signale honnêtement quand il sait que ça créera un dossier.

✅ **Préférer** : vocabulaire opérationnel neutre. « Trace manquante », « Élément à compléter », « Période de tension ». La même information, sans charge émotionnelle.

#### Anti-pattern #8 — La traçabilité accusatoire
❌ « Cette photo a été prise par Mehdi à 8h47, en retard de 47 min sur le planning »

La traçabilité fine est utile pour la preuve, **toxique** quand elle pointe l'individu.

✅ **Préférer** : traçabilité agrégée (qui, quand) accessible si besoin pour audit, **jamais surfacée par défaut** dans les vues opérationnelles.

#### Anti-pattern #9 — La notification de breach en temps réel
❌ Push notification « Engagement Sanitaires : breach detected »

Notifications urgentes asynchrones = stress non négociable. Le superviseur lit en transport, panique, ne peut rien faire.

✅ **Préférer** : digest **hebdo asynchrone**. Si vraiment critique : email avec lien direct vers l'action utile, jamais alerte vibrate.

#### Anti-pattern #10 — Le formulaire d'explication forcé
❌ Modal bloquant « Pourquoi cet audit a-t-il été manqué ? Champs obligatoires : raison, action corrective, ETA résolution »

Forcer l'écriture sous contrainte = écriture mensongère. Pas de valeur réelle.

✅ **Préférer** : un champ commentaire optionnel sur l'engagement. Si renseigné → utile. Si vide → pas de jugement.

#### Anti-pattern #11 — Le score de performance déguisé
❌ « Score qualité opérateur : 4.2/5 — sous le seuil contractuel »

Tout score sur une personne = surveillance. Toxique pour la culture interne.

✅ **Préférer** : score sur **un site, un contrat, ou un engagement**. Jamais sur une personne. Le score qualité est une mesure du système, pas de l'individu.

#### Anti-pattern #12 — Le drill-down jusqu'à l'individu
❌ Naviguer du dashboard direction → contrat → engagement → intervention → agent → historique de cet agent

Le sentier ouvert vers l'individu = surveillance par défaut.

✅ **Préférer** : drill-down s'arrête à l'engagement (Level 3). Pour atteindre l'individu, il faut **changer de mode** (mode « audit » explicite, accessible seulement par direction, traçable).

---

## 6. Les 6 sensations produit recherchées

Ce que le superviseur doit ressentir en utilisant MemorIA :

### S1 — Sécurité contractuelle
*« Je sais où on est sur chaque promesse. Je peux prouver. »*

Pas de mauvaise surprise client. Tout est tracé proprement. Pas d'angoisse de réunion contractuelle.

### S2 — Visibilité sans surcharge
*« Je vois en un coup d'œil ce qui demande attention. Le reste s'efface. »*

Affordance par contraste. Le calme par défaut, l'attention rare et signifiante.

### S3 — Empowerment, pas surveillance
*« L'outil m'aide à mieux faire mon job. Il ne me note pas. »*

L'utilisateur est sujet, pas objet. Il pilote, il ne subit pas.

### S4 — Capitalisation tangible
*« Mon travail s'accumule en quelque chose de visible. »*

Compteur « 247 preuves accumulées sur 12 mois » remplace les classiques « X tâches faites ce mois ».

### S5 — Fluidité terrain
*« L'agent est invisible dans les statistiques. Pas de pression latente sur lui. »*

Le terrain ne sent pas le poids du système ops. Photos prises = job fait. Pas plus.

### S6 — Fierté professionnelle
*« Le rapport mensuel client est beau. Je le montre avec plaisir. »*

Le livrable est **un objet de fierté**, pas un acte administratif. Le superviseur l'envoie au client en sachant que c'est valorisant pour la société de nettoyage.

---

## 7. Les 4 références produit à imiter (et celles à éviter)

### À IMITER

| Référence | Ce qu'on emprunte |
|---|---|
| **Linear** | Hiérarchie informationnelle, calme par défaut, action ciblée |
| **Stripe Dashboard** | Design qui inspire confiance par sa simplicité, typographie élégante |
| **Notion** | Information par cards, pas par tables ; respiration entre éléments |
| **Apple Health** | Visualisations narratives (anneaux, segments) plutôt que chiffres bruts |

### À ÉVITER ABSOLUMENT

| Anti-référence | Ce qu'il faut fuir |
|---|---|
| **SAP / Oracle EBS** | Densité froide, listes infinies, formulaires labyrinthe |
| **ServiceNow** | Workflows opaques, processus sans visibilité métier |
| **Salesforce classic** | Onglets imbriqués, vocabulaire commercial agressif |
| **Tout ERP des années 2010** | Compliance-as-anxiety, audit-everywhere |

---

## 8. Test ultime : la phrase du superviseur

Pour évaluer si une feature respecte la philosophie cockpit, je propose **la phrase-test** :

> Si un superviseur, après avoir utilisé cette feature, dit l'une de ces phrases :
> - « J'ai l'impression d'être surveillé »
> - « Je passe mon temps à justifier »
> - « C'est fastidieux »
> - « Ça me stresse »
>
> Alors la feature est cassée — réfléchir à nouveau.
>
> En revanche s'il dit :
> - « Je vois clairement où on en est »
> - « Je peux prouver ce qu'on a fait »
> - « Le rapport client est généré tout seul »
> - « C'est un soulagement »
>
> Alors la feature est juste — passer en review code.

**Cette phrase doit figurer dans la spec de chaque nouveau composant** ajouté au cockpit.

---

## 9. Décisions consolidées

| # | Sujet | Décision validée |
|---|---|---|
| 1 | `breached` retiré de `engagement.status` | ✅ Lifecycle = state contractuel uniquement |
| 2 | Health calculé non persisté | ✅ Computed à la demande depuis aggregates |
| 3 | Vocabulaire ERP banni (table §2) | ✅ Wording « cockpit », pas « audit » |
| 4 | Boucle de preuve = 5 segments visuels | ✅ Signature produit |
| 5 | Drilldown 3 niveaux max | ✅ Au-delà = ERP, refusé |
| 6 | Pas de ranking individus | ✅ Agrégats équipe uniquement |
| 7 | Pas de notifications urgentes | ✅ Digest hebdo asynchrone |
| 8 | Pas de formulaires obligatoires | ✅ Tout commentaire optionnel |
| 9 | Pas de gamification | ✅ Reconnaissance factuelle uniquement |
| 10 | Pas de drilldown jusqu'à l'individu | ✅ Mode audit séparé pour direction si besoin |

---

## 10. Mise à jour du spec principal

Cette philosophie nécessite **3 corrections** au spec principal `2026-05-10-engagement-loop-design.md` :

### Correction A — section §4 (lifecycle)

Remplacer :
```
status: 'extracted' | 'curated' | 'active' | 'completed' | 'breached' | 'archived'
```

Par :
```
status: 'extracted' | 'curated' | 'active' | 'completed' | 'archived'
-- 'breached' retiré, voir cockpit-design.md §1
-- la santé opérationnelle est calculée séparément, non persistée
```

### Correction B — section §3 (visualisation cockpit)

La représentation actuelle (`PROMIS ── PLANIFIÉ ── EXÉCUTÉ ── PROUVÉ ── VALIDÉ` avec `✅ ⚠ ⚠ ✅ ✅`) est correcte mais doit être enrichie avec la **boucle de preuve à 5 segments** spécifiée en §3 de ce document. La boucle est la signature visuelle.

### Correction C — section §10 (règles métier)

Ajouter une règle R0 :

> **R0 — Anti-bureaucratisation** : aucune fonctionnalité du cockpit ne doit créer de pression psychologique sur le superviseur ou l'agent. La phrase-test §8 de `cockpit-design.md` est appliquée à chaque feature avant merge.

---

## 11. Implications pour le plan d'implémentation

Le plan d'impl à venir doit intégrer ces principes :

1. **Composant `EngagementCockpit`** — la signature visuelle 5 segments, présent partout (dashboard, contract, engagement detail, rapports)
2. **Type `EngagementHealth`** — calculé view-side, jamais stocké, exposé via API
3. **Wording lint** — règle ESLint qui flag les mots ERP bannis (« compliance », « breached », « violation », « audit failed », etc.) dans les composants UI utilisateur-facing
4. **Composants neutres par défaut** — palette tonale légère sauf accent ciblé
5. **Pas de notifications push** dans le scope MVP — uniquement digest hebdomadaire email
6. **Tests de la phrase-superviseur** dans la review : reviewer doit pouvoir confirmer que la feature passe le test §8

---

## 12. Validation

Sous-spec validé par l'utilisateur le 2026-05-10 sur les 10 décisions du §9.

**Prochaine étape** : invoquer `superpowers:writing-plans` pour produire le plan d'implémentation Phase 1 (extraction engagements + cockpit + wizard conversion AO → contrat) en intégrant les principes définis ici.

Avant cela, possibilité d'écrire encore les sous-specs :
- B — Format photo détaillé (anti-fraude, GPS, droit à l'image)
- C — App agent terrain (3 écrans, contraintes mobile)
- D — Rapport mensuel client (templates, IA agrégative)

Ou directement plan d'impl si la matière est suffisante.
