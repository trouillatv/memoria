# M2 — Clôture de lot (multi-organisations, cloisonnement)

**Date** : 2026-07-22 · **Statut** : CLOS · **Branche** : `main` (`…97c9d310`)

Ce document arrête officiellement le périmètre M2. Il énumère ce qui est couvert,
les invariants obtenus, et ce qui reste **volontairement** hors périmètre — pour
qu'aucun sujet déjà arbitré ne soit rouvert par erreur.

---

## 1. Contexte

Un humain = un compte = N `organization_memberships` (le rôle est porté par le
membership, pas par `users.role`). La sécurité ne vient PAS de la RLS : le dépôt
accède par le service-role qui la contourne. **Le cloisonnement réel est
applicatif.** `getOrgId()` (l'org par défaut du profil) **lève**
`OrganisationAmbigueError` dès qu'un compte a ≥ 2 memberships actifs : l'erreur
DÉSIGNE chaque endroit à contextualiser.

---

## 2. Ce qui est couvert

### M1 — socle d'appartenance
`organization_memberships` (mig 233), primitives `lib/auth/memberships.ts`
(`requireOrganizationMembership`, `getOrgIdsOfUser`, `getSoleOrgIdOrThrow`).
`getOrgId()` lève au-delà d'une appartenance. `assignUserToOrg` devenu additif.

### M2A — invariant structurel (mig 234)
`sites.organization_id` NOT NULL ; `organization_id` ajouté et **maintenu par
trigger** sur `site_actions`, `site_decisions`, `site_intervenants`,
`site_action_events` ; FK composites `(site_id, organization_id)`. Un objet enfant
ne peut pas diverger de l'org de son chantier.

### M2B — frontière de LECTURE (`lib/auth/resource-access.ts`)
UN moteur : `resolveResourceAccess({kind, id})` → org **de la ressource** →
membership actif. Aucune exemption de rôle (plateforme ≠ métier). `unauthenticated`
≠ `not_found` ; refus uniforme 404, sans oracle. Kinds : `site`, `client`,
`mission`, `intervention`, `contract`, puis `site_action` et `site_report` (M2C).
Remplace les 3 primitives ad hoc de P0/P0.5 (`site-access.ts` supprimé).

### M2C — frontière d'ÉCRITURE (`lib/auth/site-write-access.ts`)
**Doctrine tenue partout** :

> ressource → org de la ressource → membership actif → politique de rôle
> EXISTANTE (le rôle *dans l'org*) → mutation.

Primitives : `requireSiteWriteAccess`, `requireSiteActionWriteAccess`,
`requireSiteReportWriteAccess`, `requireContractWriteAccess`. Politiques
`operator` (= admin/manager/chef_equipe) et `managerOrAdmin` — **aucun nouveau
RBAC**, seule la SOURCE du rôle change (membership, pas `users.role`).

| Surface | Fichier | Ce qui a été fermé |
|---|---|---|
| 1 | `m/visite/[reportId]/debrief-actions.ts` | pattern A (`getOrgId` ×10) |
| 2 | `m/visite/[reportId]/cr/cr-concretisation-actions.ts` | pattern B (`user.organization_id`) |
| 3 | `(dashboard)/actions/actions.ts` | 2 patterns **+ 7 gestes sans frontière** |
| 4 | `sites/[id]/views/intervenants/intervenants-actions.ts` | `requireSiteInOrg` + 2 recherches |
| 5a | `sites/[id]/reserves/actions.ts` | **4 écritures sans frontière** |
| 5b | `m/site/[siteId]/report-actions.ts` | **~16 gestes** (pipeline CR) + résolveur `site_report` |
| 5c | `meetings/actions.ts`, `meetings/[id]/share-actions.ts`, `m/meeting-actions.ts` | delete + distributions |

---

## 3. Invariants obtenus

1. **Aucune écriture du domaine chantier ne dépend de l'org du caller.** L'org
   vient toujours de la ressource, résolue côté serveur.
2. **Un compte multi-organisations écrit dans ses deux entreprises** — sans
   « organisation active », sans `OrganisationAmbigueError` sur ces surfaces.
3. **Un non-membre est refusé** (et un membership suspendu aussi), refus uniforme.
4. **Lecture et écriture partagent le même moteur d'org** ; seule la politique
   diffère (lecture = membership ; écriture = membership + rôle).
5. **`tenant_id` n'est JAMAIS une frontière d'autorisation.** Preuve dynamique :
   il diffère de `organization_id` sur **48 des 53** comptes-rendus — le prendre
   aurait été une fuite inter-tenants massive. Le résolveur `site_report` lit
   `organization_id`, avec repli sur le site (M2A) ou le contrat.
6. **~25 IDOR d'écriture inter-tenants** (gestes role-only, sans aucune frontière)
   découverts et fermés (surfaces 3, 5a, 5b).

**Preuves** : typecheck PASS · 84 tests doctrine (`tests/doctrine/{m1,m2a,m2c-*,resource-access}`)
· build de production PASS · preuves dynamiques contre la base réelle par surface.

---

## 4. Hors périmètre — VOLONTAIRE, ne pas rouvrir sans décision

### M3 — vues agrégées (décidé, non commencé)
Les gestes **sans ressource de contexte** (signature `()`) ne peuvent pas résoudre
d'org depuis une ressource ; on **n'invente pas** d'organisation active. Classés
M3 et **annotés dans le code** : `listActiveTeamsForPlanningAction`,
`cleanupDraftMeetingsAction`, `listMeetingSitesAction`. Idem les surfaces de
lecture agrégée `/dashboard` (11 loaders), `/sites`, `/actions` (~113 sites
`getOrgId` au total).

**Décision produit (Vincent, 2026-07-22)** : vues multi-org =
**AGRÉGATION + ÉTIQUETTE d'organisation** par ligne (`getOrgIdsOfUser()` →
`.in('organization_id', ids)`, badge AGP/SERVINOR). **Aucune organisation active
implicite.** Ordre retenu : **dashboard d'abord**, pas les 113 loaders d'un coup.
Conséquence assumée : `/dashboard` reste en erreur pour un compte multi-org tant
que M3 n'est pas fait.

### 5d — audit de complétude (séparé, non bloquant)
Les autres fichiers `meetings/*` (curation, ask, memory, pv-actions) n'ont pas de
pattern « org du caller », mais peuvent porter des écritures role-only à border.
C'est un **audit**, pas un bloqueur identifié : à traiter après M3.

---

## 5. Prochaine étape

Après **validation fonctionnelle navigateur** (mono-org + multi-org : lecture,
création, modification, clôture, réouverture, réserves, meetings), ouvrir
**M3 — Dashboard** selon la doctrine ci-dessus.
