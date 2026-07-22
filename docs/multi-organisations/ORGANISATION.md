# Doctrine — L'organisation d'une écriture

> **Toute écriture doit pouvoir déterminer une organisation unique avant d'être
> exécutée. Si cette organisation ne peut pas être déterminée structurellement
> (par l'objet touché) ou explicitement (par le contexte), l'écriture doit
> échouer.**

C'est toute la doctrine. Le reste de ce fichier explique pourquoi elle mérite
d'exister, et ce qu'elle interdit.

## D'où vient l'organisation d'une écriture

Dans l'ordre, et il est exclusif :

1. **De l'objet touché** — modifier une visite, c'est écrire dans
   l'organisation de son chantier. On ne demande rien à personne : la donnée
   porte son propriétaire.
2. **Du contexte explicite** — créer un chantier quand on appartient à deux
   entreprises : on choisit, une fois, à la création. Tout ce qui naîtra du
   chantier héritera.
3. **Sinon : échec.** `OrganisationAmbigueError`. Pas un choix, pas un défaut,
   pas la première ligne d'une requête.

## Ce que ça interdit, nommément

```ts
organizationId ?? memberships[0]          // ← JAMAIS
organizationId ?? orgIds[0]               // ← JAMAIS
const orgId = (await getOrgIdsOfUser())[0] // ← JAMAIS pour écrire
```

Ces raccourcis sont précisément ce que M1 a éliminé de `getOrgId()`. Un compte
qui appartient à AGP et SERVINOR, et un code qui « prend la première » : la
donnée saisie pour SERVINOR atterrit chez AGP — sans erreur, sans trace, et
personne ne s'en aperçoit avant l'audit. **L'erreur bruyante est le
comportement correct.**

## La règle jumelle, côté lecture

`getOrgIdsOfUser()` (liste) sert les **lectures agrégées** — et elles seules.
Une lecture peut couvrir plusieurs organisations parce qu'elle ne déplace
aucune propriété : elle montre à quelqu'un ce à quoi il a déjà droit.

| Geste | Primitive | Cardinalité |
|---|---|---|
| Écrire | organisation de l'objet, ou contexte explicite | exactement 1 |
| Lire en agrégé | `getOrgIdsOfUser()` | 0..N |
| Vérifier un droit | `requireOrganizationMembership(orgId)` | ce couple précis |

## Pourquoi ce fichier existe

Aujourd'hui la règle paraît évidente. Dans un an, avec des dizaines de points
d'écriture nouveaux, quelqu'un sera tenté par `?? orgIds[0]` parce que « ça
débloque le ticket ». Ce fichier est là pour que cette ligne ne passe pas une
revue — et `tests/doctrine/multi-organisations-m1.doctrine.test.ts` vérifie
déjà qu'aucune primitive ne prend « la première organisation trouvée ».
