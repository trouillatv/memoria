# Copilote AO — Restructuration UX (Cockpit décisionnel)

**Date :** 2026-05-10
**Statut :** Design validé — prêt pour implémentation
**Scope :** Refonte UX de la vue `?view=atelier` (renommée `?view=copilote`) sur `/tenders/[id]`
**Contexte :** Suite à l'audit UX du 2026-05-10. Le Copilote AO mélange aujourd'hui consultation live et analyses persistées dans un même composant (les pills agents), ce qui crée une charge cognitive excessive et brouille la perception produit.

---

## 1. Objectif

Transformer le Copilote AO d'un « chat amélioré multi-agents » vers un **cockpit décisionnel** où un prospect non onboardé comprend en moins de 30 secondes :

1. Ce qu'est un **Expert IA** (1 agent en consultation simple)
2. Ce qu'est un **Débat IA** (2 à 3 agents qui se confrontent)
3. Ce qui est **persistant** (analyses pré-générées par agent) vs ce qui est **live** (conversation)
4. **Comment interagir** (poser une question vs lancer une analyse)
5. **Où regarder** (zone d'état, zone d'experts, zone de chat, zone de mode)

---

## 2. Critères de succès

| # | Critère | Mesure |
|---|---|---|
| C1 | Test des 30 secondes | Un dirigeant non onboardé identifie les 4 zones de l'écran sans tutoriel |
| C2 | Aucune ambiguïté de mode | À tout moment l'UI affiche explicitement « Avis expert » ou « Débat IA » + participants |
| C3 | Aucun composant ne porte plus de 2 responsabilités | Audit composant par composant après refacto |
| C4 | Migration progressive | 3 phases livrables indépendamment, aucun big bang |
| C5 | Aucune régression fonctionnelle | Les 13 tests existants continuent de passer + nouveaux tests sur composants ajoutés |
| C6 | Démo cohérente | Toutes les fixtures mock continuent de fonctionner sans intervention |

---

## 3. Mental Model

### Deux produits distincts dans un même écran

Le Copilote AO contient **deux produits différents** qui partagent un même set d'agents IA mais ont des sémantiques opposées.

**Produit A — Experts permanents (analyses persistées)**

- Vivent dans `AgentPanel` (sidebar gauche, 320px, dans la vue Copilote)
- Coûteux à générer (1 appel LLM par agent)
- Stockés en DB (table `tender_agent_analyses`)
- État explicite par agent : non généré / en cours / prêt / erreur
- Réutilisables via drawer « Voir l'analyse »
- Génération déclenchée explicitement depuis le panel, jamais depuis le chat

**Produit B — Consultation live (chat)**

- Vit dans la zone centrale
- Deux modes selon nombre d'agents sélectionnés :
  - **Avis expert** = 1 agent
  - **Débat IA** = 2 ou 3 agents
- Stocké en DB (table `tender_chat_messages`) mais perçu comme conversation éphémère
- Mode explicite via Mode Card + CTA adaptatif
- Aucune incidence sur les analyses persistées (dénormalisation volontaire)

> **Règle clé :** un agent peut être consulté en live SANS qu'une analyse persistée existe pour lui, et vice versa. Les deux flows sont indépendants. Cette indépendance est le pivot de toute la restructuration.

---

## 4. Architecture composants

### 4.1 AgentPanel (sidebar gauche, 320px)

**Responsabilité unique :** afficher l'état des analyses persistées par agent et permettre leur génération/régénération/consultation.

**Contenu par agent (7 agents) :**

```
┌──────────────────────────────────┐
│ ⚖  Contradicteur                 │
│ ✓ Prête · 4 risques majeurs      │
│ il y a 2 h · mock                │
│ [Voir l'analyse  →]              │
└──────────────────────────────────┘
```

**États possibles par agent :**

| État | Affichage | CTA |
|---|---|---|
| `not_generated` | « — Pas encore générée » | `[Générer l'analyse]` |
| `pending` | « ⚙ Génération en cours… » + spinner | (disabled) |
| `ready` | « ✓ Prête · N findings » + timestamp + provider badge | `[Voir l'analyse →]` + menu kebab `[Régénérer]` |
| `failed` | « ⚠ Erreur de génération » | `[Réessayer]` |

**Tri :** ordre fixe métier (Lecteur AO → Mémoire → Contradicteur → Financier → Terrain → Conformité → Général).

