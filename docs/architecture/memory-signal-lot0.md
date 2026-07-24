# Lot 0 — Doctrine des signaux de mémoire

Statut : doctrine validée, non encore branchée sur le dashboard.

Ce document fixe le vocabulaire et les invariants du futur flux transversal de
signaux. Il ne crée ni table, ni migration, ni nouveau détecteur.

## 1. Finalité

Un signal n'est pas un KPI, une copie d'un objet métier ou une phrase d'écran.
C'est la détection explicite d'une situation remarquable dans la mémoire d'un
chantier : fragilité, oubli, contradiction, priorité ou santé.

Les objets métier restent l'autorité : actions, décisions, échéances, réserves,
visites, réunions, preuves et documents. Un signal ne les remplace jamais.

## 2. Contrat cible

```ts
type MemorySignal = {
  id: string
  organizationId: string
  siteId: string

  category:
    | 'priority'
    | 'fragility'
    | 'promise'
    | 'question'
    | 'contradiction'
    | 'staleness'
    | 'health'

  severity: 'info' | 'warning' | 'critical'
  state: 'active' | 'acknowledged' | 'resolved' | 'dismissed' | 'expired'
  actionability: 'direct' | 'investigate' | 'observe'
  origin: 'rules' | 'mixed' | 'ai'

  title: string
  explanation: string
  sources: SourceRef[]
  suggestedAction: SuggestedAction | null

  confidence: number | null
  dedupeKey: string

  detectedAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
}
```

`SourceRef` doit toujours identifier l'objet source et son lien. Une action
suggérée doit porter son type, son libellé et son lien ou sa mutation autorisée.

## 3. Invariants

1. Un objet métier normal n'est pas automatiquement un signal.
2. Un signal n'existe que parce qu'une règle explicite a détecté une situation.
3. Un signal ne remplace jamais son objet source.
4. Un écran ne crée ni ne résout implicitement un signal.
5. Toute origine `mixed` ou `ai` expose ses sources.
6. `confidence` est `null` pour une règle purement déterministe.
7. Une même `dedupeKey` met à jour le signal existant au lieu d'en créer un autre.
8. Les droits viennent de l'organisation et des objets métier, jamais du signal.
9. `priority` est réservé aux gestes directement réalisables.
10. Un signal `investigate` ou `observe` ne doit jamais entrer dans « À faire maintenant ».

## 4. Consommation par surface

### Ce qui mérite votre attention aujourd'hui

Catégories : `fragility`, `promise`, `question`, `contradiction`, `staleness`,
`health`.

Actionnabilité acceptée : `investigate`, `observe`, et `direct` lorsqu'un geste
de résolution existe.

Ce panneau explique ce qui devient fragile, incohérent, oublié ou douteux. Il ne
doit pas devenir une seconde liste d'actions.

### À faire maintenant

Catégorie : `priority` uniquement.

Actionnabilité : `direct` uniquement.

Limite : cinq éléments maximum, triés par urgence, impact, proximité d'un
passage et ancienneté. Une recommandation non directement exécutable reste dans
« Attention » ou dans la préparation de visite.

## 5. Conversion de l'existant — Lot 1

| Détecteur actuel | Signal cible | Remarque |
| --- | --- | --- |
| Action en retard | `priority` et éventuellement `staleness` | `priority` seulement si un geste direct est disponible |
| Conflit de planning | `fragility` | Réutiliser le détecteur planning existant |
| Réserve ouverte remarquable | `fragility` | Ne pas signaler toute réserve normale |
| Visite terminée non traitée | `priority` | Seulement si l'arbitrage est directement accessible |
| Passage imminent | `priority` | Préparer ou ouvrir le passage |
| Action très ancienne | `staleness` | Peut devenir `priority` si une action directe est possible |
| Débrief en attente | `fragility` ou `priority` | Selon la présence d'un geste immédiat |
| Chantier fermé aujourd'hui | aucun signal par défaut | Événement informatif, pas anomalie |

Les moteurs actuels `attention.ts` et `now-dashboard.ts` restent la source de
comportement pendant cette migration. Le premier adaptateur devra préserver
leurs règles et leurs filtres d'organisation avant de changer le rendu.

