# Doctrine branding — MemorIA

*Dernière mise à jour : 2026-07-24 — Lot A M4a livré.*

---

## Pourquoi cette doctrine

Sans règle explicite, le premier développeur qui a besoin d'un logo copie-colle un `<img src={logo_url}>`. Le deuxième crée un second composant. Le troisième stocke une URL externe dans une colonne. En six mois, il y a trois implémentations, aucune error-handling, et react-pdf charge des URLs arbitraires côté serveur.

Cette doctrine évite ce scénario.

---

## Deux types de logos, deux rôles distincts

### Logo d'organisation

Identifie **l'entreprise propriétaire des données** dans MemorIA : AGP, SERVINOR, CAPSE.

- Apparaît comme indicateur de provenance dans la sidebar, les badges d'objets agrégés, et les en-têtes PDF.
- N'intervient **jamais** dans la sécurité, le cloisonnement ou les autorisations.
- Optionnel : un fallback couleur + initiales est toujours disponible.

### Logo client

Identifie **le commanditaire d'une mission** : Province Sud, CAFAT, Vale.

- Apparaît sur la fiche client, l'en-tête de site/mission, éventuellement le PDF de visite.
- Le logo client **n'est pas** le logo de l'organisation : une organisation peut travailler pour des dizaines de clients.
- Un même nom client dans deux organisations reste **deux objets séparés** — cloisonnement strict.
- Optionnel. Jamais obligatoire pour créer ou éditer un client.

---

## Le composant unique : `EntityLogo`

```tsx
import { EntityLogo } from '@/components/ui/EntityLogo'

<EntityLogo
  src={meta.logoUrl}          // URL signée depuis le bucket, ou null
  label={meta.label}          // Nom de l'entité — fallback initiales
  size="sm"                   // xs | sm | md | lg
  variant="rounded"           // square (org) | rounded | circle (avatar)
  fallbackColor={meta.color}  // #RRGGBB ou null → gris neutre
/>
```

**Règle absolue : aucun `<img>` direct dans l'application pour un logo d'entité.**

`EntityLogo` gère les trois états :
- Logo valide → `<img>` avec `onError`
- Erreur de chargement → initiales sur fond coloré
- Absence de logo → initiales sur fond coloré

`OrgBadgeRich` réutilise `EntityLogo`. Les fiches client (Lot B) réutiliseront `EntityLogo`. Aucun nouveau composant de logo ne doit être créé sans passer par `EntityLogo`.

---

## Storage : chemin, pas URL

### Ce qui est stocké en base

```ts
organizations.logo_path   // "organizations/{org_id}/logo.png"
clients.logo_path         // "clients/{org_id}/{client_id}/logo.webp"
```

**Jamais une URL libre dans `logo_url`.** Ce champ existe mais est déprécié (mig 236).

### Le bucket

```
entity-logos  — privé
```

Chemins :
- `organizations/{org_id}/logo.{ext}`
- `clients/{org_id}/{client_id}/logo.{ext}` — l'`org_id` du client garantit l'isolation

### Formats acceptés

PNG, JPEG, WebP. **SVG refusé** (risque d'injection). Taille max 2 Mo.

### Les URLs sont générées côté serveur

```ts
// lib/storage/entity-logos.ts
const signedUrls = await getSignedLogoUrls(paths)  // 1 appel pour N logos, TTL 7 j
```

`react-pdf` ne reçoit jamais une URL saisie par l'utilisateur. Il reçoit une URL signée produite par MemorIA depuis son propre bucket.

---

## Comment ajouter un logo à une nouvelle entité

1. Ajouter `logo_path text null` et `logo_updated_at timestamptz null` dans une migration.
2. Chemin : `{entity-type}/{org_id}/{entity_id}/logo.{ext}` — `org_id` toujours en première composante.
3. `org_id` dérivé côté serveur depuis le profil ou l'entité parente — **jamais depuis le formulaire**.
4. Upload via `uploadOrgLogo(orgId, buffer, mime)` ou son équivalent client — à étendre dans `entity-logos.ts`.
5. Display via `EntityLogo`.

---

## Ce que cette doctrine empêche

| Tentation | Pourquoi refuser |
|---|---|
| `<img src={logo_url}>` | Pas d'error handler, URL arbitraire possible |
| Stocker une URL externe en base | URL instable, tracking, SSRF dans le PDF |
| Bucket public | Acceptation implicite d'autres ressources sensibles par la suite |
| Nouveau composant "ClientLogo" | `EntityLogo` gère déjà tous les cas |
| Lire `organizations` sans admin client | La table n'est pas accessible via RLS standard |
