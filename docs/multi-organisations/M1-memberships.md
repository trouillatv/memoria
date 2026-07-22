# M1 — Appartenances multiples

**Date** : 2026-07-22 · **Migration** : `233_organization_memberships.sql` (appliquée)

Décision métier : **AGP et SERVINOR sont deux entités juridiques distinctes**.
Modélisées comme deux `organizations`, jamais comme deux agences.

---

## 1. État avant M1

| | |
|---|---|
| Lien utilisateur ↔ organisation | **Aucune table** — une colonne, `users.organization_id` (mig 089:26) |
| Plusieurs appartenances ? | **Impossible** — `users.id` est la clé primaire |
| Rôle | `users.role` (enum `user_role` : `admin`, `manager`, `chef_equipe`, mig 001) — **global au profil** |
| `getOrgId()` | rendait `user.organization_id`, avec `catch { return null }` |
| Fallback « première organisation » | **Aucun** — il n'y en avait jamais qu'une |
| Invitations | `createUserInOrgAction` → `assignUserToOrg` = **UPDATE** de la colonne |

**Le défaut central** : `assignUserToOrg` faisait un **déplacement**, pas un
ajout. Inviter Guillaume dans SERVINOR l'aurait **retiré d'AGP, en silence**.

## 2. Modèle livré

```
organization_memberships
  id               uuid PK
  user_id          uuid → users(id)          ON DELETE CASCADE
  organization_id  uuid → organizations(id)  ON DELETE CASCADE
  role             user_role NOT NULL         ← le rôle vit ICI
  status           text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','suspended'))
  created_at, updated_at
```

**Contraintes**

- `UNIQUE (user_id, organization_id)` — l'invariant qui rend les invitations
  idempotentes, y compris sur appels concurrents.
- Index partiels sur `user_id` et `organization_id` où `status = 'active'`.
- RLS activée, politique « je lis mes propres appartenances ». **Second filet
  seulement** : le service-role contourne la RLS, le cloisonnement réel est
  applicatif.

## 3. Helpers — `lib/auth/memberships.ts`

| Primitive | Rôle |
|---|---|
| `getOrganizationMembershipsOfUser()` | Appartenances **actives** + rôle |
| `getOrgIdsOfUser()` | Identifiants accessibles — **lectures agrégées M3 uniquement** |
| `requireOrganizationMembership(orgId)` | Auth + appartenance active → rend le rôle |
| `requireOrganizationRole(orgId, roles)` | Idem + rôle attendu |
| `getSoleOrgIdOrThrow()` | L'organisation unique, ou une erreur — jamais un choix |

Fichier **neuf** : `lib/auth/require.ts` est en cours de modification par une
autre session, il n'a pas été touché.

## 4. L'invariant fondamental

`getOrgId()` **lève** `OrganisationAmbigueError` dès qu'un compte a plus d'une
appartenance active.

Rendre l'organisation « par défaut » ferait écrire dans AGP une donnée saisie
pour SERVINOR — **sans erreur, sans trace, invisible jusqu'à l'audit**.

⚠️ **Le piège qui a failli passer** : la version précédente enveloppait toute la
fonction dans `catch { return null }`. L'ambiguïté serait devenue un `null`. Or
de nombreuses gardes s'écrivent :

```ts
if (orgId && objet.organization_id !== orgId) notFound()
```

Un `null` y **désactive le contrôle**. L'erreur aurait été une **faille**. La
fonction a donc été restructurée : le `catch` n'entoure plus que la lecture de
session, avant tout calcul d'appartenance. Verrouillé par test.

## 5. Compatibilité mono-organisation

**Comportement rigoureusement inchangé.** Aucun écran nouveau, aucun choix
d'entreprise, aucune régression : tant qu'un compte n'a qu'une appartenance,
`getOrgId()` répond exactement comme avant.

Mesuré : **17 comptes migrés**, chacun avec son organisation et son rôle. Le
compte sans organisation (1) n'a reçu **aucune** appartenance — lui en donner
une serait lui ouvrir un accès que personne ne lui a accordé.

## 6. Invitations

`assignUserToOrg(userId, orgId, role?)` **ajoute** désormais une appartenance
(`upsert` sur `user_id,organization_id`) au lieu de déplacer le compte.

Le rôle n'est réécrit que s'il est fourni : réinviter quelqu'un ne doit pas lui
retirer silencieusement des droits accordés par un administrateur.

## 7. Dette transitoire assumée

`users.organization_id` et `users.role` **survivent**.

| | |
|---|---|
| Qui **écrit** | `assignUserToOrg` (mono seulement), `updateUserProfileAsAdmin` |
| Qui **lit** | `getOrgId()` — **193 appels** — et les gardes de rôle existantes |
| Quand ça disparaît | Quand M2/M3 auront migré ces lecteurs |
| Invariant anti-divergence | Pour un compte **mono**, colonne et appartenance coïncident (M1 écrit les deux). Pour un compte **multi**, la colonne cesse de faire autorité et `getOrgId()` refuse de répondre. |

Le claim JWT `app_metadata.organization_id` reste mono-organisation. **Il n'est
pas une autorisation** — les gardes relisent l'appartenance en base.

## 8. Preuves

### Contre la base réelle

```
=== 1. REPRISE DES COMPTES EXISTANTS ===
  PASS — 17 comptes avec organisation -> 17 appartenances
  PASS — chaque appartenance reprend le role et l organisation du profil

=== 2. CAS GUILLAUME : deux entreprises, deux roles ===
  PASS — un seul compte porte DEUX appartenances
  PASS — roles differents selon l entreprise (AGP=manager, SERVINOR=chef_equipe)

=== 3. DOUBLON INTERDIT ===
  PASS — un second (user, org) identique est REFUSE par la base

=== 4. APPARTENANCE SUSPENDUE = AUCUN ACCES ===
  PASS — la suspendue disparait des appartenances actives
  PASS — mais la ligne existe toujours (historique preserve)

=== NETTOYAGE ===
  PASS — Guillaume retrouve sa seule appartenance AGP
```

L'organisation d'essai et l'appartenance créées ont été supprimées : **la base
est revenue à son état initial**.

### Tests de doctrine

`tests/doctrine/multi-organisations-m1.doctrine.test.ts` — **15/15**.

### Échecs PRÉ-EXISTANTS, hors de ce lot

- `dashboard-role-gates` : `sites/[id]/visites/[visitId]/recit/page.tsx` n'a
  **aucun contrôle de rôle**. Vient du commit **`78567aac`** (autre session).
  ⚠️ **Un chef d'équipe y entre en tapant l'URL.** À corriger, hors M1.
- `site-documents-guard` (×3) : marqués `|integration|`, hors du projet `unit`
  joué par la CI.

## 9. Limites volontaires de M1

Non traité, réservé à M2 et suivants :
`site_actions` / `site_decisions` / `site_intervenants` /
`site_action_events`.`organization_id` · notifications · badges · filtre
Toutes/AGP/SERVINOR · pages Aujourd'hui, Chantiers, Actions · contexte
d'écriture depuis le chantier · URL signées · PDF · recherche agrégée.

**Aucun** des 193 appels à `getOrgId()` n'a été remplacé.

## 10. Réservé à M2

1. Combler le modèle hybride (les 4 tables sans `organization_id`), avec
   trigger d'héritage depuis le chantier — le motif existe déjà
   (`set_intervention_child_org`, mig 114).
2. **M2 avant M3** : agréger des lectures au-dessus de tables non cloisonnées
   reviendrait à bâtir la vue multi-org sur la partie non protégée.