## 6. Cycle de vie

La persistance n'est pas introduite au Lot 0.

Pour chaque règle future, la fiche de conception devra préciser :

- recalculable ou non ;
- persistée ou non ;
- condition de résolution automatique ;
- condition de réouverture ;
- expiration éventuelle ;
- clé de déduplication.

Exemples de doctrine :

```text
Action en retard
- recalculable : oui
- persistée : non au départ
- résolue : action terminée ou date déplacée
- réouverte : nouvelle date dépassée
```

```text
Promesse non confirmée
- recalculable : partiellement
- persistée : oui, après validation du détecteur
- résolue : confirmation explicite ou preuve compatible
- réouverte : nouvelle promesse équivalente sans confirmation
```

## 7. Origine des signaux

- `rules` : comparaison déterministe de faits structurés et de dates ;
- `mixed` : rapprochement de plusieurs faits, avec toutes les sources visibles ;
- `ai` : interprétation ou hypothèse, jamais une nouvelle vérité métier.

Une interprétation IA doit pouvoir être affichée comme telle et ne peut pas
transformer silencieusement un signal en décision, action ou état confirmé.

## 8. État actuel du code

Le dépôt possède déjà un ancien moteur éphémère dans
`lib/memory/signals/types.ts`, utilisé par plusieurs surfaces. Il décrit des
états de continuité (`continuity_stable`, `unusual_silence`, etc.) et ne doit
pas être supprimé ni renommé dans ce lot.

La migration vers le contrat cible devra donc commencer par un adaptateur et un
inventaire des consommateurs. Il ne faut pas créer une deuxième table ou
fusionner silencieusement les deux contrats avant cette étape.

## 9. Critère de sortie du Lot 0

Une personne extérieure au développement doit pouvoir répondre sans ambiguïté :

- pourquoi un signal existe ;
- où il apparaît ;
- ce que l'utilisateur peut faire ;
- comment il vieillit ;
- comment il disparaît ;
- comment il évite les doublons ;
- quelle autorité il possède.

La prochaine étape est l'inventaire des consommateurs de l'ancien moteur, puis
la construction d'un adaptateur déterministe pour `attention.ts` et
`now-dashboard.ts`. Aucun nouveau détecteur IA ne doit être ajouté avant cela.

## 10. Raffinement du contrat avant le Lot 2

Le contrat cible ne doit pas enfermer le métier dans un titre, une explication
ou une action unique d'interface. La version de référence ajoute :

```ts
type OperationalSignal = {
  id: string
  organizationId: string
  siteId: string
  category: SignalCategory
  trigger:
    | 'old_action' | 'open_reserve' | 'missing_company' | 'missing_contact'
    | 'missing_attachment' | 'planning_conflict' | 'promise' | 'question'
    | 'contradiction' | 'staleness' | 'health' | 'imminent_passage'
    | 'overdue_deadline'
  severity: 'info' | 'warning' | 'critical'
  importance: 'critical' | 'high' | 'normal' | 'low'
  urgency: 'now' | 'today' | 'week' | 'later'
  state: SignalState
  actionability: 'direct' | 'investigate' | 'observe'
  origin: 'rules' | 'mixed' | 'ai'
  facts: SignalFact[]
  rules: SignalRule[]
  sources: SourceRef[]
  actions: SuggestedAction[]
  presentations: SignalPresentation[]
  confidence: number | null
  dedupeKey: string
  detectedAt: string
  acknowledgedAt: string | null
  resolvedAt: string | null
  resolvedBy: SignalResolution | null
}
```

`facts` et `rules` sont la matière métier. `presentations` est une projection
par surface et peut être vide au niveau du moteur. `actions[]` remplace
`suggestedAction` afin qu'un signal puisse proposer plusieurs gestes : traiter,
écarter, reporter, comparer, rattacher ou ouvrir une source.

`trigger` explique la cause métier du signal. `importance` et `urgency` sont
séparées : un sujet peut être important sans être urgent, ou urgent sans être
stratégique. `resolvedBy` explique toujours la disparition d'un signal.
