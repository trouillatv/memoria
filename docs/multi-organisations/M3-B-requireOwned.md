# M3-B — `requireOwned` : appartenance à l'org de la ressource, fin de l'exemption admin

**Date** : 2026-07-22 · **Statut** : IMPLÉMENTÉ · **Nature** : sécurité transverse (doctrine).

## Le problème (faille de doctrine ACTIVE)

`requireOwned` gardait les écritures de ~44 appels / 24 fichiers / 5 tables
(interventions, missions, teams, sites, clients). Mais `lib/auth/ownership.ts` +
`ownership-policy.ts` :
- **exemptaient `role === 'admin'`** → un admin plateforme écrivait sur la
  ressource de **n'importe quelle** organisation ;
- comparaient l'org de l'objet à `getOrgId()` (l'org PAR DÉFAUT du profil) → **levait**
  pour un compte multi-org non-admin.

C'était précisément le contournement que M2C devait fermer
([[isolation-tenants-fail-closed]] : plateforme ≠ métier).

## Le correctif — CONFINÉ à 2 fichiers, ZÉRO appelant modifié

Toutes les `OwnedTable` portent `organization_id` en direct → résolution uniforme,
pas de découpage par familles. Signature `requireOwned(role, table, id) →
OwnershipDecision` **inchangée** (les 24 appelants ne bougent pas ; `role` reste
pour la stabilité, ne sert plus à exempter).

```
requireOwned(_role, table, id)
 → lit organization_id DE LA RESSOURCE (déjà en place)
 → requireOrganizationMembership(objectOrgId)   (primitive M1 : session → membre actif ?)
 → decideOwnership({ objectOrgId, isMemberOfObjectOrg })
```

`decideOwnership` (pure, testée) ne connaît plus ni le rôle ni l'org du caller :
objet inexistant → refus ; orphelin → refus ; **non-membre → refus** (même message,
pas d'oracle) ; membre → autorisé. **Plus aucune exemption.** Plus aucun `getOrgId()`.

## Preuve

- Test pur `decideOwnership` + doctrine source (pas de `getOrgId`, pas de
  `role === 'admin'`) : 8/8.
- Tests voisins (equipe-meme-organisation, site-access) : 20/20.
- Typecheck PASS · build de prod PASS (les 24 appelants compilent).
- **Matrice dynamique contre la base réelle** :
  | Cas | Résultat |
  |---|---|
  | membre de l'org de la ressource | **AUTORISÉ** ✅ |
  | non-membre | **REFUS** ✅ |
  | **admin plateforme SANS membership** | **REFUS** ✅ — exemption FERMÉE |
  | compte multi-org sur une 3ᵉ org | **REFUS** ✅ |
  | objet inexistant / orphelin | **REFUS** ✅ |

## Impact

Toi (admin **+** membre AGP+SERVINOR) : écritures planning inchangées, désormais
**contrôlées par ton appartenance**. Un compte admin plateforme SANS membership
perd l'écriture métier — **voulu** (doctrine) ; lui donner un membership explicite
le rétablit.

## Suite

- **Lot A** — lectures `/semaine` + `/mois` (agrégation, fermeture de la fuite
  `buildMonthRows`). Les pages deviennent lisibles SANS s'appuyer sur une exemption.
- **Lot C** — resserrer les `orgIds?` (param requis, retrait des fallbacks) + audit final M3.
