# P0 — Fermeture de la fuite inter-organisations (accès direct chantier)

**Date** : 2026-07-22 · **Indépendant de M2** · additif et étroit.

## La faille

Prouvée dynamiquement (`M1-recette-cartographie`) : un compte membre d'une
**autre** entreprise ouvrait un chantier par URL et en voyait le contenu.
`getSiteIdentity` — la primitive de lecture transversale du chantier, **40
appelants** — ne vérifiait aucune appartenance. Faille **pré-existante**, réelle
en prod, indépendante de M1.

## Où la garde est posée

**Dans la primitive**, pas dans chaque page — le seul point qui ferme les 40
voies d'un coup, sans risque d'en oublier une :

- `lib/db/site-cockpit.ts` · `getSiteIdentity` (38 appelants, dont la page racine)
- `lib/db/sites.ts` · `getSiteIdentity` (mobile + `site-overview`)

Toutes deux appellent `userCanAccessSite(siteId)` **avant tout SELECT métier**
et rendent `null` en cas de refus. Les appelants rendent `notFound()` sur
`null` — refus **404 uniforme**, indistinct d'un chantier inexistant : ni nom,
ni organisation, ni existence révélés.

## Le helper — `lib/auth/site-access.ts`

`userCanAccessSite(siteId)` :
1. Super-admin (`role === 'admin'`) → autorisé (doctrine `decideOwnership`).
2. Charge la **seule** info nécessaire — l'org du chantier.
3. Vérifie `requireOrganizationMembership(orgId)`.
4. Fail-closed : session absente, lecture en échec → refus.

**Pourquoi pas `requireOwned` directement** : il compare à `getOrgId()` (org
unique), qui **lève** pour un compte multi-org (M1). Le P0 vérifie
l'**appartenance** — vraie pour mono comme pour multi — pour que le compte
multi-org ouvre bien ses deux chantiers. C'est la version multi-org-ready de la
même frontière ; **M2 unifiera les deux gardes**.

## Voies fermées, une par une

| Voie | État |
|---|---|
| Page racine `/sites/{id}` | ✅ identité chargée d'abord, `notFound` avant les onglets |
| 26 sous-pages `(dashboard)/sites/[id]/*` | ✅ `notFound()` sur `null` (pattern uniforme vérifié) |
| `scopes/[scopeId]` | ✅ **corrigée** — affichait `identity?.name ?? 'Site'` et rendait les données ; ajout `if (!identity) notFound()` |
| PDF `journal/pdf`, `reserves/pdf` | ✅ `404` sur `null` avant rendu |
| Mobile `/m/site/{id}` | ✅ déjà gardé par `requireSiteAccess` (ligne 139, doctrine ownership) |
| `missions/{id}`, `meetings/{id}` (via `site_id`) | ✅ passent par `getSiteIdentity`, `null` géré |

## Preuve dynamique

Serveur de prod local, sessions réelles, comptes de test créés puis supprimés :

```
=== membre SERVINOR-only ouvre chantier AGP ===
  PASS — refus (HTTP 404)          (avant : 200 + nom rendu)
  PASS — AUCUNE fuite du nom
=== membre AGP ouvre chantier AGP ===
  PASS — accès autorisé (200)      (accès légitime préservé)
=== sous-routes AGP côté SERVINOR-only : racine, reserves, actions,
    documents, memoire, visites ===
  PASS — toutes 404, aucune fuite
=== CR de visite AGP côté SERVINOR-only ===
  PASS — 404, aucune fuite
=== non authentifié ===
  PASS — 307 → /login
>>> FRONTIÈRE FERMÉE, AUCUNE FUITE
```

Super-admin : exemption **codée** (suit `decideOwnership`, déjà éprouvée par le
mobile) ; non rejouée dynamiquement faute du mot de passe du compte `admin`.

## Ce que le P0 ne fait pas (reste M2)

- N'ajoute pas `organization_id` aux 4 tables enfants.
- Ne réécrit aucun des 193 `getOrgId()`.
- N'unifie pas `userCanAccessSite` et `requireOwned` — M2 le fera via un
  `requireSiteAccess` multi-org-ready unique.
- Ne garde pas les objets enfants accédés par leur propre ID sans passer par le
  chantier (M2, rattachement structurel).
