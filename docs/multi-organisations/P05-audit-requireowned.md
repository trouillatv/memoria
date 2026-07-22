# P0.5 — Audit borné de `requireOwned` et des accès par ID

**Date** : 2026-07-22 · **Objet** : vérifier qu'une fuite équivalente à celle
des chantiers (P0) n'est pas déjà active ailleurs. Pas d'architecture nouvelle.

## Ce que fait `requireOwned` (rappel)

`lib/auth/ownership.ts` → `decideOwnership` (pur, testé). Garde d'appartenance
sur les **écritures** (server actions). Règle : `objectOrgId === callerOrgId`,
sinon refus. **Seule exemption : `users.role === 'admin'`** (super-admin
plateforme). Un tenant (`manager`/`chef_equipe`) ne traverse **jamais** —
vérifié par `tests/lib/ownership-policy.test.ts` (« manager, objet d'un AUTRE
tenant → refusé »).

## 1-2. Appelants de `requireOwned`, classés

40 appels, 22 fichiers. **21 fichiers = écritures** (server actions),
**1 = lecture** (mobile).

| Famille | Appelants (écritures) | Lecture |
|---|---|---|
| `sites` | planning, calendrier, missions, closures, roulements, contracts, partage, import, m/site/*, memory, scheduled, visit | `lib/field/site-access.ts` (mobile) |
| `interventions` | conflict, occurrence, companies, intervention-actions, m/intervention | — |
| `missions` | contracts, mission-actions, roulements | — |
| `teams` | equipes, mission-actions, roulements, m/intervention | — |
| `clients` | client-actions | — |

## 3-4. Test dynamique — accès par ID d'un objet étranger

Compte **membre SERVINOR uniquement**, contre des objets **AGP** :

| Famille | Objet AGP dispo | Comportement observé (AVANT) | Fuite ? |
|---|---|---|---|
| **clients** | oui (`Magasin DISCOUNT`) | **HTTP 200, nom rendu** | **🔴 OUI** |
| interventions | non (DISCOUNT supprimé) | non testable dynamiquement | code : même défaut |
| missions | non | non testable | code : même défaut |
| contracts | non | non testable | code : même défaut |

**Écritures** : `decideOwnership` bloque tout tenant cross-org (testé). Le seul
qui traverse une écriture est le super-admin plateforme — **capacité
exploitant**, contraire à la doctrine `pouvoir-plateforme-vs-metier`, à
harmoniser en **M8** (ne laisse traverser **aucun tenant**).

## Le vrai risque : la LECTURE par ID, pas `requireOwned`

`requireOwned` garde les écritures. Mais les **pages `[id]`** lisent leur objet
par des loaders **sans scope org** — exactement la faille du P0 chantier :

| Page | Loader | Scope org ? |
|---|---|---|
| `clients/[id]` | `getClientDetail` | ❌ (fuite **démontrée**) |
| `interventions/[id]` | `getIntervention` (`select('*').eq('id')`) | ❌ (code) |
| `missions/[missionId]` | `getMission` | ❌ (code — `getSiteIdentity` du site est gardé mais la mission est rendue quand même) |
| `contracts/[id]` | `getContract` | ❌ (code — seule garde : `requireDeskUser`, rôle sans org) |

## 5. Correction immédiate

Nouvelle brique `userCanAccessOrgRow(table, id)` (`lib/auth/site-access.ts`) —
même doctrine que `userCanAccessSite`, **sans exemption de rôle**. Posée en
**garde de page**, avant tout chargement, sur les quatre pages. Garde de page
(non dans les loaders) : additive, sans effet sur les autres appelants des
loaders — leur audit relève de M2.

**Preuve après correction** (dynamique, `clients`) :
```
membre SERVINOR → /clients/{AGP} : 404, nom NON rendu   (avant : 200 + nom)
membre AGP      → /clients/{AGP} : 200, nom rendu        (accès légitime préservé)
```

`interventions` / `missions` / `contracts` : corrigées par la même garde,
vérifiées par test de doctrine (garde présente, avant le loader) ; non
re-prouvées dynamiquement faute d'objet AGP en base.

## 6. Ce qui attend un lot ultérieur, et pourquoi c'est sûr

| Sujet | Garde actuelle | Lot |
|---|---|---|
| Écritures `requireOwned` (tenants) | `decideOwnership` — bloque tout tenant cross-org (testé) | — (sûr) |
| Écritures `requireOwned` (admin plateforme) | exemption `role === 'admin'` | **M8** — harmoniser sans casser 21 surfaces |
| Loaders réutilisables (`getClientDetail`…) hors pages `[id]` | garde posée sur les PAGES ; autres appelants à auditer | **M2** |
| Vues perso `/sites`, `/actions`, dashboard (multi-org) | lèvent `OrganisationAmbigueError` | **M3** |

## Verdict

Une fuite de lecture inter-organisations **démontrée** (`clients`), plus trois
de même pattern par lecture de code — **toutes fermées** par garde de page. Les
écritures ne laissent traverser **aucun tenant** ; l'exemption admin plateforme
sur `requireOwned` reste une capacité exploitant à harmoniser en M8, sans fuite
tenant-vers-tenant.

`vincent.trouillat` conserve AGP + SERVINOR. Aucun fallback « org par défaut »
introduit. M2 peut s'ouvrir.
