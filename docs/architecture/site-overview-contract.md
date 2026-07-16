# Contrat de la fiche chantier — `SiteOverview` (Tranche A, étape A0)

## Architecture à deux niveaux (décidée)

On NE fait PAS de `getSiteProjection()` universel (god-object : trop de données,
invalidation trop large, besoins mélangés). Deux niveaux :

```
Projections métier réutilisables        (cohérence d'UN objet, toutes surfaces)
  getActionProjection(siteId)
  getDeadlineProjection(siteId)
  getWatchpointProjection(siteId)
  getKnowledgeProjection(siteId)
  getStakeholderProjection(siteId)
        │
        ▼
Read model DE L'ÉCRAN                    (compose les projections + repositories utiles)
  getSiteOverview(siteId)   ← la fiche chantier
  getDashboardOverview(userId)
  getWorkOverview(filters)
  getPlanningOverview(range)
  getSiteHistory(siteId)
  getSiteMemory(siteId)
        │
        ▼
Composant UI                            (reçoit CET objet et rien d'autre)
```

`getActionProjection` / `getProposalProjection` existent déjà. `getSiteProjection`
(agrégat actuel) sera **remplacé** par `getSiteOverview` pour la fiche.

## Périmètre : `SiteOverview` = l'onglet APERÇU / « État du chantier »

La fiche desktop a des **onglets** (Aperçu, Travail, Chronologie, Planning,
Documents, Mémoire). `SiteOverview` couvre **l'Aperçu uniquement**. Les autres
onglets auront leur propre read model (`getWorkOverview`, `getPlanningOverview`,
`getSiteHistory`, `getSiteMemory`) — migrés ensuite, même pattern.

## Le contrat

Chaque champ est classé **[C]** confirmé (métier validé) · **[P]** proposé
(connaissance à confirmer) · **[F]** factuel (preuve / événement).

```ts
interface ProposalSummary { id: string; title: string }        // top borné, jamais le détail
interface TimelineItem   { id: string; title: string; startsAt: string; kind: string }
interface ActivitySummary{ id: string; label: string; at: string; kind: string }

interface SiteOverview {
  identity: {                          // [F]  getSiteIdentity
    id: string
    name: string
    clientName: string | null
    status: string
  }

  latestVisit: {                       // [F]  getLastEndedVisitForSite (+ état synthèse)
    reportId: string
    endedAt: string | null
    synthesisStatus: 'up_to_date' | 'enriched' | 'missing'   // ⚠️ décision #1
    sourceDelta?: { photos: number; videos: number; vocals: number; notes: number }
  } | null

  work: {
    openActions: number                // [C]  projection Action.confirmed (open/planned)
    overdueActions: number             // [C]  projection Action.overdue
    proposedActions: { total: number; top: ProposalSummary[] }   // [P] projection Action
  }

  monitoring: {
    openReserves: number               // [C]  buildSiteStatusSummary(reserves)
    openBlockers: number               // [C]  listBlocagesBySite (dateEnd null)
    confirmedWatchpoints: number       // [C]  ⚠️ décision #2 (pas d'objet dédié aujourd'hui)
    proposedWatchpoints: { total: number; top: ProposalSummary[] }   // [P] projection Vigilance
  }

  planning: {
    nextConfirmed: TimelineItem[]      // [C]  getSiteCurrentState → prochaine(s) étape(s), borné
    proposedDeadlines: { total: number; top: ProposalSummary[] }     // [P] projection Échéance
  }

  memory: {
    confirmedKnowledge: { total: number; top: ProposalSummary[] }    // [C] listSiteASavoirActive
    proposedKnowledge:  { total: number; top: ProposalSummary[] }    // [P] projection Connaissance
    stakeholders:       { total: number; top: ProposalSummary[] }    // [C] site_intervenants (+ [P] proposés ? décision #3)
  }

  recentActivity: ActivitySummary[]    // [F]  getSiteRecentActivity, borné (≤ 5)
}
```

### Limites de listes (chargement borné)
- `proposed*.top`, `confirmedKnowledge.top`, `stakeholders.top` : **≤ 3**, avec `total`.
- `planning.nextConfirmed` : **≤ 3**.
- `recentActivity` : **≤ 5**.
- Partout : **id + libellé court + lien**. Jamais le détail (chargé après ouverture).

## Ce qui N'EST PAS dans `SiteOverview`
Corps de transcriptions · médias · 80 interventions détaillées · toutes les actions
historiques · chronologie complète · documents · contenu PDF · mémoire complète.
Ces contenus vivent dans les read models d'onglet (Travail / Planning / Historique /
Mémoire / Documents), chargés à l'ouverture de l'onglet.

## Décision à trancher : la fiche MOBILE
La fiche mobile (`/m/site/[id]`) affiche, en plus de l'Aperçu, du « ici et
maintenant » terrain : interventions du jour, rappels de présence, dernières photos.
Deux options :
- **(a) recommandé** — `SiteOverview` = le **cœur partagé** desktop+mobile ; le
  bloc terrain (« Aujourd'hui ici ») reste un read model distinct `getSiteFieldToday(siteId)`
  côté mobile. Chaque read model a un besoin clair, aucun god-object.
- (b) tout mettre dans `SiteOverview` → risque de re-fabriquer un agrégat lourd.

## Décisions ouvertes (ta validation)
1. **`latestVisit.synthesisStatus`** — up_to_date / enriched / missing exige de
   comparer le corpus de la visite à la synthèse stockée (logique déjà dans le
   débrief). On l'expose dès A1, ou on démarre en `missing | present` et on affine ?
2. **`confirmedWatchpoints`** — il n'existe **pas** d'objet « vigilance validée »
   aujourd'hui (une vigilance se promeut en réserve ou en note). On compte quoi ?
   Proposition : le retirer de A1 (n'exposer que `proposedWatchpoints`) tant que
   l'objet Vigilance n'est pas construit.
3. **`stakeholders`** — on montre les **validés** (`site_intervenants`, souvent
   vides aujourd'hui) + les **proposés** séparément, ou seulement les proposés au début ?

## Ordre (A1→A4) et critères de sortie
- **A1** — `getSiteOverview(siteId)` (compose projections + repositories, zéro mutation).
- **A2** — bascule COMPLÈTE de la fiche desktop (plus AUCUNE lecture métier directe).
- **A3** — bascule COMPLÈTE de la fiche mobile (même contrat).
- **A4** — **test de doctrine** : interdire aux pages fiche d'importer `lib/db/site-actions`,
  `lib/db/site-reserve`, `lib/db/knowledge-proposals`, le client Supabase — seule la
  couche read model/projection est autorisée.

**Sortie (fiche migrée) :** ① aucune lecture directe de table ; ② desktop & mobile
consomment la même donnée ; ③ une action proposée apparaît sur les deux ; ④ sa
promotion fait proposées 3→2 / ouvertes 2→3 sans incohérence ; ⑤ une clôture met à
jour les compteurs ; ⑥ une nouvelle visite met à jour « dernière visite » + état de
synthèse ; ⑦ chargement borné (aucun corpus / média / historique massif).
