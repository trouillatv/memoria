# Promesses structurées dans le dashboard — V1

## Objectif

Faire apparaître dans « Ce qui mérite votre attention aujourd’hui » les engagements futurs structurés qui sont soit échus, soit suffisamment anciens pour nécessiter une confirmation, sans nouvelle analyse IA et sans transformer automatiquement une échéance en promesse.

## Périmètre validé

Pipeline unique :

```text
sources persistées structurées
→ getStructuredPromiseRecords()
→ buildPromiseCandidates()
→ detectPromiseSignals()
→ presentAttentionSignals()
→ Attention
```

`À faire maintenant` ne consomme un signal de promesse que lorsqu’une action directe, réelle et suffisamment prioritaire existe. Il ne doit pas reproduire la formulation diagnostique du panneau Attention.

## Protocole commun des détecteurs

Le read model, le builder et les détecteurs restent des responsabilités séparées. Aucun détecteur ne lit la base, n’appelle l’IA, n’écrit en base ou ne construit une carte d’interface.

```ts
export interface MemorySignalDetector<TContext> {
  id: string
  version: string

  detect(context: TContext, now?: string): MemorySignal[]
}
```

Le pipeline d’exécution est :

```text
données persistées
→ read model
→ builder de contexte
→ détecteurs purs
→ merge
→ déduplication par dedupeKey
→ filtrage organisation / droits / état
→ MemorySignal[]
→ presenters
→ surfaces
```

L’orchestrateur exécute des détecteurs déjà alimentés. Il ne construit pas leur contexte et ne connaît pas les tables métier.

```ts
export function runSignalDetectors(
  registrations: DetectorRegistration[],
  now: string,
): MemorySignal[]
```

La V1 enregistre deux détecteurs sur le même `PromiseDetectionContext` : `PromiseExpired` et `PromiseNeedsConfirmation`. Un test transversal vérifie qu’un même candidat ne produit jamais les deux signaux.

La déduplication utilise uniquement `signal.dedupeKey`. Elle ne fusionne jamais à partir du titre, du texte ou d’une proximité sémantique. En cas de collision exacte, elle conserve la gravité la plus élevée et fait l’union des sources et actions ; aucune fusion de faits incompatibles n’est autorisée.

## Deux niveaux de signaux

Une date structurée est obligatoire pour diagnostiquer un retard, mais elle ne doit pas conditionner l’existence d’un signal de suivi.

### `PromiseExpired`

Produit par `PromiseDetector` lorsque :

- la promesse est explicitement qualifiée ;
- `dueAt` est connu, valide et porte un fuseau ;
- la date est dépassée ;
- aucune confirmation plus récente n’existe.

Le signal peut parler d’échéance dépassée ou de retard. Il ne doit jamais inventer une date.

### `PromiseNeedsConfirmation`

Produit par un détecteur indépendant lorsque :

- la ligne est explicitement qualifiée comme `promise` ;
- aucune confirmation plus récente n’existe ;
- l’engagement est suffisamment ancien selon une règle déterministe ;
- `dueAt` est absent ou non résolu.

Ce signal ne parle jamais de retard. Il utilise un vocabulaire de suivi : « Annonce à confirmer », « Engagement sans retour » ou « Information en attente ». Il permet de faire remonter « Le planning sera diffusé prochainement » ou « L’accès sera communiqué sous peu » sans déduire de date.

Il porte le même type métier `promise`, mais un déclencheur distinct :

```ts
{ type: 'promise', reason: 'promise_without_due_date' }
```

et reste `actionability: 'investigate'`.

## Sources admissibles

### `captured_knowledge`

Source principale lorsque :

- `kind = 'promise'` ;
- `status = 'active'` ;
- `id`, `organization_id`, `site_id`, `title`, `source_type`, `source_id` et `created_at` sont disponibles ;
- un `dueAt` structuré avec fuseau est fourni par le read model ;
- la source d’origine peut être résolue vers un `SourceRef`.

Le schéma actuel de `captured_knowledge` ne possède pas de colonne `dueAt`. Le read model ne doit donc pas lire la date dans `title` ou `body`, ni interpréter une phrase libre. Sans `dueAt`, la ligne ne produit pas de signal `PromiseExpired`, mais elle peut produire un signal `PromiseNeedsConfirmation` si elle est suffisamment ancienne et explicitement qualifiée.

### `site_knowledge_proposals`

Source secondaire uniquement pour les lignes :

- `kind = 'deadline'` ;
- `status = 'proposed'` ;
- `payload` contient une date ISO avec fuseau ;
- `payload` contient une qualification explicite d’engagement, par exemple `commitment = true` ou `temporalNature = 'promise'` ;
- la ligne n’est pas déjà promue, remplacée ou couverte par un objet métier suivi ;
- la source `report_id` ou une capture est résoluble.

Une échéance générique telle que « vérifier les installations électriques avant le 30 juillet » reste une échéance. Elle n’est pas transformée en promesse.

## Tableau de mapping V1

