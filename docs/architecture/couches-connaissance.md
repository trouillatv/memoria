# Les couches de la connaissance

> Une visite n'est pas un PDF ni une page. C'est un **événement qui enrichit la
> connaissance du chantier**. Tous les écrans (Accueil, Site, Travail, Planning,
> Historique, Mémoire, PDF) ne sont que des **vues différentes de cette même
> connaissance**.

Le cœur de MemorIA n'est pas « la projection » ni « le compte-rendu » : c'est la
**connaissance du chantier**, construite visite après visite. L'architecture suit
un sens de circulation unique :

```
Preuves
(photo · vidéo · note · vocal)
        │
        ▼
Synthèse IA
        │
        ▼
Extraction métier
        │
        ▼
Connaissance PROPOSÉE          ← l'IA fait apparaître ce qui mérite l'attention
(site_knowledge_proposals)
        │
        ▼
Validation humaine             ← l'humain décide ce qui devient vrai
        │
        ▼
Connaissance VALIDÉE           ← objets métier réels
(site_actions, site_notes, obligations, …)
        │
        ▼
Projection                     ← lecture agrégée, cachée
(getSiteProjection)
        │
        ▼
Interfaces                     ← Accueil · Site · Travail · Planning · Historique · Mémoire · PDF
```

## Règles

1. **Le sens ne s'inverse jamais.** Une couche ne lit que la précédente ; elle
   n'écrit jamais en amont.
   - `Promoter` **écrit** les objets (server actions / mutations).
   - `Projection` **lit** les objets (`lib/knowledge/projection.ts`, lecture seule).
   - `UI` **affiche** la projection.

2. **Deux niveaux distincts, jamais mélangés.**
   - *Connaissance* (proposée) : une visite l'enrichit **immédiatement**, sans
     validation. Surfaces « À confirmer », compteurs séparés.
   - *Métier* (validé) : n'existe **qu'après** un geste humain (« Créer l'action »).
     Actions ouvertes, planning, indicateurs.

3. **Les écrans ne connaissent pas les tables.** Ils consomment la projection
   agrégée du chantier (`getSiteProjection`), pas `site_actions` / `site_notes`
   directement. C'est ce qui permet de faire évoluer le métier sans toucher aux vues.

4. **La mutation invalide, jamais l'écran.** Toute écriture (`createSiteAction`,
   `updateSiteAction`, `dismissProposal`, `projectDebriefToProposals`…) appelle
   `invalidateSiteProjection(siteId)` (`lib/knowledge/invalidate.ts`). Ainsi, quel
   que soit l'appelant (server action, route API, import, batch), la projection est
   toujours invalidée — personne ne peut « oublier » depuis un écran. Une écriture →
   toutes les vues changent.

## Vocabulaire

- **Code** : `Proposal` / `proposed` reste correct (technique, stable).
- **Métier / UI** : parler d'**élément de connaissance proposé** (ou « connaissance
  proposée »), pas de « proposition ». Une échéance, un intervenant, un « à savoir »
  ne sont pas des « propositions » — ce sont tous des **éléments de connaissance**,
  à l'état *proposé* ou *validé*. C'est la connaissance qui est le cœur ; « proposé »
  et « validé » ne sont que ses deux états.

## Ordre de construction des objets

Chaque objet métier suit le **même** cycle (proposé → validé → projeté → toutes les
vues). On termine un objet **entièrement** avant le suivant :

1. **Action** — en cours.
2. **Échéance** — ensuite (irrigue le plus de surfaces : Dashboard, Planning, Site,
   Notifications, PDF, Historique).
3. **Connaissance** (« à savoir ») / Mémoire.
4. **Vigilance**.
5. **Intervenant**, **Décision**.

## Critère « vivant »

Un objet est réellement vivant quand il suit le **même cycle de vie quel que soit
le point d'entrée** (visite, dashboard, fiche chantier, mobile) : même objet, même
projection, même promotion, même historique — sans rafraîchir la page, sans
synchronisation manuelle, sans traitement différé.
