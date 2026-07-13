# 06 — Client / Site : modèle, confusion, cause racine

> Audit 2026-07-13, post-session Guillaume. Faits vérifiés (fichier:ligne).

## Le modèle réel

```
Organisation (tenant)
└── Client            clients — name NOT NULL, deleted_at, organization_id (mig 089)
    └── Site          sites — client_id NOT NULL → clients ON DELETE CASCADE (mig 003:19)
        ├── Dossier   dossiers (mig 172) — opération ; client_id NULLABLE (donneur d'ordre
        │             de CETTE opération, peut différer du client du site)
        ├── Mission → Intervention → Preuves
        └── Réunions / Visites / Actions / Réserves
```

Faits structurants :

- **Un site a TOUJOURS un client** (`client_id NOT NULL`, jamais assoupli). Le « sans
  client » est simulé par un client nommé **« Interne »** (find-or-create ilike
  org-scopé, `sites/actions.ts:178-197`) — contournement documenté, tripwire posé
  (la vraie correction structurelle serait `client_id` nullable).
- **`contracts.client_name` est du texte libre** (mig 017:28) — AUCUNE FK vers
  `clients`. Le lien contrat→client est un nom recopié
  (`ensureClientForContract`, `contracts/[id]/sites-actions.ts:55-83`).
- Anti-doublon site : `normalized_name` + `canonical_site_key`
  (= client normalisé :: site normalisé) + index trigram (mig 062).

## Pourquoi Guillaume s'est trompé — cause racine

Ce n'est ni le modèle (il est sain : client → sites multiples) ni le vocabulaire seul.
C'est la **présentation asymétrique** :

1. **Trois formulaires de création de site, un seul discipliné.**
   - `sites/CreateSiteDialog.tsx` (desktop /sites) : sélecteur client + « + Nouveau
     client » + détection de doublon trigram ≥ 0.75 live + serveur, warning rendu
     « {site} — {client} » (`:211-215`, `actions.ts:204-217`). ✅ le bon modèle.
   - `contracts/[id]/sites/create-site-form.tsx` : pas de choix client (hérité du
     contrat), **aucune détection de doublon**.
   - Création rapide mobile (`quick-site-actions.ts` via MeetingLauncher /
     VisitLauncherHome / PrevisiteAoLauncher) : client **facultatif** (« On pourra
     rattacher plus tard »), **aucun warning doublon**.
2. **Le formulaire client ne déduplique JAMAIS** : `createClientAction`
   (`clients/client-actions.ts:34-44`) insère sans lookup. Deux « Discount »
   homonymes possibles sans avertissement.
3. **Les sélecteurs mobiles n'affichent que le nom du site** — c'est là que la
   confusion se vit : « Discount » et « Discount Poindimié » côte à côte sans
   qualificatif.
4. **Certains sélecteurs desktop affichent le CONTRAT au lieu du client**
   (`NewMissionDialog.tsx:77-80`, `CreateInterventionDialog.tsx:186-192`) — or
   `contracts.client_name` n'est pas garanti égal au client réel.

## Inventaire des sélecteurs de site

| Sélecteur | Fichier:ligne | Rendu actuel | Client affiché |
|---|---|---|---|
| Prise de site équipe | `handovers/CreateTeamTakesSiteButton.tsx:93-96` | `{name} — {client_name}` | ✅ (référence) |
| Création site (warning doublon) | `sites/CreateSiteDialog.tsx:211-215, 399-402` | `{name} — {client_display_name}` | ✅ (référence) |
| Fiche site desktop | `sites/[id]/IdentityHeader.tsx:22-27` | badge client | ✅ |
| Nouvelle mission | `missions/NewMissionDialog.tsx:77-80` | `{name} — {contractName}` | ⚠️ contrat |
| Planifier intervention (semaine) | `semaine/CreateInterventionDialog.tsx:186-192` | mission `· contractName` | ⚠️ contrat |
| Édition mission (SiteSelector) | `contracts/[id]/missions/[id]/edit/SiteSelector.tsx:129-132, 246-248` | `{name}` (+contrat pour « autres ») | ⚠️ |
| Nouvelle réunion desktop | `meetings/NewMeetingButton.tsx:128` | `{name}` | ❌ |
| Intervention mobile | `m/InterventionLauncher.tsx:127` | `{name}` | ❌ |
| Réunion mobile | `m/MeetingLauncher.tsx:147` | `{name}` | ❌ |
| Visite mobile | `m/VisitLauncherHome.tsx:243` | `{name}` | ❌ |
| Liste chantiers mobile | `m/chantiers/page.tsx:79` | `{name}` + adresse | ❌ |
| Fiche site mobile | `m/site/[siteId]/page.tsx` | — | ❌ (0 mention client) |
| Litige wizard | `litige/LitigeWizard.tsx:39-42` | `{name}` | ❌ |
| Cartes /sites | `sites/SiteGlobalRow.tsx:207,215` | nom + badge contrat (client en tête de groupe) | ~ |

## Où la donnée manque pour afficher « Site — Client »

Ces sources ne SELECTionnent pas le client (à joindre `client:clients(name)`) :

- `m/meeting-actions.ts:listMeetingSitesAction` (`select('id, name')`, :22,39,43) —
  alimente les 3 lanceurs mobiles.
- `m/chantiers/page.tsx:29-31` (`select('id, name, address')`).
- `meetings/page.tsx:76` (client jeté avant `NewMeetingButton`).
- `missions/page.tsx:137` (joint le contrat, pas le client).
- Source du LitigeWizard.

Côté `/sites` et matching, `client_display_name` est déjà chargé
(`lib/db/sites.ts:274,373` ; `listSitesForMatching:115-157`).

## Règle de design (validée Vincent 2026-07-13)

> **Un site ne s'affiche jamais sans son client. Toujours. Partout. Même si ça
> paraît redondant.**

Le modèle est sain (Client → Site → Mission) ; la confusion vient de ce que chaque
écran affiche une représentation différente (site seul / site+contrat / site+client).
Guillaume n'a jamais une représentation stable. Cette règle supprime la classe
entière de problèmes — elle s'applique aux sélecteurs, listes, cartes, fiches,
en-têtes, exports.

## Amélioration minimale cohérente (proposée — voir 07-roadmap)

1. Appliquer la règle : rendu unifié `{site.name} — {client.name}` dans TOUS les
   sélecteurs et listes (ajouter le join là où il manque, tableau §B ci-dessus) ;
   le contrat reste une méta secondaire, jamais le qualificatif principal.
2. Dédup client dans `createClientAction` (même ilike org-scopé que la création de
   site) + warning non bloquant « Un client "Discount" existe déjà — l'utiliser ? ».
3. Étendre la détection de doublon site (déjà écrite pour CreateSiteDialog) à la
   création rapide mobile et au formulaire contrat — réutiliser
   `canonical_site_key`/trigram existants, pas de nouveau mécanisme.
4. Badge client sur la fiche chantier mobile (parité avec `IdentityHeader` desktop).
5. Placeholders : « Ex : Discount (l'entreprise cliente) » / « Ex : Discount
   Poindimié (le lieu) » dans les deux formulaires.

**Hors périmètre assumé** : renommer les tables, rendre `client_id` nullable, ou
créer une FK `contracts.client_id` — changements structurels à instruire séparément
(le tripwire « Interne » reste surveillé).
