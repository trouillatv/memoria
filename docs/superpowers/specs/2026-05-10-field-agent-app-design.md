# App agent terrain — Philosophie UX et règles immuables

**Date :** 2026-05-10
**Statut :** Design validé — fondations pour l'implémentation Phase 2
**Posture :** Senior Product Designer + Director of Operations + responsable terrain
**Scope :** Philosophie produit, règles UX, anti-patterns, contraintes psychologiques de l'app utilisée par les agents de nettoyage sur le terrain

---

## 0. Pourquoi ce document est critique

Toute la stratégie MemorIA repose sur **la qualité des données capturées sur le terrain** :
- Sans bonnes photos → rapports clients pauvres → moat affaibli
- Sans anomalies remontées → pas de capital incidents → IA contradicteur sans matière
- Sans validations sincères → théâtre administratif → confiance détruite

L'app agent terrain n'est **pas une feature**. C'est le **gate de qualité de toute la donnée** qui alimente la boucle stratégique. Si ce maillon est mauvais, le cockpit le plus beau ne sauve rien.

> **Verrou** : si l'agent ressent l'app comme une contrainte, il sabote la donnée. Conscient ou inconscient. Photos floues, checklists cochées sans regarder, anomalies tues. **C'est la mort silencieuse du produit.**

Ce document définit la philosophie UX qui doit garantir que l'agent vive l'app comme **un soulagement, pas une corvée**.

---

## 1. Le profil réaliste de l'agent terrain

### Qui est-il, vraiment ?

Profil typique d'un agent de nettoyage en France (B2B, sociétés type Onet, Atalian, Samsic, mais surtout PME locales — la cible MemorIA) :

