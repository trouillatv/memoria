# Doctrine — Pouvoir plateforme ≠ accès métier

> **Le rôle plateforme administre MemorIA. Il ne donne AUCUN accès aux données
> métier d'une organisation. L'accès à un chantier passe TOUJOURS par une
> appartenance active à son organisation — y compris pour un super-admin
> plateforme.**

## Deux dimensions indépendantes, cumulables, jamais substituables

```
Vincent Trouillat
├── pouvoir PLATEFORME  (users.role = admin)   → administrer MemorIA (/admin/*)
└── appartenances MÉTIER (organization_memberships)
    ├── AGP       → admin      → ouvrir les chantiers AGP
    └── SERVINOR  → manager    → ouvrir les chantiers SERVINOR
```

Un compte est puissant parce qu'il **cumule** ces deux dimensions — pas parce
que l'une remplace l'autre. Retirer un membership retire l'accès métier
correspondant, quel que soit le rôle plateforme.

## Ce qui a été retiré

`userCanAccessSite` contenait `if (user.role === 'admin') return true`. Cette
ligne transformait l'administration **technique** de MemorIA en accès
**universel** aux données de toutes les entreprises clientes. Retirée.

Conséquence directe : pour déboguer comme Guillaume, un administrateur doit
recevoir les **mêmes appartenances** que lui — il ne contourne plus la
frontière par son rôle. C'est plus sûr *et* plus fidèle : le débogage se fait
dans les conditions réelles de l'utilisateur.

## La règle d'accès à un chantier

```
utilisateur authentifié
+ appartenance ACTIVE à l'organisation du chantier
  (le rôle de cette appartenance décidera des permissions fines en M2)
```

Aucune exemption de rôle. Le seul `return true` sans appartenance concerne un
chantier **sans organisation** — qui ne peut pas fuiter entre organisations.

## Ce qui n'est PAS traité ici (dette explicite)

`lib/auth/ownership.ts` · `requireOwned` exempte encore `role === 'admin'`, et
sert des dizaines de surfaces non-chantier (clients, contrats, planning…). Le
mobile y passe via `requireSiteAccess` — c'est pourquoi le mobile a reçu en plus
une garde `userCanAccessSite` explicite, qui n'exempte aucun rôle. **M8**
réexaminera l'exemption admin transversale de `requireOwned`.

## Mode support (non implémenté)

Un accès de support exceptionnel — organisation choisie explicitement,
journalisé, borné dans le temps — reste possible plus tard. Il sera **séparé et
visible**, jamais un rôle qui ignore silencieusement la frontière. Le besoin de
debug actuel est couvert par les appartenances réelles.

## Preuve dynamique (5 scénarios)

```
1. admin plateforme SANS membership AGP → AGP : 404   (+ /admin accessible)
2. admin plateforme + membership AGP     → AGP : 200
3. multi-org AGP+SERVINOR                → les deux : 200 / 200
4. admin d'ORG AGP (membership.role=admin) sans SERVINOR → SERVINOR : 404
5. conducteur AGP → AGP : 200 · SERVINOR : 404 (aucune fuite)
```

Comptes de test créés puis supprimés. `vincent.trouillat` a reçu les
appartenances **AGP=admin + SERVINOR=manager** (persistées) ; son comportement
multi-org est prouvé par `multiorg.test`, de configuration identique — le vrai
compte le confirmera à sa prochaine connexion (son mot de passe n'est pas connu
du banc de test).
