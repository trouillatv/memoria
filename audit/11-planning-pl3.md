# 11 — PL3 : audit avant le signal « site fermé, prestation prévue »

> Audit 2026-07-13, demandé avant toute ligne de code. Tout est prouvé
> fichier:ligne. **Conclusion : le cœur de PL3 n'est PAS les cinq boutons —
> c'est le point de MATÉRIALISATION. Sans lui, PL3 afficherait des conflits sur
> lesquels aucun bouton ne pourrait rien faire.**

## Le trou de conception (le point n°1)

PL1 et PL2 projettent sur une période **arbitraire** (un mois, six mois) : les
occurrences y sont **virtuelles**, sans id. Or **les cinq gestes exigent tous
une intervention DÉJÀ MATÉRIALISÉE en base** :

| Geste | Action | Verrou qui bloque une occurrence virtuelle |
|---|---|---|
| Déplacer (avant/après) | `moveInterventionToDayAction` (semaine/actions.ts:173) | fetch `.eq('id', …)` → « Intervention introuvable » (l.202) |
| Changer l'horaire | `updateInterventionTimeAction` (semaine/actions.ts:840) | `z.string().uuid()` (l.829) |
| Décaler | `rescheduleInterventionAction` (intervention-actions.ts:395) | `getIntervention(id)` (l.408) |
| Annuler | `skipInterventionSupervisorAction` (:336) → `markInterventionSkipped` | `UPDATE … .eq('id', …)` (intervention-templates.ts:572) |

Une `ProjectedOccurrence` **n'a pas d'id** — c'est écrit dans
`projection.ts:69-72`. Chacun de ces gestes échoue donc au premier verrou.

Et le seul chemin de matérialisation existant est inutilisable pour PL3 :

1. **cap dur de 7 jours, qui `throw`** (`intervention-templates.ts:263-268`) —
   or un conflit à J+21 est le cas NORMAL (Guillaume regarde son mois) ;
2. **granularité fenêtre, pas occurrence** — il matérialise TOUT le scope ; il
   n'existe **aucun** `materializeOccurrence(...)` dans le dépôt (grep
   `materiali` → zéro résultat dans `lib/`).

**Ce qu'il faut créer** : `materializeOccurrence({ templateId, scheduledFor, slot })`
qui hérite mission/équipe/organisation (la logique existe déjà,
`intervention-templates.ts:326-343` et `368-388` — **à extraire, pas à recopier**),
contourne proprement le cap sans le supprimer pour la génération glissante, et
renvoie l'`id` que les actions existantes consommeront.

L'identité est déjà là : `occurrenceKey` (PL1) **est** l'index unique partiel de
la base `(template_id, scheduled_for, slot)` (mig 021:120). Matérialiser deux
fois la même occurrence est donc structurellement impossible.

## Les signaux : aucun n'est persisté, et c'est DOCTRINAL

Les trois moteurs (`week-vigilance`, `week-operational-signals`,
`lib/memory/signals/*`) sont **tous éphémères, recalculés à la lecture**. Il
n'existe **aucune table de signaux**. Deux règles gravées l'interdisent :

- `signals/types.ts:5-8` : « ÉPHÉMÈRE (jamais persisté comme vérité) » ;
- `week-operational-signals.ts:20-24` : « LECTURE SEULE. Un signal n'altère
  JAMAIS une intervention, ne déplace rien. Indicatif, jamais bloquant. »

**Conséquence pour PL3** : le conflit **se recalcule**
(`projectOccurrences` × `findClosureForDate`), il ne se stocke pas. **Seul le
GESTE s'écrit.** Créer une table `planning_conflicts` violerait frontalement ces
deux règles.

Corollaire gênant, à assumer : aucun signal existant ne peut être « ignoré »
durablement — ils disparaissent quand leur cause disparaît. « Décider plus
tard » n'a donc aucun support aujourd'hui.

## Ce que PL3 réutilise tel quel

Le calcul du conflit (PL1 × PL2 — et `findClosureForDate` rend **l'objet**, donc
le « pourquoi » est déjà disponible). Le geste par défaut :
`site_closures.default_resolution` (mig 197:56) — **posé exprès en PL2, lu par
personne**. Le pattern d'affichage : `WeekVigilanceSection` et son silence
positif (`if (total === 0) return null`). Les gestes eux-mêmes : « déplacer
avant » et « déplacer après » sont **la même action** avec deux dates ;
« annuler » = `markInterventionSkipped` ; « maintenir » = ne rien faire.

Et surtout le précédent le plus proche : **`visit_watchlist_item` (mig 196)** —
« signal détecté déterministiquement → matérialisé → l'humain pose un geste »,
avec un vocabulaire d'états déjà établi (`pending / verified / to_follow /
dismissed`). À reprendre plutôt qu'inventer un troisième vocabulaire.

## Ce que PL3 devra créer

1. **`materializeOccurrence`** — la brique manquante n°1 (ci-dessus).
2. **Une identité de conflit** — `${occurrenceKey}:${closureId}`. Aucun signal
   existant n'a d'identité stable (`WeekVigilance.tsx:78` reconstruit même sa clé
   React avec un `idx` — preuve que le conflit n'en a pas).
3. **« Maintenir »** — n'a **aucun support de persistance** : rien ne dit « on y
   va quand même malgré la fermeture ». Deux options honnêtes : matérialiser
   l'occurrence (elle devient « significative », `projection.ts:70-72`) sans
   autre marqueur ; ou ajouter une colonne — et alors c'est une migration à
   assumer. **Décision produit à prendre.**
4. **`cancelled`** — n'existe PAS (enum mig 018:34 :
   `planned|in_progress|completed|validated|skipped`). « Annuler pour cause de
   fermeture » et « on n'est pas passés » (`skipped`) sont deux verbes
   différents. Les confondre est un choix, pas une évidence. **Décision produit.**

## Risques de logique parallèle (à surveiller)

Il existe **déjà deux** moteurs de conflit : `findTeamSiteConflict` (bloquant, à
l'écriture) et `getWeekVigilance` (descriptif, à la lecture). PL3 en ajoute un
troisième — **il doit suivre le pattern lecture/éphémère**, sinon trois vérités.

Et il ne doit **pas** réécrire le déplacement : un geste maison contournerait la
garde d'appartenance, la détection de conflit d'équipe, le refus de date passée
et le journal d'audit. **Composer avec les actions existantes, ne pas les
dupliquer.**

Enfin, `notifications` n'est pas le bon canal (un seul type autorisé,
`feedback_reply`) : un conflit de fermeture est **contextuel à la vue planning**,
pas une notification personnelle.

**Aucune ligne de code n'a été écrite pour ce lot.**
