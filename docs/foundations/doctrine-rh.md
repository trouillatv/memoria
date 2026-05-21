# Doctrine RH — La frontière à ne pas franchir

> **Le sujet grammatical est toujours la mémoire, jamais la personne.**
>
> Si une phrase de l'UI pourrait être prononcée par un RH dans un entretien annuel, elle est hors-doctrine.

**Date** : 2026-05-22
**Statut** : Doctrine fondatrice. Verrou produit irrévocable.

---

## Le périmètre refusé

MemorIA **n'est pas** :

- ❌ **Un ERP RH** — pas de paie, pas de congés, pas de fiches de poste
- ❌ **Un outil de pointage** — pas d'heure d'arrivée / départ par personne, pas de timetracking
- ❌ **Un outil de GPS / géolocalisation** — pas de suivi temps réel des agents
- ❌ **Un outil de surveillance comportementale** — pas de heatmap individuelle exploitée comme métrique
- ❌ **Un outil de scoring** — pas de note, classement, ranking entre agents
- ❌ **Un dashboard KPI startup** — pas de « productivité par tête »
- ❌ **Un outil de pré-recrutement** — pas de matching candidat / poste
- ❌ **Un outil d'entretien annuel** — pas de notes longitudinales sur individus

---

## Le test des 4 questions (anti-RH déguisé)

Avant de livrer toute feature qui parle d'une personne, poser les 4 questions :

1. **Est-ce qu'un RH pourrait l'utiliser pour décider de garder ou de virer quelqu'un ?**
2. **Est-ce qu'un manager pourrait l'utiliser pour préparer un entretien annuel ?**
3. **Est-ce qu'une comparaison côte à côte entre 2 personnes est techniquement possible avec ça ?**
4. **Est-ce que l'UI fait apparaître un chiffre interprétable comme « performance » ?**

Si la réponse est **oui à une seule**, refus.

---

## Les transgressions assumées

Certaines features s'approchent dangereusement de la ligne RH. Elles ne sont autorisées **que sous garde-fous techniques explicites** qui rendent la transgression visible et auditable.

### Cas 1 — Page Agent / Intervenants (transgression 2026-05-20)

**Pourquoi transgresser** : Guillaume (pilote) a besoin de voir « qui connaît quel site » pour gérer la continuité opérationnelle. Pas vu = continuité cassée.

**6 garde-fous techniques obligatoires** :

1. **Audit log obligatoire** à chaque consultation
2. **Pas de score numérique calculé** — chiffres descriptifs uniquement (compteurs, dates)
3. **Pas de comparaison côte à côte** — 1 page = 1 personne, jamais 2
4. **Wording strictement descriptif** — aucun adjectif évaluatif
5. **Kill switch ENV** (`INTERVENANTS_PAGE_ENABLED`) — désactivable en 1 minute
6. **Tripwire allowlist** — les agrégats par `user_id` sont **confinés** à `lib/db/intervenants.ts`. Tout autre fichier qui le tente fait échouer le test CI `forbidden-symbols.test.ts`.

### Cas 2 — Continuité anticipée (Sprint E, différé)

Anticiper la fin d'un CDD pour préparer la passation. Doctrine stricte :

- ✅ « Le contrat de Joseph se termine le 14 juin »
- ✅ « 3 sites portent une mémoire opérationnelle liée à cette équipe »
- ✅ « Préparer une passation avant le 14 juin ? »
- ❌ « Risque de départ », « agent critique »
- ❌ « Préparer son remplacement »
- ❌ « Anticiper la rupture »

Le sujet grammatical doit toujours être **la mémoire** ou **le site**, jamais la personne.

**Différé** parce que même avec la doctrine, le risque de glissement perceptif est élevé : MemorIA pourrait devenir perçu comme *« le système qui sait qui va partir »*. Cette perception, une fois installée, est irréversible.

---

## La règle d'ouverture payante

Toute transgression doctrinale livre **dans le même changement** :