**Pas de sélection** dans ce panel. Il est purement consultatif. La sélection d'agents pour le chat live se fait exclusivement dans la Mode Card.

### 4.2 Mode Card (au-dessus du composer)

**Responsabilité unique :** afficher le mode courant de la consultation live et permettre de modifier les participants.

**Variante Avis expert (1 agent) :**

```
┌────────────────────────────────────────────────────┐
│ 🎯  Mode : Avis d'expert                          │
│                                                    │
│ Participant : ⚖ Contradicteur  ✕                  │
│                                                    │
│ [+ Ajouter un agent — bascule en Débat IA]        │
└────────────────────────────────────────────────────┘
```

**Variante Débat IA (2-3 agents) :**

```
┌────────────────────────────────────────────────────┐
│ 🔥  Mode : Débat IA · 3 perspectives              │
│                                                    │
│ Participants :                                     │
│ ⚖ Contradicteur  ✕  💰 Financier  ✕  🚧 Terrain ✕│
│                                                    │
│ [3/3 — limite atteinte]                           │
│                                                    │
│ ℹ Les agents donneront d'abord leurs avis        │
│   séparés, puis vous pourrez confronter leurs     │
│   perspectives.                                    │
└────────────────────────────────────────────────────┘
```

**Variante vide (0 agent — état initial) :**

```
┌────────────────────────────────────────────────────┐
│ 🎯  Choisissez un ou plusieurs experts             │
│                                                    │
│ [+ Sélectionner un agent]                          │
└────────────────────────────────────────────────────┘
```

**Bascule de mode automatique** selon nombre d'agents :

