# M1 — Recette de cartographie (compte de test multi-organisations)

**Date** : 2026-07-22 · **Compte** : `multiorg.test@memoria.nc` — manager AGP,
chef_equipe SERVINOR · **Méthode** : session réelle (auth par mot de passe),
serveur de prod local, codes HTTP observés, aucune écriture.

> Ce compte ne valide pas une UX finale. Il **révèle** où l'ancien modèle
> mono-organisation est encore implicite. Qu'une page lève
> `OrganisationAmbigueError` est le comportement **attendu** de M1.

## Résultats observés

| Route | HTTP | Comportement | Org déductible ? | Lot | Priorité |
|---|---|---|---|---|---|
| `/account` | **200** | Profil perso, aucun scope org | s.o. | — (M1 ✅) | — |
| `/` → `/dashboard` | 307→200* | Redirige puis **page d'erreur** | non (perso) | **M3** | moyenne |
| `/dashboard` | 200* | **`OrganisationAmbigueError` rendue** | non (perso) | **M3** | moyenne |
| `/sites` | **500** | `OrganisationAmbigueError` | non (perso) | **M3** | moyenne |
| `/actions` | **500** | `OrganisationAmbigueError` | non (perso) | **M3** | moyenne |
| `/planning` | 200* | **page d'erreur** | non (perso) | **M3** | moyenne |
| `/sites/{AGP}` | **200** | Chantier rendu — **sans garde d'appartenance** | oui (par le chantier) | **M2** | **🔴 critique** |
| `/sites/{AGP}/…/compte-rendu` | **200** | CR rendu — garde présente mais sur la **mauvaise source** | oui | **M2** | haute |
| `/admin/organisations` → `/missions` | 307 | Refus de rôle (manager ≠ admin) | s.o. | — (correct) | — |

*200 avec page d'erreur = la route répond, le composant serveur lève —
c'est une ambiguïté, pas un rendu de données.

## Les trois catégories, peuplées

### M3 — pages personnelles à agréger
`/`, `/dashboard`, `/sites`, `/actions`, `/planning`.

Elles n'ont **pas** d'organisation unique à déduire, et c'est normal : ce sont
des vues personnelles. Elles lèvent aujourd'hui parce qu'elles appellent
`getOrgId()` (scalaire) là où il faudra `getOrgIdsOfUser()` + agrégation des
données autorisées. **Le fail bruyant a fait son travail** : il a désigné
exactement la liste des vues perso.

### M2 — accès direct aux objets chantier
`/sites/{id}` et tout ce qui pend au chantier.

L'organisation **est** déductible — par le chantier. Ces pages doivent vérifier
`requireOrganizationMembership(chantier.organization_id)`, pas `getOrgId()`.

### M4 — administration à contexte explicite
`/admin/*`. Non ré-observé ici en détail (le compte de test est `manager`, pas
`admin` plateforme) — le refus de rôle fonctionne. Le contexte org explicite
des écrans d'admin tenant reste à cadrer.

## 🔴 CONSTAT CRITIQUE — fuite cross-organisation (pré-existante)

**Prouvé dynamiquement** : un compte membre **uniquement de SERVINOR** ouvre le
chantier **AGP** « Lycée PETRO ATTITI » par URL et **en voit le nom rendu**.

```
Compte SERVINOR-only → GET /sites/{PETRO_ATTITI_AGP}
  HTTP 200 — FUITE CONFIRMÉE : le nom du chantier AGP est rendu à un non-membre
```

**Cause** : `app/(dashboard)/sites/[id]/page.tsx` appelle `getSiteIdentity(id)`
(`lib/db/site-cockpit.ts:323`), qui **ne filtre pas** `organization_id`. La page
ne re-vérifie rien. Le seul rempart est le rôle desk du layout — pas
l'appartenance à l'organisation du chantier.

**Ce n'est PAS introduit par M1.** M1 n'a pas touché à cette page. La faille
existe **en production aujourd'hui** : un manager de n'importe quelle
organisation peut ouvrir un chantier de n'importe quelle autre par URL. Le
compte de test n'a fait que la **rendre visible** — le multi-organisations a
transformé un trou théorique en trou démontrable.

**Nuance M2 pour la page CR** : `compte-rendu/page.tsx:61` a bien une garde,
mais elle compare à `user.organization_id` — la **colonne scalaire**. Pour un
compte multi-organisations, cette colonne est une « org par défaut » qui ne fait
plus autorité : la garde peut refuser à tort (chantier SERVINOR alors que la
colonne dit AGP) ou laisser passer à tort. Toutes ces gardes doivent basculer
sur `requireOrganizationMembership(objet.organization_id)`.

## Ce que la recette n'a PAS trouvé (et c'est rassurant)

- **Aucune écriture silencieuse** : les pages ambiguës **échouent** avant
  d'écrire, elles ne choisissent pas une organisation. L'invariant de M1 tient.
- **Aucune page n'affiche une seule organisation en la faisant passer pour
  tout** : celles qui ne savent pas agréger lèvent, elles ne mentent pas.

## Condition d'entrée de M2 — remplie

La cartographie est faite, chaque ambiguïté est classée, et il est prouvé
qu'aucune lecture ni écriture ne choisit silencieusement une organisation — sauf
le point critique ci-dessus, qui est précisément le **premier objet de M2** :
la garde d'appartenance sur l'accès direct aux chantiers.

**Ordre de M2 confirmé par l'observation** : commencer par
`getSiteIdentity` + la garde de la page chantier. C'est le chemin le plus court
pour qu'un compte multi-organisations ouvre AGP et SERVINOR sans ambiguïté — et
c'est aussi ce qui referme la fuite.