- Le garde-fou CI (test automatique)
- La doc dans `EVOLUTION_CONCEPTUELLE.md`
- L'audit log de consultation
- Le kill switch si applicable

> *« On ne re-litige pas sous pression terrain. »*

Une feature qui ouvre une ligne rouge sans poser ses garde-fous CI dans le même commit est refusée.

---

## Tripwires CI

Tests automatiques qui font échouer la CI si certains symboles apparaissent dans le code hors des allowlists :

### `forbidden-symbols.test.ts`
Interdit dans tout `app/**` et `lib/**` (sauf allowlist `lib/db/intervenants.ts`) :

- `agentScore`, `agentRanking`, `agentPerformance`
- `criticalAgent`, `agentRisk`, `replacementScore`, `departureRisk`
- `userPerformance`, `staffScore`, `productivityScore`
- `getTeamCharge`, `getTeamLoad`, `getTeamSaturation`
- `getTeamPerformance`, `getTeamProductivity`, `getTeamCompletionRate`
- `getActivityByMember`

### `planned-time-no-rh-aggregation.test.ts`
*« `planned_*` est un ancrage de prestation, JAMAIS un pointage personne. »*

Vérifie qu'on n'agrège jamais `planned_start` / `planned_end` par `user_id`.

---

## Le vocabulaire qui passe et celui qui glisse

### ✅ Vocabulaire neutre (descriptif)
- *« Sites couverts »*, *« interventions documentées »*, *« anomalies traitées »*
- *« Équipe Alpha »* (jamais « l'équipe de Mehdi »)
- *« A travaillé sur ce site »*
- *« Continuité opérationnelle »*
- *« Mémoire portée par cette équipe »*

### ❌ Vocabulaire évaluatif (à bannir)
- *« Performant »*, *« productif »*, *« efficace »* appliqué à une personne
- *« Top X »*, *« meilleur »*, *« moins bon »*
- *« Risque »*, *« critique »*, *« faible »* appliqué à une personne
- *« Score »*, *« note »*, *« évaluation »*

---

## Pourquoi cette ligne est protégée si fort

Le pilote est en Nouvelle-Calédonie, dans le nettoyage. Le secteur a une **culture sociale très spécifique** : forte représentation syndicale, vigilance sur la surveillance, sensibilité aux dérives RH. Une feature perçue comme « flicage » :

- Tue le projet en interne immédiatement (rejet équipes terrain)
- Peut générer du contentieux prudhommal
- Détruit la confiance en MemorIA durablement

Au-delà de la NC, c'est une **règle universelle** : un outil de mémoire opérationnelle qui glisse vers le RH **change de catégorie** et **perd sa promesse centrale**. Le moat disparaît.

---

## Le verrou hors-UI

L'UI peut être doctrinale, **le code ne peut pas empêcher l'usage abusif hors-UI**. Si Guillaume :
- Screenshote une heatmap Intervenants et l'envoie sur WhatsApp à un autre manager
- Dit en réunion *« regardez les chiffres de X dans MemorIA »*
- Communique un compteur individuel à un agent

… il **casse doctrinalement le produit** en 2 phrases.

**Le verrou final est humain.** L'UI protège, l'audit log enregistre, mais la discipline d'usage reste à la charge du dirigeant. C'est pour ça que le **MODE_EMPLOI.md** insiste lourdement sur la doctrine et que le pilote est limité à un cercle restreint et discipliné.

---

## Refus en bloc

> **Toute proposition produit qui ressemble à de la RH déguisée est refusée par défaut.**
>
> **La burden of proof est sur celui qui propose la transgression.**
>
> **Et même validée, la transgression livre ses garde-fous CI dans le même changement.**

---

## Liens

- [Vision Produit](vision-produit.md) — la non-RH comme pilier identitaire
- [Continuité opérationnelle](continuite-operationnelle.md) — où la frontière est testée
- [Passation](passation.md) — application stricte (self exclu)
- [Doctrine mémoire](doctrine-memoire.md) — discipline d'apparition liée
