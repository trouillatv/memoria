# 15 — PL4 (cycles) : PARQUÉ, et ce que l'audit a trouvé quand même

> Décision Vincent, 2026-07-13 : **PL4 est parqué.** La priorité passe aux cinq
> fiches canoniques (Action, Visite, Réunion, Document/Preuve, Recherche), parce
> qu'« on ne construit plus des écrans, on construit des objets métier que les
> écrans projettent » (cf. `audit/09-product-doctrine.md`).
>
> L'audit PL4 avait été lancé **avant** cette décision. Il est en lecture seule,
> **rien n'en a été implémenté**. Je consigne ici ses constats pour qu'ils ne se
> perdent pas — et parce que **l'un d'eux est un bug produit actif**.

## 🔴 LE BUG À CONNAÎTRE, indépendamment de PL4

**`missions.assigned_team_id` n'est écrit par AUCUN écran.**

- `updateMission` (`lib/db/missions.ts:90-97`) : le champ **n'est pas dans le
  type du patch** — donc aucun formulaire ne peut le poser.
- Aucune server action de `app/` ne l'écrit. Seuls les **scripts de seed** le
  font, et ils le disent : *« assigned_team_id n'est pas exposé par
  createMission — update direct »* (`scripts/dev/reset-and-seed-nc-demo.ts:590`).
- `lib/db/teams.ts:158` ne fait que le **remettre à NULL** à l'archivage.

**Conséquence en production** : l'héritage d'équipe codé dans
`lib/db/intervention-templates.ts:369-388` **ne se déclenche jamais**. Toute
intervention générée par un rythme naît **« Non-affectée »**, et un humain doit
la glisser à la main dans `/semaine`.

Autrement dit : **le planning ne dit pas QUI y va.** Ce n'est pas une limite de
PL4 — c'est cassé aujourd'hui, pour les rythmes comme pour tout le reste.

## Les autres constats (gelés, pas perdus)

**Le planning de Guillaume n'est pas représentable — pas « difficile » :
impossible.** Trois verrous :

1. **Cycle A/B impossible** : aucun `cycle_length_weeks`, `anchor_date`,
   `week_index`. Et `day_of_week` est **scalaire** (mig 021:32) → « lundi ET
   vendredi » demande déjà **deux** templates.
2. **`ends_on` n'est saisissable NULLE PART** : la colonne existe (021:35), elle
   est **lue partout** (projection, génération), mais **aucun écran ne l'écrit**.
   « Répéter jusqu'en décembre » est donc impossible — pour ~10 lignes de code.
3. **« Équipe A le lundi, équipe B le mardi » impossible** : `assigned_team_id`
   est sur la **mission**, jamais sur le template.

**Le parcours actuel pour créer UN rythme** : organisation → site → **contrat**
(exigé de fait par l'UI) → mission → *Contrats → le contrat → Missions → la
mission → Modifier → + Ajouter une récurrence* → 3 champs. Soit **4 objets sur 3
écrans**. Et pour sa semaine type, il faudrait répéter **six fois** — pour un
résultat **faux** (ses rythmes tomberaient toutes les semaines).

> C'est une explication très plausible du « 0 rythme actif » — mais elle reste
> une **hypothèse**, pas une preuve.

## Si PL4 repart un jour

**Option recommandée** : colonnes **additives** sur `intervention_templates`
(`cycle_length_weeks`, `anchor_date`, `week_index`, **optionnelles**) + un
en-tête léger `planning_cycles` pour nommer et éditer la semaine type.

Une seule ligne à ajouter dans `matchesFrequency`, **avant** le `switch` — les 5
branches existantes restent **intactes**, donc l'oracle de PL1 reste vert. Index
unique, idempotence, génération, RLS : **rien ne bouge**.

**À ne jamais faire** : changer la forme d'`occurrenceKey`. Elle **est** l'index
unique de la base (mig 021:120, alignée par la 198). La toucher, c'est perdre
l'idempotence et réécrire PL3.

**Aucune ligne de code PL4 n'a été écrite.**