| Source | Colonnes / métadonnées | Qualification | Identité stable | `dueAt` | Source | Confirmation recherchée |
|---|---|---|---|---|---|---|
| `captured_knowledge` | `id`, `organization_id`, `site_id`, `kind`, `status`, `title`, `source_type`, `source_id`, `created_at` | `kind = 'promise'` | `captured_knowledge.id` | optionnel ; fourni par relation structurée, jamais extrait du texte | `source_type + source_id` | capture, visite, réunion ou objet métier postérieur explicitement confirmant |
| `site_knowledge_proposals` | `id`, `organization_id`, `site_id`, `kind`, `status`, `title`, `body`, `payload`, `report_id`, `source_capture_ids`, `dedupe_key`, `promoted_object_id` | `kind = 'deadline'` + `payload.commitment = true` ou `payload.temporalNature = 'promise'` | `site_knowledge_proposals.id` | `payload.dueAt` ISO avec fuseau | `report_id` ou capture source | proposition promue, preuve qualifiée confirmante ou objet métier postérieur |

## Règles du read model

`getStructuredPromiseRecords()` doit :

1. filtrer par organisation et chantier autorisés ;
2. conserver l’identifiant persistant de la ligne source ;
3. construire une `SourceRef` cliquable ;
4. refuser toute date sans fuseau ou invalide pour `PromiseExpired` ;
5. ne jamais reconnaître une promesse depuis `title` ou `body` ;
6. séparer les preuves liées des preuves confirmantes ;
7. rechercher les confirmations plus récentes ;
8. exclure les lignes résolues, rejetées, remplacées ou déjà concrétisées ;
9. dédupliquer une même promesse provenant des deux sources ;
10. ne lancer aucun appel IA.

Si les données actuelles ne fournissent pas de `dueAt` structuré, le résultat doit rester exploitable via `PromiseNeedsConfirmation`, sans jamais produire un diagnostic de retard.

## Déduplication

La priorité est donnée à une identité métier persistante. Une même promesse ne doit pas produire deux candidats lorsqu’elle est représentée dans `captured_knowledge` et dans une proposition `deadline`.

La déduplication doit utiliser, dans cet ordre :

1. une référence explicite vers la même source ou le même objet ;
2. une clé métier persistée (`dedupe_key`) ;
3. à défaut, aucune fusion sémantique automatique n’est autorisée en V1.

Une collision incertaine doit conserver les deux éléments plutôt que fusionner silencieusement des engagements différents.

## Signal Attention

Une promesse échue et non confirmée produit un signal :

```ts
{
  category: 'promise',
  trigger: { type: 'promise', reason: 'promise_expired' },
  actionability: 'investigate',
  origin: 'rules',
  sources: [source],
  actions: [
    'Confirmer',
    'Ce n’est plus d’actualité',
    'Créer une action',
    'Voir la source',
  ],
}
```

Une promesse ancienne sans date produit un signal distinct :

```ts
{
  category: 'promise',
  trigger: { type: 'promise', reason: 'promise_without_due_date' },
  actionability: 'investigate',
  origin: 'rules',
}
```

Le Presenter Attention affiche, pour `PromiseExpired` :

- « Promesse non confirmée » ;
- le sujet précis ;
- le chantier et l’organisation ;
- le retard ;
- la dernière information ;
- la raison de remontée ;
- les gestes effectivement disponibles.

Pour `PromiseNeedsConfirmation`, il affiche à la place :

- « Annonce à confirmer » ou « Engagement sans retour » ;
- la dernière mention et sa date ;
- l’absence de confirmation plus récente ;
- aucun retard et aucune date inventée ;
- les gestes effectivement disponibles.

Le texte complet du compte-rendu n’est pas recopié dans la carte.

## À faire maintenant

Un signal de promesse peut être projeté dans `À faire maintenant` uniquement si :

- il est bloquant ou urgent ;
- une action directe est définie ;
- cette action est autorisée et réellement exécutable ;
- elle se classe dans les cinq priorités.

Attention explique la fragilité. À faire maintenant propose le geste. Les deux projections ne doivent pas afficher la même phrase.

## Résolution

La confirmation ne modifie jamais le récit historique. Elle crée une trace métier ou une preuve explicitement confirmante. Le prochain calcul exclut alors le signal.

Les causes de résolution attendues sont :

- confirmation explicite ;
- preuve qualifiée comme confirmant l’accomplissement ;
- objet métier terminé lorsque ce lien est explicitement établi ;
- rejet humain comme « sans objet », avec raison conservée.

Une photo simplement liée ne résout jamais une promesse.

## Tests de recette

Les tests doivent couvrir :

1. promesse structurée échue → signal Attention ;
2. promesse future → aucun signal ;
3. date sans fuseau → aucun candidat ;
4. échéance générique sans qualification → aucun signal de promesse ;
5. preuve liée uniquement → signal conservé ;
6. preuve confirmante → signal absent ;
7. promesse ancienne sans date → `PromiseNeedsConfirmation` ;
8. proposition rejetée, promue ou remplacée → aucun signal ;
9. identité stable conservée après modification du texte ;
10. organisation étrangère → aucun candidat ;
11. absence de `dueAt` structuré sur `captured_knowledge` → aucun `PromiseExpired`, mais possibilité d’un `PromiseNeedsConfirmation` ;
12. `PromiseNeedsConfirmation` ne mentionne jamais de retard ni de date inventée.

## Hors périmètre

- ajouter `promise` à la contrainte de `site_knowledge_proposals` ;
- extraire une promesse depuis un texte libre ;
- lancer une IA à l’ouverture du dashboard ;
- déduire un fuseau ou une date depuis une expression relative ;
- construire un nouveau workflow propre au dashboard ;
- ajouter les notifications ou la persistance des signaux.
- historiser une résolution via `MemoryEvent` ; cette extension sera traitée avec le stockage réel de la résolution.
