# M3 — Planning (`/semaine`, `/mois`) — Audit (LECTURE SEULE, aucun code)

**Date** : 2026-07-22 · **Statut** : audit préalable. **Verdict : DÉCOUPAGE.**

## 1. Inventaire `getOrgId()` (direct + transitif)

Un seul `getOrgId` **direct** dans les routes (`semaine/page.tsx:151`) ; le reste est
**transitif** (leçon AttentionBlock). Graphe des appels :

```
semaine/page.tsx ─ getOrgId() [l.151] ── fetchMissionOptions/fetchSiteOptions/fetchTeamMemberCounts(orgId)
                 ├ getWeekBySite(range) ── listInterventionsForWeek(range, orgIds?) ── getOrgId() [fallback]
                 ├ getWeekByTeam(range) ─────────────────────────────────────────── getOrgId() [week-planning:273]
                 ├ getWeekVigilance() ──────────────────────────────────────────── getOrgId() [week-vigilance:54]
                 └ getWeekOperationalSignals() ─────────────────────────────────── getOrgId() [week-operational-signals:111]

mois/page.tsx ─ user.organization_id [l.280] ── fetchMission/Site/TeamMemberCounts(orgId)   (org PAR DÉFAUT, incomplet)
              └ buildMonthRows / buildTeamMonthRows ── getOrgId().catch(()=>null) [month-view:53,271]  ← FUITE
```

## 2. Lecture vs écriture

### LECTURES (affichage des pages) — toutes `getOrgId`, AGRÉGEABLES
| Fonction | Fichier | Comportement multi-org actuel |
|---|---|---|
| `getWeekByTeam` | week-planning.ts:273 | `getOrgId()` → **lève** |
| `listInterventionsForWeek` | week-planning.ts:94 | déjà `orgIds?` (lot dashboard) ; fallback `getOrgId` lève |
| `getWeekVigilance` | week-vigilance.ts:54 | `getOrgId()` → **lève** |
| `getWeekOperationalSignals` | week-operational-signals.ts:111 | `getOrgId()` → **lève** |
| `buildMonthRows` / `buildTeamMonthRows` | month-view.ts:53,271 | `.catch(()=>null)` → `null` → **FUITE inter-tenants** (comme l'ancien getAttentionDigest) |
| `fetchMissionOptions/SiteOptions/TeamMemberCounts` | plan-menu-data.ts | reçoivent `orgId` de la page (`.eq`) → la page doit passer les orgIds |
| `listTeams` | teams.ts | `getOrgId` (à confirmer au codage) |

`semaine/page` **lève** (getOrgId l.151, 2 memberships) → **/semaine est cassé pour Vincent**.
`mois/page` ne lève pas (utilise `user.organization_id`) mais **n'affiche qu'UNE org** + `buildMonthRows` **fuit**.

### ÉCRITURES (3 fichiers, ~6 server actions) — résolveur de RESSOURCE, pas d'agrégation
`moveInterventionToDayAction`, `createInterventionFromWeekAction`,
`reassignInterventionTeamAction`, `updateInterventionTimeAction`,
`resolveConflictAction`, `revertOccurrenceAction` — toutes :
`requireManagerOrAdmin()` (rôle) **puis** `requireOwned(role, table, id)` (org DE LA RESSOURCE).

**Le pattern est CORRECT** (l'écriture n'hérite JAMAIS de l'agrégation : `requireOwned`
lit `organization_id` de l'objet muté). Mais `lib/auth/ownership.ts` :
- **l.39 — exemption admin** : `if (role === 'admin') return { allowed: true }` → **viole
  la doctrine M2C** (plateforme ≠ métier). Vincent (admin) peut aujourd'hui écrire sur
  une intervention SERVINOR sans contrôle.
- **l.41 — `getOrgId()`** pour les non-admins → **lève** pour un manager multi-org.

**`requireOwned` est TRANSVERSE : 24 fichiers / ~8 domaines** (planning, contrats, missions,
interventions, sites, roulements, field, partage, import). Le corriger dépasse largement
`/semaine` et `/mois`.

## 3. Comportement CIBLE par page (ton critère)

- **Lecture** → **agrégation unique multi-org** (`getOrgIdsOfUser()` + `.in`). `/semaine` et
  `/mois` affichent les interventions des DEUX organisations, fusionnées.
- **Écriture** → **organisation déterminée par la RESSOURCE** (`requireOwned` lit l'org de
  l'intervention/mission mutée). **Jamais** héritée de l'agrégation. C'est déjà le pattern —
  il faut le rendre membership-aware (org de la ressource ∈ orgs de l'utilisateur) et
  retirer l'exemption admin.

## 4. Devenir des `orgIds?` transitoires

`listInterventionsForWeek(range, orgIds?)` et `getWeekBySite(range, orgIds?)` (ajoutés au lot
dashboard) : dans le lot Lecture, `/semaine` et `/mois` **passeront `orgIds`** → ces params
deviennent la voie normale. Une fois **tous** les appelants migrés (dashboard ✅ + planning),
le **fallback `getOrgId()` peut être retiré** et le param rendu **requis** — cleanup final,
pas maintenant. **Verdict : dual-mode LÉGITIME jusqu'à la fin de la migration lecture.**

## 5. Estimation

- **Lot A — Lectures planning** : 2 pages + ~6 fonctions de lecture sur 5 fichiers
  (week-planning `getWeekByTeam`, week-vigilance, week-operational-signals, month-view [+fuite],
  plan-menu-data, teams) + tests (agrégation + non-fuite `buildMonthRows`). Comparable au
  Dashboard. **Borné.**
- **Lot B — migration `requireOwned`** : 1 helper partagé, **24 fichiers / 8 domaines** de
  répercussion comportementale + `ownership-policy.ts` (test pur) + retrait exemption admin.
  **Transverse, NON borné à planning.** C'est l'item M2 « requireOwned » différé.
- **Lot C — resserrage `orgIds?`** : retirer le fallback + param requis, une fois A fait.
  Petit, **dernier**.

## 6. VERDICT — DÉCOUPER

`/semaine` et `/mois` ne tiennent PAS dans un lot unique. Trois lots indépendants et
prouvables séparément :

1. **Lot A (recommandé, prochain)** — Lectures → agrégation. Débloque l'AFFICHAGE de
   `/semaine` + `/mois` pour Vincent (les écritures fonctionnent déjà via l'exemption admin).
   Borné, même discipline que le Dashboard.
2. **Lot B (séparé, fondation)** — `requireOwned` membership-aware + retrait exemption admin.
   **Lot de SÉCURITÉ transverse** (ferme « admin écrit dans n'importe quelle org »), pas un
   lot planning. À auditer pour lui-même avant de coder.
3. **Lot C (final)** — resserrer les `orgIds?`, à l'audit final M3.

**Aucune ligne de code écrite. En attente de ta décision sur l'ordre.**
