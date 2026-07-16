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

## Décisions — FIGÉES (Vincent, A1 démarré)
Le contrat réel vit désormais dans le code (`lib/knowledge/site-overview.ts`).
Forme **object-centric** et **jamais `undefined`** : chaque section
`{ proposed: [], confirmed: [], counts }`. Les écrans ne connaissent QUE `SiteOverview`.
1. **`synthesis.status`** = 4 états métier : `missing | up_to_date | outdated |
   generating`. (`outdated` = visite enrichie depuis la synthèse = comparaison de
   corpus : branché plus tard ; A1 calcule missing/generating/up_to_date.)
2. **watchpoints** = `proposed` **uniquement** (pas d'objet « vigilance validée »
   aujourd'hui). `confirmed` reviendra avec l'objet Vigilance.
3. **stakeholders** = `proposed` **et** `confirmed` séparés (jamais mélangés).
4. **mobile** = même `getSiteOverview` ; le « ici/maintenant » terrain vit dans
   `getSiteFieldToday` (read model distinct), pour que `SiteOverview` ne grossisse pas.

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

## TRANCHE A — TERMINÉE (Vincent, A7)

Desktop et mobile lisent `SiteOverview`. Les actions proposées sont identiques sur les
deux surfaces, et le test de doctrine (`tests/lib/site-overview-tab.doctrine.test.ts`)
empêche le retour en arrière. L'objet Action est stabilisé.

### Dette consignée — NE PAS ouvrir de lot

`SiteStatusCard`, `IdentityCard` et `SiteActivityCard` (fiche mobile) lisent encore
`buildSiteStatusSummary` / `getSiteIdentity` / `getSiteRecentActivity` en direct, alors
que `getSiteOverview` refait ces lectures à l'intérieur. C'est une duplication réelle,
et **ce n'est pas un problème** : les deux surfaces affichent la même chose. La seule
différence est un nombre de requêtes.

Critère de réouverture — un seul : **le conducteur voit une incohérence** (desktop dit
3 actions proposées, mobile dit 2). Tant que les chiffres concordent, on n'y touche pas :
migrer ces trois cartes ne produirait aucun écran différent, aucun compteur
supplémentaire, aucune capacité visible.

> Une tranche est terminée lorsqu'elle se démontre dans l'application — pas quand
> l'architecture est belle.