| Dimension | Réalité de l'agent |
|---|---|
| **Statut** | Souvent CDI temps partiel, parfois CDD ou intérim |
| **Origine linguistique** | Français parfois langue seconde (~30-50% selon zones) |
| **Âge** | 25-55 ans en majorité, distribution bimodale (jeunes/seniors) |
| **Smartphone** | Personnel (l'employeur ne fournit JAMAIS de device dans la PME nettoyage). Modèle : Android entry/mid range (Samsung A series), iPhone SE/8/X. **Pas le dernier iPhone.** |
| **Forfait data** | Limité, souvent 5-30 Go/mois. Wi-Fi peu fiable sur sites |
| **Réseau sur site** | Catastrophique : sous-sols, parkings, locaux techniques. EDGE/3G fréquent |
| **Horaires** | Pré-aube (5h-9h) ou post-bureau (18h-22h). Souvent fatigué, parfois deux jobs |
| **Pression temps** | 30 min par site, multi-sites par jour. Pas de marge |
| **Mains** | Gants nitrile/latex, parfois mouillés, parfois souillés |
| **Formation** | Minimale (1-2 jours), apprentissage on-the-job |
| **Turnover** | Élevé (35-60% annuel dans le secteur). L'app doit être prise en main en < 5 min, sans tutoriel |
| **Niveau tech** | Hétérogène : du grand-débutant au natif numérique |
| **Confiance dans la hiérarchie** | Méfiance par défaut (logique, vu les pratiques sectorielles) |

### La psychologie sous-jacente

Trois peurs que l'agent ressent face à un nouvel outil :

1. **Peur d'être surveillé** — *« On va voir si je travaille ? »*
2. **Peur d'être accusé** — *« Si j'oublie une case, on va me sanctionner ? »*
3. **Peur d'être ridiculisé** — *« Je vais pas savoir m'en servir. »*

Trois réflexes corollaires :

1. **Faire vite** (« cocher tout pour finir »)
2. **Ne pas signaler** (« si je dis qu'il manque du papier, on dira que c'est ma faute »)
3. **Ne pas demander d'aide** (« tant pis, je devine »)

> **Le design produit doit répondre directement à ces 3 peurs.** Pas par des messages rassurants (l'agent les ignore). Par la structure même de l'app.

### Ce que signifie « répondre aux peurs par la structure »

| Peur | Anti-réponse (mauvaise) | Bonne réponse (structurelle) |
|---|---|---|
| Surveillance | Bandeau « Vos données sont protégées » | **Aucun timestamp affiché**, aucun compteur de durée, aucun GPS visible |
| Accusation | Popup « Vous devez justifier l'oubli » | **Pas de blocage. Pas de justification forcée.** Tout est optionnel |
| Ridicule | Tutorial « 10 étapes pour bien démarrer » | **Premier écran est immédiatement utilisable**, sans onboarding |

L'agent ne doit pas avoir besoin qu'on le rassure. Il doit constater par l'usage.

---

## 2. Le modèle cognitif mobile

### La règle reine

> **1 tâche = 1 écran = 1 décision.**

C'est la règle qui résume tout. À chaque écran, l'agent fait UNE chose. Pas deux. Pas de menu latéral, pas d'onglets, pas de tabs.

### Les 7 règles immuables du modèle cognitif

#### R1 — 3 écrans maximum dans toute l'app
Liste missions du jour → Mission active → Caméra/Anomalie.
**Pas un écran de plus.** Pas de Settings, pas de Profile, pas de Notifications, pas d'Help, pas d'Archive.

#### R2 — 1 action dominante par écran
L'écran « Mission active » a 1 action dominante : `[✓ Mission terminée]`. Toutes les autres actions (photos, anomalies, validation items) sont **secondaires et visuellement plus discrètes**.

#### R3 — Boutons gros par défaut
Cible tactile minimum **56×56 px** (vs 44 px standard). L'agent porte des gants. Boutons critiques (camera, terminer, anomalie) : **64+ px**.

#### R4 — Texte minimal, icône maximale
Aucun texte décoratif. Si une icône suffit, pas de texte. Si du texte est nécessaire : 3 mots maximum, vocabulaire élémentaire (CECR A2).

#### R5 — Pas de scroll horizontal, scroll vertical limité
1 écran = 1 vertical scroll dans le pire cas. Si l'écran fait plus de 2 hauteurs de viewport, le design est cassé.

#### R6 — Aucune transition spectaculaire
Pas d'animation longue, pas d'effet 3D, pas de splash screen. Transitions < 200ms, fade simple. **L'app doit se sentir instantanée.**

#### R7 — Aucune popup non sollicitée
Pas de modal d'onboarding, pas de "rate this app", pas d'update prompt, pas de cookie banner, pas de "noter cette intervention", **pas de "êtes-vous sûr ?"**. Toutes les actions sont réversibles ou commitées.

### La règle « êtes-vous sûr »

Bannie. Si l'agent fait une mauvaise manip :
- L'action est réversible (la photo est conservée même si la checklist est validée par erreur)
- Ou l'action est trivialement refaisable (re-prendre une photo)
- Ou un superviseur peut corriger côté backend

Jamais demander à l'agent de confirmer une action. Il a déjà décidé en touchant le bouton.

### Limites cognitives à respecter

| Métrique | Limite |
|---|---|
| Temps d'attention pour comprendre un écran | **3 secondes** |
| Temps pour trouver l'action principale | **1 seconde** (elle est dominante) |
| Étapes pour prendre une photo | **2 taps maximum** depuis l'écran mission |
| Étapes pour signaler une anomalie | **3 taps maximum** depuis l'écran mission |
| Étapes pour terminer une intervention | **2 taps** (`Terminer` → confirm visuel inline) |

---

## 3. Architecture des 3 écrans

### Écran 1 — Mes missions (Home)

**Question répondue** : *« Que dois-je faire aujourd'hui ? »*

```
┌──────────────────────────────────────┐
│                                      │
│  Bonjour Mehdi 👋                    │
│  Mardi 12 mai · 3 missions           │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  ▶  CHU Tour B                 │  │
│  │     8h00 — 10h00               │  │
│  │     avec Karim                 │  │
│  │                                │  │
│  │     [▶ COMMENCER]              │  │
│  └────────────────────────────────┘  │
│                                      │
│  ─────  À VENIR  ─────               │
│                                      │
│  Banque Centrale · 14h00             │
│  École JJ · 17h00                    │
│                                      │
└──────────────────────────────────────┘
```

**Règles de cet écran** :
- 1 mission active visuellement dominante
- Missions à venir en card secondaires (gris, non-interactives jusqu'à l'heure)
- Pas de navigation, pas de menu burger
- Pas d'avatar/profil tappable
- Pas de "settings" cachés
- Pas de notifications hub
- Si pas de missions aujourd'hui : message bienveillant simple, pas un écran vide accusateur

**Ce qui est invisible mais crucial** :
- Le nom de l'agent (« Mehdi ») est tiré du login. Pas un settings affiché.
- L'heure courante n'est jamais affichée par l'app (le téléphone l'a déjà). Pas de compétition avec le statut bar.
- Aucun indicateur de "performance" (« 12 missions cette semaine ! »). L'agent n'est pas en compétition avec lui-même.

### Écran 2 — Mission active

**Question répondue** : *« Que dois-je faire ICI, et comment je prouve ? »*

```
┌────────────────────────────────────────────┐
│  ←  CHU Tour B · 8h00-10h00                │
│                                            │
│  Tâches à faire :                          │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ ☐ Vidage poubelles                   │  │
│  │   📷  [+ photo après]                │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ ☐ Désinfection sanitaires            │  │
│  │   📷 [+ avant]   📷 [+ après]        │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ ☐ Nettoyage couloir                  │  │
│  │   📷 [+ photo après]                 │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ ☑ Aération                           │  │
│  │   ✓ Validé · 8h12                    │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  ─────────────────────────────────────     │
│                                            │
│  [⚠ Anomalie]    [✓ Mission terminée]      │
│                                            │
└────────────────────────────────────────────┘
```

**Règles de cet écran** :
- Liste claire et linéaire des tâches
- Bouton photo visible directement (pas dans un menu, pas dans un détail)
- Tâches faites : grisées discrètement, pas spectaculaires (« Bravo ! ✨ ») mais acquittées (✓)
- Bouton terminer en bas, dominant mais pas anxiogène
- Bouton anomalie en bas-gauche, accessible mais secondaire visuellement

**Anti-patterns explicitement bannis** :
- ❌ Compteur « 2/4 tâches faites » (crée pression du chiffre)
- ❌ Barre de progression % (mauvais signal — agent peut "vouloir aller à 100%" en cochant sans faire)
- ❌ Sub-categorisation par zone (« sanitaires », « couloirs ») — ajout cognitif inutile
- ❌ Drag-and-drop pour réordonner les tâches
- ❌ Multi-select des tâches
- ❌ Filtres / recherche dans la checklist
- ❌ Notes textuelles sur chaque tâche (sauf si strictement nécessaire — alors voice optional)

**Exception : item « Validé sans photo »**
Pour les tâches qui ne nécessitent pas de photo (ex: « Aérer la pièce »), un seul tap valide. Pas de photo, pas de commentaire requis. Geste simple.

### Écran 3 — Caméra (ou modal Anomalie)

**Question répondue** : *« Je capture / je signale. »*

#### Caméra (le geste central)

```
[Plein écran caméra]
   • Aucun chrome visible
   • Aucun bouton retour subtil en haut-gauche
   • Bouton capture central, gros (80px)
   • Switch caméra (avant/arrière) si pertinent
   • PAS de filtres, retouches, crop
   • PAS de timer, ratio, mode
   • Indicateur discret du contexte : « Désinfection sanitaires · Avant »
```

**Pourquoi pas de chrome** : pour signaler clairement que le focus est UNIQUEMENT la prise photo. L'agent ne navigue pas dans la caméra, il prend une photo et c'est tout.

**Le contexte dans la caméra** : un petit bandeau discret (haut, semi-transparent) rappelle : *« Désinfection sanitaires · Photo avant »*. L'agent sait CE qu'il photographie. Mais il n'a aucune action de configuration à faire.

**Après capture** : retour automatique à l'écran 2 (mission active) avec la tâche cochée. Pas de preview à confirmer, pas de "saved!" toast. Just done.

#### Modal Anomalie

```
┌────────────────────────────────────────┐
│  ←  Anomalie                            │
│                                         │
│  Que se passe-t-il ?                    │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │ 🚱  Eau coupée                     │ │
│  │ ⚠   Matériel cassé                 │ │
│  │ 🚪  Accès bloqué                   │ │
│  │ 🧴  Produit manquant                │ │
│  │ ❓   Autre                          │ │
│  └────────────────────────────────────┘ │
│                                         │
│  Photo (obligatoire)                    │
│  [📷 PRENDRE LA PHOTO]                  │
│                                         │
│  Note vocale (facultatif)               │
│  [🎙 Enregistrer]                       │
│                                         │
│  [ENVOYER]                              │
│                                         │
└────────────────────────────────────────┘
```

**Règles** :
- 4-5 catégories prédéfinies, choix rapide. Pas de hiérarchie.
- « Autre » avec texte libre court (1 phrase max)
- Photo obligatoire pour traçabilité
- Note vocale optionnelle (transcription serveur, peu fiable mais bonus)
- 1 bouton « Envoyer », et c'est fini. Aucune confirmation.

**Pourquoi vocale et pas texte ?** Parce que l'agent francophone fragile, l'agent gants, l'agent sous pression — tous préfèrent parler 5 secondes que taper 30 secondes. Vocal est la version la plus accessible cross-langue/contexte.

### Carte mentale des 3 écrans

```
┌─────────────────┐
│ Écran 1         │
│ Mes missions    │
│                 │
│ Tap mission ▶   │──┐
└─────────────────┘  │
                     ▼
                  ┌─────────────────┐
                  │ Écran 2         │
                  │ Mission active  │
                  │                 │
        ┌─────────┤ Tap photo 📷    │
        │         │ Tap anomalie ⚠  │──┐
        │         └─────────────────┘  │
        ▼                              ▼
┌─────────────────┐            ┌─────────────────┐
│ Écran 3a        │            │ Écran 3b        │
│ Caméra          │            │ Modal Anomalie  │
│                 │            │                 │
│ Capture         │            │ Type + Photo    │
│ → retour auto   │            │ → retour auto   │
└─────────────────┘            └─────────────────┘
```

3 écrans physiques. 0 écran de configuration. **Aucun écran « caché » accessible par menu.**

---

## 4. La capture photo — le geste central

### Pourquoi c'est LE moment critique

L'agent va répéter ce geste 5-40 fois par jour. Si la friction est de +1 seconde, c'est +40 secondes de friction quotidienne, +3 heures par mois, +36 heures par an. **Multiplié par N agents.** L'optimisation de ce geste a un ROI massif.

Et surtout : si l'agent en a marre, il prend des photos fausses (le sol vide pour acquitter), ou pas du tout. **La qualité de la donnée s'effondre.**

### L'expérience cible

Un agent fait :
1. Tap `📷` sur une tâche → caméra ouverte instantanément
2. Cadrage naturel (1 seconde)
3. Tap capture → retour mission automatique, tâche cochée

**3 actions, < 5 secondes, mains gantées.**

### Les 7 règles de la capture photo

#### CP1 — Pré-warm de la caméra
La permission caméra est demandée à la première utilisation et conservée. Aux usages suivants, l'API caméra démarre **avant** que l'utilisateur n'arrive sur l'écran (preload sur tap du `📷`).

#### CP2 — Aucune retouche / crop / filtre côté client
La photo brute. Point. Toute manipulation = source de bug + perte de temps + risque de falsification.

#### CP3 — Le contexte est imposé par la tâche
Si la tâche dit « avant », la photo est `before`. Si l'agent prend dans le mauvais ordre, le superviseur corrigera côté admin. **L'agent ne classifie jamais.**

#### CP4 — Pas de preview à confirmer
Photo prise = photo enregistrée. Retour automatique à la mission. **Aucun « voulez-vous garder cette photo ? »**.

#### CP5 — Multi-shot autorisé
L'agent peut prendre plusieurs photos pour la même tâche (avant×3 par exemple) — toutes conservées. Le superviseur trie côté backend si besoin. **Pas de blocage à 1 photo unique.**

#### CP6 — Indicateur du contexte minimal
Petit bandeau semi-transparent en haut de la caméra : *« Désinfection sanitaires · Photo avant »*. C'est tout. Pas de bouton « changer de tâche », pas de switch « avant/après ».

#### CP7 — Pas de timer, pas de retardateur, pas de geo-tag visible
La photo est instantanée. Aucune option de configuration. Le timestamp serveur et le contexte sont gérés côté serveur. L'agent n'en sait rien.

### Anti-patterns photo à bannir

| Anti-pattern | Pourquoi c'est tueur |
|---|---|
| ❌ « Confirmez cette photo » modal | Latence cognitive +3 sec × N photos. Tuer les agents |
| ❌ Crop / rotate / filter | Manipulations source de fraude potentielle |
| ❌ « Géolocalisation activée » bandeau | Active la peur de surveillance |
| ❌ Indicateur d'upload « 23%... » dans la caméra | Crée anxiété connexion |
| ❌ « Vous avez 47 photos non synchronisées » alerte | Sentiment de dette |
| ❌ Limitation à N photos par jour / par item | Bureaucratique. La donnée multi-shot est précieuse |
| ❌ Photo obligatoire pour valider une tâche qui n'en a pas besoin | Surcoût injustifié |
| ❌ Preview avec annotations à dessiner | Pas la mission de l'agent |
| ❌ « Retouchez votre photo si floue » | Honte implicite |
| ❌ Tagging manuel de zone (sanitaire/couloir/cuisine) | Système le sait via la checklist |

### La fatigue photo — phénomène à anticiper

Au-delà de 30 photos/jour, la qualité chute. L'agent commence à faire des photos floues, mal cadrées, vides. C'est un **plafond cognitif réel**.

**Mitigation** :
- Designer les checklists pour limiter les photos requises (10-15 max par mission)
- Préférer « photo après » seul à « avant + après » sauf si réellement nécessaire
- Le superviseur définit la checklist au moment du Mission Editor — il doit avoir conscience de ce coût cognitif

> **Règle produit** : si une mission requiert > 15 photos, un warning apparaît côté Mission Editor : *« Cette mission demande 18 photos par exécution. Fatigue agent probable. »*

---

## 5. Faible réseau / quasi-offline

### La philosophie — ne pas faire de l'offline-first complet

L'offline-first complet est cher (sync engine, conflict resolution, queue UI complexe). Pour le MVP, on vise **« quasi-offline »** :
- Photos prises hors réseau → queue locale
- Upload retry automatique en arrière-plan
- L'agent a l'illusion que tout marche

### Les règles de comportement réseau

#### RR1 — La photo est « committée » au moment de la capture
Du point de vue agent, la photo est faite. Le système est responsable de l'upload. **L'agent ne voit JAMAIS d'écran "upload en cours"**.

#### RR2 — Queue locale silencieuse
Toutes les photos prises sont stockées en local d'abord. Upload tente immédiatement (si réseau). Sinon : retry exponentiel en arrière-plan (1min, 5min, 15min, 1h, 6h, 24h).

#### RR3 — Indicateur global discret
Un petit indicateur en haut à droite (sur écran missions) :
- Rien si tout est uploadé
- Petit `↑ 3` si 3 photos sont en queue
- Aucune couleur alarmante

L'agent peut tap pour voir : *« 3 photos seront envoyées dès que vous aurez du réseau. Aucune action requise. »*

#### RR4 — Persistance solide
Les photos en queue **survivent** :
- Au reload de l'app
- Au reboot du téléphone
- À une perte de session (login expire)
- À un changement de wifi

Use case : l'agent prend 12 photos en sous-sol, rentre chez lui, ouvre l'app le soir → upload se fait sur son wifi. **Aucune intervention de sa part.**

#### RR5 — Échec définitif après 24-48h
Si une photo ne s'est pas uploadée après 24h de retry, on alerte (gentiment) :
- À la prochaine ouverture de l'app
- Message non-bloquant : *« 2 photos prises hier n'ont pas pu être envoyées. Voulez-vous réessayer ? »*
- Bouton `[Réessayer]` ou `[Plus tard]`

L'agent peut continuer à travailler. Pas de blocage.

#### RR6 — Stockage limité
Les photos uploadées sont **supprimées du local** dès que confirmées par le serveur. La queue reste légère (10-20 photos max typique).

Limite : si la queue dépasse 50 photos en attente (incident grave de réseau), l'app suggère de réessayer manuellement quand wifi disponible.

### Anti-patterns réseau

| Anti-pattern | Pourquoi non |
|---|---|
| ❌ « Connexion perdue » modal | L'agent ne peut rien y faire. Stress inutile |
| ❌ « Veuillez vérifier votre connexion » | Le téléphone le sait déjà |
| ❌ Bloquer la prise photo en l'absence de réseau | C'est l'inverse de la valeur — la queue locale doit absorber |
| ❌ Demander à l'agent de « synchroniser » manuellement | C'est le job du système |
| ❌ Indicateur d'upload sur chaque photo | Bruit visuel permanent |

### Le sentiment de fiabilité

Le test : *« j'ai pris 12 photos sur un site sans réseau. Le lendemain, le superviseur les voit. »*

Si ce test passe sans intervention agent, la philosophie réseau est juste.

---

## 6. La validation superviseur — fluidité sans bureaucratie

### La cible

Le superviseur fait sa tournée mentale chaque soir (ou matin) :
1. Voit la liste des interventions à valider
2. Tape sur une → voit photos + checklist + anomalies
3. Tape `Valider` → fait
4. Passe à la suivante

**Temps cible : 30 secondes par intervention validée.**

### L'écran de validation

```
┌────────────────────────────────────────────────────────┐
│  ← Validations à faire (4)                             │
├────────────────────────────────────────────────────────┤
│                                                        │
│  CHU Tour B · ce matin 8h-10h                          │
│  Mehdi + Karim · 12 photos · 0 anomalie                │
│  [VOIR DÉTAIL →]                                       │
│                                                        │
│  Banque Centrale · cet après-midi                      │
│  Sofia · 8 photos · 1 anomalie ⚠                       │
│  [VOIR DÉTAIL →]                                       │
│                                                        │
│  ...                                                   │
└────────────────────────────────────────────────────────┘
```

Tap `VOIR DÉTAIL` → écran de validation :

```
┌────────────────────────────────────────────────────────┐
│  ← CHU Tour B · 8h-10h · Mehdi + Karim                 │
│                                                        │
│  Checklist (4/4 ✓)                                     │
│   ✓ Vidage poubelles                                   │
│   ✓ Désinfection sanitaires                            │
│   ✓ Nettoyage couloir                                  │
│   ✓ Aération                                           │
│                                                        │
│  Photos (12)                                           │
│  [grille de vignettes — tap pour zoom]                 │
│                                                        │
│  Anomalies (0)                                         │
│                                                        │
│  Commentaire (facultatif)                              │
│  [_______________________________]                     │
│                                                        │
│  [VALIDER]    [DEMANDER CORRECTION]                    │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Les 7 règles de la validation

#### V1 — Pas de signature électronique
Validation = `validator_id + timestamp + commentaire optionnel`. Pas de e-IDAS, pas de double-validation, pas de workflow multi-niveau. **Suffisant pour ISO9001.**

#### V2 — Commentaire toujours optionnel
Le superviseur AJOUTE du contexte s'il veut. Jamais imposé.

#### V3 — Bouton `Demander correction` est une **note douce**, pas une sanction
Click → modal :
```
Que faut-il corriger ?
[texte libre court]
[Envoyer à Mehdi]
```
L'agent reçoit une notif (non-anxiogène, format email-equivalent) : *« Le superviseur demande à compléter : refaire photo après désinfection sanitaires. »*

**Pas de "rejet"**, pas de "non-validation". Juste une demande de complément.

#### V4 — Pas de score, pas de note
Le superviseur ne donne pas de note à l'intervention. Pas d'étoiles. Pas de "satisfaction de la prestation". L'engagement compliance se calcule depuis les agrégats, pas depuis un jugement individuel.

#### V5 — Validation rapide en bulk autorisée
Si 5 interventions sont impeccables → un menu **`Valider toutes`** disponible (avec mini-confirm visuel inline, pas de modal). Le superviseur n'a pas besoin de tap × 5.

#### V6 — Anomalies visibles distinctement, pas alarmantes
Une intervention avec anomalie est **affichée différemment** (icône `⚠` discrète, fond légèrement teinté), mais **pas en rouge agressif**. Le superviseur sait sans paniquer.

#### V7 — Pas de notifications push
Le superviseur **vient** voir les validations à son rythme. Pas de "12 nouvelles validations !" qui interrompt sa journée.

### La sensation cible pour le superviseur

> *« Je fais ma revue du soir, ça prend 5 minutes, je vois tout, je valide tout, je tag les exceptions. C'est fluide. »*

Pas :

> *« J'ai 47 trucs à traiter en attente, je suis débordé, je vais devoir justifier les retards. »*

---

## 7. Anti-patterns terrain — comment tuer l'adoption

### Catalogue exhaustif

#### A1 — Login répété
❌ Login email + password à chaque ouverture, expiration courte
✅ Session longue (30 jours), biométrie (Touch ID / FaceID) si disponible, code PIN à 4 chiffres comme fallback

#### A2 — Tutoriel obligatoire
❌ « Bienvenue ! Voici comment utiliser l'app — étape 1/12 »
✅ Premier écran immédiatement utilisable. Onboarding zéro. (Optionnel : tooltip discret au premier tap, dismissable)

#### A3 — Permissions cumulatives
❌ « L'app demande accès à : caméra, localisation, contacts, photos, microphone, calendrier, notifications »
✅ Demande caméra uniquement, au premier usage. Notifications : refusé MVP. Localisation : refusé. Le reste : refusé.

#### A4 — Notifications anxiogènes
❌ Push : « 3 anomalies non remontées depuis hier »
✅ Pas de push notifications MVP. Si essentiel V1.1 : digest matinal calme (« Bonjour, 3 missions aujourd'hui »).

#### A5 — Formulaires longs
❌ « Pour signaler cette anomalie : description (200 mots min), zone affectée, photo, témoin, action prise, ETA résolution »
✅ Catégorie + photo + voice optional + envoyer. 4 actions max.

#### A6 — Compteurs / progression visibles
❌ « Vous êtes à 67% de votre journée », « 3/5 missions », barres progressives
✅ État présent uniquement (« mission active », « à venir »). Pas de quantification permanente.

#### A7 — Gamification
❌ Badges « Champion photo du mois », streaks « 12 jours sans anomalie »
✅ Aucune gamification. L'agent fait son métier, pas un jeu vidéo.

#### A8 — Timers visibles
❌ « Vous avez 8 minutes pour terminer cette tâche »
✅ Aucun chrono. Le téléphone affiche déjà l'heure dans la status bar. C'est suffisant.

#### A9 — GPS / localisation explicite
❌ Bandeau « Position activée », icône GPS visible
✅ Pas de GPS du tout MVP. Si V2 : localisation au moment de la photo seulement, sans indicateur visible. Donnée jamais affichée à l'agent.

#### A10 — Comparaisons interpersonnelles
❌ « Vous avez pris 23% de photos en moins que la moyenne équipe »
✅ Aucune comparaison. Aucun ranking. L'agent n'est jamais mesuré vs ses collègues.

#### A11 — Demandes de justification
❌ Modal « Pourquoi cette tâche n'est pas faite ? Champ obligatoire »
✅ Champ commentaire optionnel. Si vide → pas de jugement.

#### A12 — Settings / Profile cachés
❌ Hamburger menu → Settings → Préférences → Mon profil → Sécurité → ...
✅ **Aucun menu**. Aucun settings. L'admin gère tout côté backoffice.

#### A13 — Mises à jour intrusives
❌ « Une nouvelle version est disponible — installer maintenant »
✅ Update silencieuse via PWA. L'agent ne voit jamais "version".

#### A14 — Confirmations excessives
❌ « Êtes-vous sûr de vouloir terminer cette intervention ? »
✅ Action faite = action enregistrée. Réversible si besoin via support.

#### A15 — Interface adaptive « intelligente »
❌ « Comme vous semblez fatigué, voulez-vous une pause ? »
✅ L'app est PASSIVE. Elle obéit, elle ne diagnostique pas l'agent.

#### A16 — Design « jeune et fun »
❌ Emojis partout, gifs animés, palette flashy, langage cool
✅ Sobre, professionnel. L'agent est un professionnel, pas un ado.

#### A17 — Questions de feedback
❌ « Notez votre intervention sur 5 étoiles », « Comment s'est passée la journée ? »
✅ Aucun feedback demandé. L'agent fait son job, pas un sondage.

---

## 8. Le test ultime — 2 minutes cognitives

### Le test produit immuable

> Un agent fatigué, sous pression, avec mauvais réseau, doit pouvoir :
> - comprendre sa mission
> - prendre ses preuves
> - signaler un problème
> - terminer son intervention
>
> en moins de **2 minutes cognitives** distribuées sur la durée de l'intervention.

### Décomposition concrète des 2 minutes

| Action | Temps cible |
|---|---|
| Ouvrir l'app, voir mission active | 5 sec |
| Démarrer la mission | 5 sec |
| Photo 1 (vidage poubelles, après) | 5 sec |
| Photo 2 (sanitaires, avant) | 5 sec |
| Photo 3 (sanitaires, après) | 5 sec |
| Photo 4 (couloir, après) | 5 sec |
| Valider tâche aération sans photo | 3 sec |
| (Anomalie si applicable : type + photo + envoyer) | 30 sec |
| Terminer mission | 5 sec |
| **Total avec anomalie** | **~70 secondes** |
| **Total sans anomalie** | **~40 secondes** |

Marge confortable sous les 2 minutes. **Le système doit garantir cette enveloppe en toutes conditions** (réseau pourri, gants mouillés, fatigue).

### Test de stress

L'app doit être testée par des agents réels dans les conditions extrêmes :
- 6h du matin, métro chargé, gants
- Sous-sol parking, 3G
- Sortie d'intervention, pluie, mains pleines
- Fin de journée, 2e job, fatigue

**Si le test passe dans ces conditions, l'app est prête.**

### Les 4 phrases de l'agent

À récolter en feedback qualitatif après 1 mois d'usage :

#### ✅ Phrases qui valident le produit
- *« Je sais où j'en suis tout de suite. »*
- *« Mes photos sont là quand je rentre. »*
- *« Quand il y a un problème, je peux dire. »*
- *« J'oublie que je l'utilise. »* ← **le saint graal**

#### ❌ Phrases qui invalident le produit
- *« Ça me ralentit. »*
- *« J'ai peur de me tromper. »*
- *« Je ne comprends pas. »*
- *« Je l'utilise parce qu'on me dit. »*

Si dans le pool de testeurs, plus de 20% prononcent une des phrases d'invalidation, retour à la planche à dessin.

---

## 9. La sensation produit recherchée

### L'objectif émotionnel

L'agent doit ressentir l'app comme :

| Métaphore | Description |
|---|---|
| **Un carnet de note** | Simple, fiable, à portée. On note, on referme, on oublie qu'il existe. |
| **Un appareil photo** | On l'allume, on prend, c'est fait. Pas de réflexion sur l'outil. |
| **Une carte de pointage moderne** | Objective, neutre, équitable. Pas de jugement. |

L'agent doit NE PAS ressentir :

| Métaphore négative | Description |
|---|---|
| **Un superviseur dans la poche** | Regard permanent qui évalue |
| **Un formulaire administratif** | Bureaucratie qui ralentit |
| **Un jeu vidéo gamifié** | Niaiserie qui infantilise |
| **Un outil de sécurité d'entreprise** | Contrôle paranoïaque |

### Les 5 sentiments cibles

#### S1 — Soulagement
*« Avant je devais tout retenir, maintenant l'app garde la trace. »*

#### S2 — Sécurité
*« S'il y a un problème, j'ai la preuve que j'ai fait. »*

#### S3 — Discrétion
*« L'app ne me dérange pas, elle est juste là quand j'en ai besoin. »*

#### S4 — Compétence
*« Je sais m'en servir sans hésitation. »*

#### S5 — Respect
*« On me considère comme un pro, pas comme un enfant à surveiller. »*

---

## 10. Décisions consolidées

| # | Sujet | Décision validée |
|---|---|---|
| 1 | Nombre d'écrans dans l'app | ✅ 3 maximum (missions / mission active / camera-anomalie) |
| 2 | Boutons taille minimum | ✅ 56px (gants) — 64px pour critiques |
| 3 | Login fréquence | ✅ Session longue + biométrie + PIN fallback |
| 4 | Tutoriel onboarding | ✅ Aucun |
| 5 | Permissions demandées | ✅ Caméra uniquement |
| 6 | Notifications push | ✅ Aucune MVP |
| 7 | GPS / localisation | ✅ Aucune MVP |
| 8 | Confirmations modal | ✅ Aucune (« êtes-vous sûr » banni) |
| 9 | Compteurs / progression | ✅ Aucun (pas de barre de progression, pas de %) |
| 10 | Gamification | ✅ Refusée totalement |
| 11 | Comparaison interpersonnelle | ✅ Refusée totalement |
| 12 | Settings / Profile / Help | ✅ Inaccessible côté agent |
| 13 | Photo : preview confirmée | ✅ Non — direct retour mission |
| 14 | Photo : crop / filtre | ✅ Aucun — brut serveur |
| 15 | Photo : classification par agent | ✅ Refusée — contexte impose |
| 16 | Queue locale upload | ✅ Oui, silencieuse, retry exponentiel |
| 17 | Validation : signature e-IDAS | ✅ Refusée — timestamp + user_id suffit |
| 18 | Validation : score / étoiles | ✅ Refusé — agrégats SQL only |
| 19 | Vocabulaire ERP | ✅ Banni de l'app agent |
| 20 | Test produit ultime | ✅ 2 minutes cognitives par intervention |

---

## 11. Implications pour le plan d'implémentation

Le plan d'impl à venir doit intégrer ces principes :

1. **Architecture mobile = web responsive d'abord**, PWA en V1.1. Pas d'iOS/Android natif jamais.
2. **Pas de service worker / offline-first complexe MVP** — queue localStorage simple suffit
3. **Tests utilisateurs réels** avec agents sur le terrain avant chaque release majeure
4. **Component library séparée** pour l'UI agent (pas de mélange avec UI desktop)
5. **Tailwind constraints** : palette neutre + accent unique, taille de boutons minimale forcée par lint
6. **Wording lint** : les mots ERP/audit (« compliance », « manquement », « performance », « score ») bannis dans tout composant `(agent)/*`
7. **Photos : capture immédiate sans modal**, queue locale via IndexedDB, retry background
8. **Sessions longues** : 30 jours, biométrie, PIN
9. **Aucune route accessible** depuis l'app agent vers les vues desktop (Settings, Admin, etc.)
10. **Test ultime des 2 minutes** doit être validé en QA avant chaque release

---

## 12. Ce qui doit aller dans la review code

À chaque feature ajoutée à l'app agent, le reviewer doit vérifier explicitement :

- [ ] Pas plus de 3 écrans atteignables (pas de nouveau path)
- [ ] Aucune permission ajoutée
- [ ] Aucune notification push
- [ ] Aucune popup de confirmation
- [ ] Aucun timer / compteur visible
- [ ] Aucun ranking / comparaison
- [ ] Aucune mention de GPS / localisation
- [ ] Aucun vocabulaire ERP (« compliance », « performance », etc.)
- [ ] Boutons critiques ≥ 64px
- [ ] Le test des 2 minutes cognitives passe sur cette feature
- [ ] Une des 4 phrases d'invalidation NE PEUT PAS être déclenchée

---

## 13. Validation

Sous-spec validé pour conception par l'utilisateur le 2026-05-10.

**Prochaine étape recommandée** : invoquer `superpowers:writing-plans` pour produire le plan d'implémentation Phase 1 + amorcer la Phase 2 (app agent terrain) en intégrant :
- Le spec principal `engagement-loop-design.md`
- Le sous-spec cockpit `engagement-cockpit-design.md`
- Le sous-spec agent terrain (ce document)

Le plan d'impl doit séquencer :
1. Phase 1 : extraction engagements + cockpit minimal (4-6 sem)
2. Phase 2 : data model field + app supervisor desktop + premières missions (4-6 sem)
3. Phase 3 : **app agent terrain** avec philosophie de ce document (3-4 sem)
4. Phase 4 : rapport mensuel + boucle complète (3-4 sem)
5. Phase 5 V1.2 : cross-tender matching + le moat (4-6 sem)

Avant ce plan, possibilité de spec-er encore :
- D — Format photo détaillé (anti-fraude, métadonnées, droit à l'image)
- E — Rapport mensuel client (templates IA agrégative, export PDF)

Mais la matière disponible est désormais probablement suffisante pour entamer le plan.