- 0 agent → état vide (CTA composer désactivé)
- 1 agent → mode Avis d'expert (couleur sobre slate)
- 2-3 agents → mode Débat IA (gradient amber-blue, bandeau d'anticipation)
- > 3 agents : impossible (sélecteur affiche « 3/3 — limite atteinte »)

### 4.3 Agent Selector (popover searchable)

**Responsabilité unique :** sélectionner les agents participants de la consultation live.

**Déclenchement :** click sur `[+ Ajouter un agent]` ou sur les chips dans la Mode Card.

**Contenu :**

```
┌─────────────────────────────────┐
│ 🔍 Rechercher un agent…         │
├─────────────────────────────────┤
│ ⚖ Contradicteur            ✓   │
│   Challenge les angles morts    │
├─────────────────────────────────┤
│ 💰 Financier               ✓   │
│   Marges, BFR, équilibre éco   │
├─────────────────────────────────┤
│ 🚧 Terrain                 ✓   │
│   Faisabilité opérationnelle    │
├─────────────────────────────────┤
│ 📋 Conformité                  │
│   Réglementation, ISO, RGPD    │
├─────────────────────────────────┤
│ 🧠 Mémoire                     │
│   Réfs, méthodes, antécédents   │
├─────────────────────────────────┤
│ 📖 Lecteur AO                  │
│   Comprend le cahier des charges│
├─────────────────────────────────┤
│ ✨ Général                     │
│   Réflexion transverse          │
└─────────────────────────────────┘
   3/3 sélectionnés
```

**Comportement :**

- Multi-select avec checkbox visible
- Cap dur à 3 (les agents non-sélectionnés deviennent disabled si 3/3)
- Search par label et description
- Click hors popover ou Esc ferme et applique
- État synchronisé avec Mode Card en temps réel

### 4.4 Analyses Drawer

**Déclenchement :** click sur `[Voir l'analyse →]` dans AgentPanel.

**Contenu :**

```
┌─ Drawer (right slide-in, 480px) ──────────────────┐
│ ⚖ Contradicteur — Analyse persistée               │
│                                                    │
│ Synthèse                                           │
│ ─────────────────────────────────────────────      │
│ [markdown rendered]                                │
│                                                    │
│ Points clés                                        │
│ ─────────────────────────────────────────────      │
│ • Risque réglementaire ICPE article 4              │
│ • Surface estimée incohérente p.7 vs p.12          │
│ • Pénalités contractuelles asymétriques            │
│                                                    │
│ Sources                                            │
│ ─────────────────────────────────────────────      │
│ 📄 PDF p.7 « surface totale 12 000 m² »            │
│ 📚 Réf. CHU Toulouse [Bibliothèque →]              │
│                                                    │
│ Métadonnées                                        │
│ ─────────────────────────────────────────────      │
│ Générée : 2026-05-10 14:32 (il y a 2 h)            │
│ Provider : mock · 3 247 tokens                     │
│                                                    │
│ [Régénérer l'analyse]                              │
└────────────────────────────────────────────────────┘
```

### 4.5 Hero compact persistant

**Avant (à supprimer) :** Hero card pleine largeur qui disparaît au 1er message.

**Après :** Barre de contexte sticky qui adapte sa densité selon état du chat.

**État vide (0 message) — Hero plein :**

```
┌────────────────────────────────────────────────────┐
│ 🟢  7 experts ont lu cet AO                        │
│                                                    │
│  3 prêts · 2 en cours · 2 à générer               │
│                                                    │
│  Risques        Contraintes      Checklist        │
│  4 majeurs      12 (3 obligat.)  8 actions        │
│                                                    │
│ Suggestions :                                      │
│ [Risques cachés] [Marges réelles] [Conformité]    │
│ [Pénalités]      [Faisabilité]    [Synthèse]      │
└────────────────────────────────────────────────────┘
```

**État conversation active (≥ 1 message) — Hero compact ribbon :**

```
┌────────────────────────────────────────────────────┐
│ 🟢 7 experts · 3 prêts · 2 en cours · 2 à générer │
│                              [Voir suggestions ▼]  │
└────────────────────────────────────────────────────┘
```

Le ribbon reste visible (sticky top) tant que l'utilisateur est dans la vue Copilote. Click sur `[Voir suggestions ▼]` ré-affiche le hero plein temporairement (overlay).

### 4.6 Composer & CTA adaptatif

**Composer :** identique à l'existant (textarea auto-resize, slash commands, support Markdown).

**CTA principal — wording adaptatif selon mode :**

| Agents sélectionnés | CTA | Style |
|---|---|---|
| 0 | `Sélectionnez d'abord un expert` (disabled) | grey |
| 1 | `Demander un avis ►` | primary slate |
| 2-3 | `Lancer le débat IA ►` | gradient amber-blue |

**Hint sous composer :**

- Mode Avis expert : *« L'agent répondra en mode consultation simple »*
- Mode Débat IA : *« Les N agents répondront en parallèle, vous pourrez confronter leurs perspectives ensuite »*

### 4.7 Challenge manuel (Confronter les avis)

**Déclenchement :** uniquement après une réponse parallèle initiale en mode Débat IA. Bouton apparaît sous le dernier groupe de réponses.

```
┌────────────────────────────────────────────────────┐
│ Réponses parallèles : ⚖ ⚖ 💰 💰 🚧 🚧             │
│                                                    │
│ ┌──────────────────────────────────────────┐      │
│ │ 🔄 Confronter les avis                   │      │
│ │ Round unique · les agents réagiront aux  │      │
│ │ propos des autres                        │      │
│ └──────────────────────────────────────────┘      │
└────────────────────────────────────────────────────┘
```

**Comportement :**

- 1 seul round possible (pas de cascade)
- Après confrontation, le bouton disparaît définitivement pour ce turn
- Si l'utilisateur envoie une nouvelle question, un nouveau cycle (parallèle + bouton confrontation) recommence
- Mode Avis expert (1 agent) : pas de bouton confrontation (impossible de débattre seul)

---

## 5. Layout

### 5.1 Desktop ≥ 1024px

```
┌─ TenderSidebar (280px) ─┬─ Atelier Copilote ──────────────────────────────┐
│ État • KPIs             │                                                  │
│ Sources • Activité      │ ┌─ AgentPanel (320px) ─┬─ Consultation ────────┐│
│ Navigation              │ │                      │                       ││
│                         │ │ ⚡ Analyses          │ ┌─ Hero ribbon ─────┐ ││
│                         │ │   persistées         │ └───────────────────┘ ││
│                         │ │                      │                       ││
│                         │ │ ⚖ Contradicteur     │  Messages thread      ││
│                         │ │   ✓ Prête           │   …                   ││
│                         │ │                      │                       ││
│                         │ │ 💰 Financier        │ ┌─ Mode Card ───────┐ ││
│                         │ │   ⚙ En cours        │ │ 🎯 Avis expert    │ ││
│                         │ │                      │ │ ⚖ Contradicteur   │ ││
│                         │ │ 🚧 Terrain          │ └───────────────────┘ ││
│                         │ │   — Pas générée     │                       ││
│                         │ │                      │ ┌─ Composer ────────┐ ││
│                         │ │ … (4 autres)        │ │ Question…          │ ││
│                         │ │                      │ │ [Demander un avis]│ ││
│                         │ └──────────────────────┴─└───────────────────┘─┘│
└─────────────────────────┴──────────────────────────────────────────────────┘
```

Grille : `grid-cols-[280px_1fr]` au niveau page, puis `grid-cols-[320px_1fr]` à l'intérieur de la vue copilote.

### 5.2 Tablet 768-1023px

AgentPanel devient drawer accessible par bouton header. Le chat occupe toute la zone centrale.

```
┌─ TenderSidebar (280px) ─┬─ Atelier Copilote ─────────────────────────────┐
│                         │ [Analyses (3/7) ▼]    Hero ribbon              │
│                         │                                                 │
│                         │  Messages thread                                │
│                         │                                                 │
│                         │  Mode Card                                      │
│                         │  Composer                                       │
└─────────────────────────┴─────────────────────────────────────────────────┘
```

### 5.3 Mobile < 768px

```
┌─────────────────────────────────────┐
│ ← Tender · titre AO                 │
│ [État ▼]  [Analyses ▼]              │
├─────────────────────────────────────┤
│ Hero ribbon compact                 │
│                                     │
│ Messages stack verticalement        │
│  (pas de grid à 2 colonnes)        │
│                                     │
├─────────────────────────────────────┤
│ Mode Card (collapsible)             │
│ Composer (sticky bottom)            │
└─────────────────────────────────────┘
```

TenderSidebar et AgentPanel deviennent tous deux des drawers accessibles depuis le header.

---

## 6. Wording normalization

| Endroit | ❌ Avant | ✅ Après |
|---|---|---|
| Bouton sur pill | « Briefer un agent » | « Générer l'analyse » (dans AgentPanel) |
| Bouton de retry | « Réveiller » | « Régénérer » (dans drawer / kebab) |
| Vue navigation | « Atelier IA » | « Copilote AO » (uniformisé partout) |
| CTA composer (1 agent) | « Envoyer » | « Demander un avis ► » |
| CTA composer (N agents) | « Envoyer » | « Lancer le débat IA ► » |
| Challenge | « Confronter les perspectives · Round 1 » | « Confronter les avis · round unique » |
| État pill | « En cours… » sur pill | « ⚙ Génération en cours… » dans AgentPanel |
| État vide | « 7 agents IA ont lu cet AO » | « 7 experts ont lu cet AO · X prêts · Y en cours · Z à générer » |
| Hint Débat IA | (absent) | « Les agents donneront d'abord leurs avis séparés, puis vous pourrez confronter leurs perspectives. » |

---

## 7. State machines

### 7.1 Analyse persistée par agent (`tender_agent_analyses`)

```
not_generated ──[click Générer]──> pending ──[after() success]──> ready
                                       │                            │
                                       ├──[after() error]──> failed │
                                       │                            │
ready ──[click Régénérer]────────────> pending                      │
                                                                    │
failed ──[click Réessayer]──> pending                               │
```

**Pas de transition automatique :** la génération est toujours déclenchée explicitement par l'utilisateur depuis l'AgentPanel. Aucun chemin n'autogénère une analyse depuis le chat.

### 7.2 Mode courant (consultation live)

```
empty ──[+1 agent]──> avis_expert ──[+1 agent]──> debat_ia (2)
                          │                            │
                          │                            ├──[+1 agent]──> debat_ia (3)
                          │                            │
                          │   <─[-1 agent]──────────── │
                          │                            │
empty <──[-1 agent]── avis_expert
```

**Bascule de mode purement déclarative** depuis le compteur de participants. Pas d'état caché.

### 7.3 Cycle d'un turn de chat

```
                              ┌─ Mode Avis expert ─────────────────────────┐
                              │ user message → 1 agent response → STOP    │
[empty]                       └────────────────────────────────────────────┘
   │
   ├─[user submit]─→
   │
   │                          ┌─ Mode Débat IA ────────────────────────────┐
   │                          │ user message → N parallel responses        │
   │                          │   → [Confronter les avis ?]                │
   │                          │     ├─ click → 1 round confrontation → STOP│
   │                          │     └─ ignore → STOP                       │
   │                          └────────────────────────────────────────────┘
   │
   └─[next user message]─→ nouveau cycle indépendant
```

---

## 8. Migration — refacto unique en commits progressifs

**Décision (validée 2026-05-10) :** pas de phase 1 transitoire. Les pills sont la dette UX principale, on les supprime directement. Refacto unique livrée en 6 commits progressifs pour limiter le risque, dans cet ordre :

### Commit 1 — Mode Card + sélection agents + CTA adaptatif

- Composant `ModeCard.tsx` (au-dessus du composer)
- Composant `AgentSelectorPopover.tsx` (popover searchable multi-select, cap à 3)
- CTA adaptatif (« Demander un avis » / « Lancer le débat IA »)
- Persistance `localStorage` de la sélection agents par `tender_id` (clé : `copilote-agents-${tender_id}`)
- Suppression complète des pills dans `AtelierIATab.tsx`
- Bandeau d'anticipation en mode Débat IA
- Tests unitaires : ModeCard, AgentSelectorPopover, persistance localStorage

**Critère d'acceptance :** le chat fonctionne entièrement via Mode Card, les pills n'existent plus, la sélection persiste après refresh.

### Commit 2 — AgentPanel (analyses persistées)

- Composant `AgentPanel.tsx` (sidebar gauche, 320px)
- 4 états par agent : `not_generated` / `pending` / `ready` / `failed`
- CTA `[Générer l'analyse]` / `[Voir l'analyse →]` / `[Réessayer]` selon état
- Server Action `runAgentInitialAnalysisAction` déplacée : appelée uniquement depuis AgentPanel
- Sub-grid `[320px AgentPanel | 1fr Chat]` dans la vue copilote
- Tests unitaires : AgentPanel rendering selon états + actions

**Critère d'acceptance :** AgentPanel affiche les 7 agents avec état correct, génération fonctionne en background via `after()`, refresh affiche le nouvel état.

### Commit 3 — Drawer Voir l'analyse

- Composant `AgentAnalysisDrawer.tsx` (drawer right slide-in 480px)
- Sections : Synthèse · Points clés · Sources · Métadonnées (date + provider + tokens)
- CTA `[Régénérer l'analyse]`
- Click sur source bibliothèque redirige vers `/library?focus=<id>`
- Tests unitaires : rendering drawer, action régénérer

**Critère d'acceptance :** click sur `[Voir l'analyse →]` ouvre le drawer avec contenu complet, régénération fonctionne.

### Commit 4 — Hero compact + Suggestions

- Hero card pleine largeur si chat vide (existant conservé)
- Bascule vers ribbon sticky compact dès le 1er message
- Bouton `[Voir suggestions ▼]` dans le ribbon → réaffiche les 6 prompts en overlay
- Comptage dynamique « X prêts · Y en cours · Z à générer » synchronisé avec AgentPanel
- Tests unitaires : transition vide → ribbon, overlay suggestions

**Critère d'acceptance :** Hero ne disparaît plus, accès aux suggestions toujours possible sans slash commands.

### Commit 5 — Responsive mobile (drawers)

- Mobile < 768px : TenderSidebar et AgentPanel deviennent drawers
- Header mobile compact : `[État ▼]` `[Analyses ▼]` (boutons sobres, sans saturer)
- Contenu chat reste prioritaire et centré (zone tap minimum 60% de l'écran)
- Drawers slide-in depuis la gauche avec overlay sombre, fermeture par swipe ou tap-outside
- Mode Card collapsible en mobile (réduit à 1 ligne avec `[edit ✎]`)
- Tests E2E mobile sur les 3 flows (Avis expert / Débat IA / Génération analyse)

**Critère d'acceptance :** sur iPhone SE (375px), le chat reste lisible, les drawers ne se déclenchent jamais accidentellement, l'utilisateur peut envoyer un message sans ouvrir aucun drawer.

### Commit 6 — Nettoyage wording final

- Renommage uniformisé `Atelier IA` → `Copilote AO` partout (sidebar nav, page title, breadcrumbs, tooltips)
- Vérification table § 6 wording end-to-end
- Suppression des références mortes aux pills dans le code
- Tests E2E full smoke : tous les flows + couverture mock fixtures

**Critère d'acceptance :** grep `Atelier IA` retourne 0 résultat utilisateur-visible (sauf historique git), grep `Briefer` / `Réveiller` retourne 0.

---

### Hors scope (à ne PAS faire dans cette refonte)

Listé pour traçabilité, à replanifier indépendamment :

- Visualisation timeline du débat (zones d'accord/désaccord auto-détectées)
- Citations PDF avancées avec pré-visualisation page
- Threads de chat sauvegardés (titre + tags)
- IA activity feed enrichie (cross-tenders)
- Coût visible par génération (tokens + provider)

---

## 9. Hors scope (à ne PAS faire dans cette refonte)

- Streaming token-by-token des réponses agent (brouille le multi-agent layout)
- Voice input/output
- Templates de prompt sauvegardés
- Comparaison entre AOs
- Onboarding tour interactif
- Pré-génération automatique des 7 analyses au moment du upload tender (coût LLM × 7 par AO)
- Permissions par agent / quotas
- Refonte de la TenderSidebar globale (ce composant fonctionne bien et n'est pas touché)
- Refonte des autres vues (`synthese`, `analyse`, `memoire`) — ce spec ne couvre QUE la vue Copilote

---

## 10. Décisions actées

Liste exhaustive des décisions UX validées avec l'utilisateur le 2026-05-10 :

1. **Séparation complète** entre analyses persistées (AgentPanel) et consultation live (chat). Les deux flows sont indépendants. ✅
2. **1 agent = Avis expert · 2-3 agents = Débat IA** comme modèle mental dominant. ✅
3. **Pills supprimées** complètement (dette UX). ✅
4. **Mode Card explicite** au-dessus du composer affichant mode + participants. ✅
5. **Sélection des agents via popover searchable** (combiné avec Mode Card pour expliquer). ✅
6. **Cap dur à 3 agents max** en consultation live. ✅
7. **Le chat ne pilote plus jamais les analyses persistées.** Génération uniquement depuis AgentPanel. ✅
8. **Hero compact ribbon sticky** au lieu de Hero qui disparaît. ✅
9. **Challenge inter-agents manuel** uniquement, single round, jamais automatique. ✅
10. **Bandeau d'anticipation** en mode Débat IA (« les agents donneront d'abord leurs avis… »). ✅
11. **AgentPanel premium** : état + findings + dernière génération + sources + provider visibles. ✅
12. **Refacto unique en 6 commits progressifs** (pas de phase 1 transitoire avec pills). ✅
13. **Wording « Briefer/Réveiller » remplacé** par « Générer/Régénérer ». ✅
14. **« Atelier IA » uniformisé en « Copilote AO »** dans toute l'UI. ✅
15. **AgentPanel devient drawer mobile** + tablet < 1024px. ✅
16. **Sélection agents persistée en `localStorage` par `tender_id`** (validé 2026-05-10, scope simple, pas en DB). ✅
17. **Hero compact conserve un bouton « Voir suggestions »** pour réafficher les 6 prompts en overlay (validé 2026-05-10, slash commands seuls insuffisants pour utilisateur non expert). ✅
18. **Mobile : contenu chat reste prioritaire** (zone tap minimum 60% de l'écran), les 2 drawers `[État ▼]` `[Analyses ▼]` ne doivent pas être envahissants (validé 2026-05-10). ✅

---

## 11. Conventions techniques

- Tous les nouveaux composants client : `'use client'` en tête
- Server Actions inchangées sauf `runAgentInitialAnalysisAction` qui n'est plus appelée depuis `AtelierIATab` mais depuis `AgentPanel`
- État du mode courant : géré localement dans `AtelierIATab` via `useState` (selectedAgents: ChatAgentName[])
- Persistance préférence agents : `localStorage` clé `copilote-agents-${tender_id}` (validé 2026-05-10, scope simple, pas en DB)
- Couleurs agents : palette existante (`agents-colors.ts`) inchangée
- Icônes agents : `agents-metadata.ts` inchangé
- Tailwind v4 + shadcn : Drawer existant (vaul) réutilisé, Popover de @base-ui/react à valider en phase 2

---

## 12. Risques et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Popover @base-ui/react buggué (cf. Select) | Moyenne | Moyen | Fallback sur Drawer mobile-first si bug identique au Select overlay |
| Régression mock fixtures | Faible | Élevé | Tests E2E sur les 3 flows en début de phase 2 avant tout refacto |
| Perte de fonctionnalité Briefer entre phase 1 et 2 | Faible | Moyen | Ajouter CTA « Générer l'analyse » dans la sidebar tender existante en phase 1 (transition) |
| Confusion utilisateur durant migration | Moyenne | Faible | Phase 1 reste fonctionnellement équivalente, juste nettoyée |

---

## 13. Validation

Spec validé par l'utilisateur le 2026-05-10 sur les 15 décisions actées du § 10.

Prochaine étape : invocation du skill `writing-plans` pour produire le plan d'implémentation détaillé task par task, en commençant par la Phase 1 (quick wins).
