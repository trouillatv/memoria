# M3 — Dashboard — Audit des loaders (préalable, AUCUN code)

**Date** : 2026-07-22 · **Périmètre STRICT** : `/dashboard` + les loaders qu'elle
appelle + l'affichage de la provenance d'organisation. **PAS** `/sites`, `/actions`,
ni les ~113 `getOrgId` globaux.

## Doctrine appliquée (rappel)

- `getOrgId()` → remplacé par `getOrgIdsOfUser()` + filtre `.in('organization_id', ids)` → **résultat agrégé** ;
- loader ne portant pas de donnée d'org → **inchangé** ;
- **aucune organisation active implicite** ; le dashboard personnel n'additionne pas deux checklists et ne demande jamais de choisir une org ;
- **badge** uniquement sur les cartes métier ambiguës (chantier/action/visite/réunion/réserve/événement) ; **pas** sur les totaux dont le libellé dit déjà « global » ;
- le **nom/slug** de l'org vient du serveur (`organizations.name` / `organizations.slug`, mig 089), jamais d'un mapping codé dans le composant.

## Le point qui décide de tout : la cascade `Promise.all`

`DashboardPage` fait `await getOnboardingProgress()` (l.121) **avant** le `Promise.all`
des 18 autres loaders. C'est pourquoi la page tombe tout de suite. **Mais** corriger
seulement ce loader ferait tomber la page sur le suivant : `getCapitalPreuves`,
`getTenantCumulativeStats`, `getRecentAnomalies` utilisent un `.eq('organization_id', orgId)`
**direct** (non gardé par `if (orgId)`) → ils lèvent aussi. **Tous doivent être migrés
avant remise en service.**

Trois loaders masquent déjà le throw par `getOrgId().catch(() => null)` — ce qui ne
les sauve pas, ça les fausse :
- `getAttentionDigest` : `null` → **aucun filtre** → lecture **inter-tenants** (fuite latente, admin client) ;
- `getTenantTopMorningReading`, `getMemoryHeatmap` : `null` → `.eq(..., null)` → **vide**.
La migration `.in(orgIds)` corrige les trois (dont la fuite de `getAttentionDigest`).

## Tableau d'audit

Légende nature : **C** = compteur/total · **L** = liste/cartes · **U** = item unique/agrégat · **N** = neutre (pas d'org).

| # | Loader (fichier) | getOrgId | Requête actuelle (filtre org) | Nature | Stratégie M3 | Badge |
|---|---|---|---|---|---|---|
| 1 | `getOnboardingProgress` (onboarding.ts) | oui | `sites/site_reports .eq(org)` puis actions via `site_id` | U (organisationnel) | **agréger** : étape vraie si réalisée dans **≥1** org (`.in(orgIds)`) | non |
| 2 | `getCapitalPreuves` (dashboard.ts) | oui (direct .eq) | photos/preuves `.eq(org)` + jointure intervention | C | `.in(orgIds)` | non (total) |
| 3 | `getTenantCumulativeStats` (dashboard.ts) | oui (direct .eq) | passages/interventions `.eq(org)` | C | `.in(orgIds)` | non (total) |
| 4 | `getOpenAnomaliesStrict` (dashboard.ts) | oui (guardé) | count anomalies `.eq(org)` | C | `.in(orgIds)` | non (total) |
| 5 | `countHandoverBriefsByStatus` (handover.ts) | oui (guardé) | briefs par statut `.eq(org)` | C | `.in(orgIds)` | non (total) |
| 6 | `listContracts` (contracts.ts) | oui (guardé) | `contracts .eq(org)` | L | `.in(orgIds)` + renvoyer `organization_id` | **oui** |
| 7 | `listTendersDueSoon` (dashboard.ts) | oui (guardé) | `tenders .eq(org)` | L | `.in(orgIds)` + org | **oui** |
| 8 | `getRecentAnomalies` (dashboard.ts) | oui (direct .eq) | `intervention_anomalies .eq(org)` | L | `.in(orgIds)` + org | **oui** |
| 9 | `getAtRiskEngagements` (dashboard.ts) | oui (guardé, ×5) | contracts/engagements/missions/interv `.eq(org)` | L | `.in(orgIds)` + org | **oui** |
| 10 | `listRecentPassations` (handover.ts) | oui | passations `.eq(org)` | L | `.in(orgIds)` + org | **oui** |
| 11 | `listLivingASavoir` (handover.ts) | oui | notes « à savoir » `.eq(org)` | L | `.in(orgIds)` + org | **oui** |
| 12 | `listContinuityRisks` (continuity.ts) | oui (guardé) | users/sites `.eq(org)` | L | `.in(orgIds)` + org | **oui** |
| 13 | `getVisitImpact` (site-events.ts) | oui | changements du jour `.eq(org)` | L | `.in(orgIds)` + org | **oui** |
| 14 | `getAttentionDigest` (attention.ts) | oui (`.catch→null`, **fuite**) | sites `.eq(org)` sinon **tout** | L | `.in(orgIds)` (**ferme la fuite**) + org | **oui** |
| 15 | `getTenantTopMorningReading` (site-cockpit.ts) | oui (`.catch→null`) | top lecture `.eq(org)` | U | `.in(orgIds)` + org | oui (1 site) |
| 16 | `getMemoryHeatmap` (memory/heatmap.ts) | oui (`.catch→null`) | briefs/notes/anomalies `.eq(org)` | U (agrégat) | `.in(orgIds)` | non (agrégat) |
| 17 | `getMyOrgMorningDigest` (morning-digest.ts) | oui | digest « MON org » `.eq(org)` | U | **DÉCISION PRODUIT** (voir §) | oui si affiché |
| 18 | `getInboxFeed(userId, orgId)` (inbox-feed.ts) | non (param) | l'appelant passe `user.organization_id` | L | l'appelant passe **`orgIds`** ; feed `.in` | **oui** |
| 19 | `collectMemorySignals` (signals/collect.ts) | non (détecteurs `.catch→[]`) | chaque détecteur scope seul | L | **crash-safe** ; détecteurs à migrer (suivi) | oui (par site) |
| 20 | `getMyUnreadNotifications` (notifications.ts) | non (`user_id`) | `.eq('user_id', me)` | N | **inchangé** | non |
| 21 | `getContractSummaries(ids)` (dashboard.ts) | non | RPC sur `contractIds` déjà scopés | N | **inchangé** | non |

## Colonnes disponibles pour le nom d'organisation

`organizations(id, name NOT NULL, slug UNIQUE)` (mig 089). Plan badge : les loaders
de type **L** renvoient `organization_id` par item ; la page fait **un** lookup
`organizations` pour `orgIds` → map `{id → {name, slug}}` ; le composant badge lit
cette map. Aucun libellé codé en dur.

## Hypothèses « une seule organisation » à casser

- `getMyOrgMorningDigest` : commentaire « le digest du matin pour **MON** organisation » — suppose une org unique.
- `getAttentionDigest`, `getTenantTopMorningReading`, `getMemoryHeatmap` : `getOrgId().catch(() => null)` — masque le multi-org (fuite ou vide).
- `getInboxFeed` : l'appelant (page l.135) passe `user.organization_id ?? null` — l'org **par défaut** du profil.
- `getOnboardingProgress` : `allDone` combine 3 booléens d'**une** org.

## États vides à adapter

- Onboarding : `allDone` devient vrai si la boucle existe dans **≥1** org (SERVINOR vide ne bloque pas).
- Cartes : avec `.in(orgIds)`, « vide » = vide dans **toutes** les orgs (comportement voulu).
- Un compte avec une org sans données : ses cartes montrent l'autre org ; badges pour distinguer.

## Risque de doublons

- **Faible** : chaque ligne appartient à **une** org → `.in` n'introduit pas de doublon (pas d'`OR` sur des jointures multipliantes ici).
- Point de vigilance : `getAtRiskEngagements` / `listContinuityRisks` enchaînent plusieurs requêtes puis recomposent — vérifier que le passage `.eq → .in` ne fait pas exploser un `Map` par clé non préfixée d'org (clé = id métier, déjà unique globalement → OK, mais à re-vérifier au codage).

