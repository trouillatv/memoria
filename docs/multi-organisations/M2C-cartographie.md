# M2C — Cartographie exhaustive des écritures du domaine chantier

**Date** : 2026-07-22 · **Statut** : audit préalable, AUCUNE modification.

## Le recadrage : ce n'est PAS `requireOwned`

Contrairement à l'hypothèse de départ, **le domaine chantier n'utilise pas
`requireOwned`** (0 occurrence dans ses fichiers). Les 21 `requireOwned` sont
ailleurs (planning, contrats, missions, teams) — hors périmètre M2C.

Le domaine chantier garde son isolation par **deux patterns** qui reposent tous
deux sur l'org du CALLER, pas de la ressource :

| Pattern | Où | Comportement multi-org |
|---|---|---|
| **A** — `getOrgId()` + `if (orgId && res.org !== orgId)` | debrief-actions (×10), actions/actions.ts (×1) | **LÈVE** (`getOrgId` throw) → l'écriture casse |
| **B** — `user.organization_id !== res.org` | actions/actions.ts (×1), cr-concretisation (×1) | compare à l'**org par défaut** → refus/passage à tort |

**~13 points**, concentrés. Le pattern A explique pourquoi tes écritures de
visite sont cassées en multi-org aujourd'hui : `getOrgId()` lève avant même la
comparaison.

## La migration, uniforme

Les deux patterns deviennent la même chose : **vérifier l'appartenance à l'org
de la ressource** (déjà chargée, `res.organization_id` disponible), via la
politique `write` (membership actif + rôle existant `requireFieldAgent` /
`requireManagerOrAdmin`, inchangée).

```
AVANT (pattern A)          AVANT (pattern B)          APRÈS (M2C)
getOrgId() → orgId         user.organization_id       requireSiteWriteAccess(
if (res.org !== orgId)     if (res.org !== u.org)       res.site_id)  // membership
  refus                      refus                       + politique write
```

L'org ne vient plus du caller. Plus de `getOrgId()`, plus de comparaison à la
colonne scalaire. Un compte multi-org écrit dans ses deux organisations.

## Tableau exhaustif

### `app/(field)/m/visite/[reportId]/cr/debrief-actions.ts` — mobile, `requireFieldAgent`

| Server action | Ressource | Garde actuelle | Garde M2C |
|---|---|---|---|
| `getVisitDebriefFieldAction` | visite | A (l.314) | membership sur `visit.organization_id` |
| `getActionProposalStatesAction` | visite | A (l.351) | idem |
| `getDeadlineProposalStatesAction` | visite | A (l.372) | idem |
| `promoteActionProposalAction` | visite→action | A (l.394) + passe org (l.402) | membership ; passer `visit.organization_id` |
| `dismissActionProposalAction` | visite→action | A (l.438) + passe org (l.444) | idem |
| `promoteStakeholderProposalAction` | visite→intervenant | A (~l.601) | idem |
| `deleteVisitAction` | visite | A (l.491) | membership |
| `finalizeVisitAction` | visite | A (l.528) | membership |
| `getVisitSummaryAction` | visite | A (l.567) | membership |

> Note : plusieurs de ces actions sont des LECTURES (`get…`) — leur `getOrgId`
> les casse aussi en multi-org. M2C les couvre au même titre (la frontière est
> la même en lecture ou écriture ; seule la POLITIQUE diffère). Les passages
> `organizationId: orgId ?? visit.org` deviennent `visit.organization_id`
> (l'org de la ressource) — et le trigger M2A la pose de toute façon à la
> création.

### `app/(dashboard)/actions/actions.ts` — desktop, `requireManagerOrAdmin`

| Server action | Ressource | Garde actuelle | Garde M2C |
|---|---|---|---|
| `planActionAction` / `createQuickActionAction` | site | A (l.422→430) | membership write sur `site.id` |
| `closeActionAction` / `reopenActionAction` / `markActionProgressAction` / `snoozeActionAction` / `cancelActionAction` / `associateActionToElementAction` | action→site | à confirmer par lecture fine | membership write via `action.site_id` |
| `listActiveTeamsForPlanningAction` | (liste d'aide) | scope `getOrgId` (l.255) | **À TRANCHER** — voir §Point ouvert |

### `app/(dashboard)/sites/[id]/views/intervenants/intervenants-actions.ts` — desktop

| Server action | Ressource | Garde | Garde M2C |
|---|---|---|---|
| `associateContactAction` (crée site_intervenant) | site | `requireManagerOrAdmin` + scope `getOrgId` (l.24) | membership write via `site.id` |
| `searchOrgContactsAction` / `searchIntervenantTargetsAction` | (recherche org) | scope `getOrgId` | **À TRANCHER** (recherche d'aide) |

### `app/(field)/m/visite/[reportId]/cr/cr-concretisation-actions.ts` — mobile

| Server action | Ressource | Garde | Garde M2C |
|---|---|---|---|
| `createFromCrAction` / `prepareCrConcretisationAction` | visite→site | B : `visit.org !== user.org` (dans `open()`) | membership sur `visit.organization_id` |

### `reserves/actions.ts`, `report-actions.ts`, `meetings/*` — 0 `getOrgId`

Ces fichiers créent des objets enfants **sans garde d'org explicite** : ils
s'appuient sur `requireFieldAgent`/`requireManagerOrAdmin` (rôle) et le contexte.
Depuis M2A, l'org des objets créés est posée par trigger. **À vérifier au
codage** qu'aucune de leurs écritures n'accepte un `reportId`/`siteId` étranger
sans garde de membership — sinon ajouter la garde write (même pattern).

## Point ouvert à trancher

**Les listes/recherches d'aide** (`listActiveTeamsForPlanningAction`,
`searchOrgContactsAction`) scopent par `getOrgId()`. Ce ne sont pas des
écritures sur une ressource identifiée : ce sont des **lectures agrégées** qui,
pour un multi-org, relèveraient de `getOrgIdsOfUser()` (M3) OU devraient être
scopées par l'org du **chantier concerné** (si l'action reçoit un `siteId`).

- Si elles reçoivent le `siteId` du contexte → scoper par l'org de ce chantier (M2C).
- Sinon → les laisser à M3 (vue agrégée), hors M2C.

À confirmer par lecture de leur signature au moment du codage.

## Ordre d'exécution proposé (par surface, testable isolément)

1. **`debrief-actions`** (le gros, 10 points, pattern A homogène) — la surface
   qui casse le plus visiblement en multi-org.
2. **`cr-concretisation`** (pattern B).
3. **`actions/actions.ts`** (mutations d'action + le point ouvert teams).
4. **`intervenants-actions`** (+ point ouvert recherche).
5. **`reserves` / `report-actions` / `meetings`** — vérification + garde si
   nécessaire.

Chaque surface : migrer → prouver dynamiquement (multi-org écrit dans les deux
orgs, non-membre refusé) → commit. Pas de big-bang.

## Critères de sortie M2C

- Domaine chantier : `grep getOrgId = 0` dans ces fichiers ;
- pattern B (`user.organization_id !==`) supprimé du domaine chantier ;
- une primitive `requireSiteWriteAccess(siteId)` = membership actif **+**
  politique write existante (séparée de la lecture) ;
- `requireOwned` **intact** hors domaine chantier ;
- **compte multi-org : modifie une action AGP puis une action SERVINOR sans
  « active organization », sans OrganisationAmbigueError** (le test central) ;
- non-membre → refus ; membership suspendu → refus.