## Ordre de migration (par lot testable)

1. **`getOnboardingProgress`** (agrégation) — rend la page **atteignable**.
2. **Compteurs** (#2-5) — `.in`, aucun badge.
3. **Listes/cartes** (#6-14) — `.in` **+ renvoyer `organization_id`** (prépare les badges).
4. **Uniques/agrégats + appelant** (#15, #16, #18) ; **#17 après décision produit**.
5. **Badges** — lookup `organizations` + composant `<OrgBadge name slug />` sur les cartes.
6. **Preuve** : compte mono-org · compte **AGP + SERVINOR** · compte avec **une org vide** (l'autre doit rester visible, onboarding non bloqué).
7. Neutres (#19 crash-safe, #20, #21) : inchangés ; `collectMemorySignals` détecteurs = **suivi** (dégrade en vide, ne casse pas).

## Décision produit — `getMyOrgMorningDigest` — TRANCHÉE (Vincent, 2026-07-22)

**« Le plus pertinent »**, avec une règle de sélection **strictement déterministe et
explicable** (aucun nouvel appel IA, aucun score pondéré arbitraire).

**Doctrine** : le digest affiché n'est PAS « le digest de l'utilisateur ». C'est
*le digest organisationnel jugé le plus utile ce matin parmi les organisations
auxquelles l'utilisateur appartient*. Cette nuance doit rester visible dans le code
et ici — pour ne jamais transformer ce choix en **organisation active implicite**.

Règle :
- charger les digests **du jour** de **toutes** les organisations accessibles ;
- **0** digest → repli actuel (HERO historique par résonances) ;
- **1** digest → l'afficher ;
- **plusieurs** → comparaison **lexicographique** (pas de `score = a*7 + b*5`) :
  1. plus grand nombre d'éléments nécessitant une **attention** ;
  2. puis plus grand nombre de **signaux affichables** ;
  3. puis **date de génération** la plus récente ;
  4. puis **`organization_id`** — départage **stable** (évite tout changement aléatoire à égalité).

Affichage :
- HERO badgé depuis `organizations(name, slug)` : « Mémoire active ce matin [AGP] ».
- Si d'autres digests existent : accès discret **« Voir les N autres organisations »**
  (jamais « voir l'autre » — faux dès 3 orgs). Le clic remplace le HERO **localement**
  au composant — **jamais** une organisation active globale.

Tests exigés : **0, 1, 2, 3** organisations avec digest, **+ égalités parfaites** entre deux digests (le départage stable doit trancher).
