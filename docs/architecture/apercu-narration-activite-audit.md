# Audit Aperçu — narration de l'activité + compteurs (READ-ONLY)

**Statut : audit READ-ONLY. Aucun correctif, aucune donnée modifiée.** HARD STOP.
Corpus témoin : Bella Napoli (données réelles, mesurées).

## Constat central

La donnée longitudinale est correcte (les fiches racontent « Résolu 2024 → Réouvert 2025 »), mais
l'Aperçu la **réduit** : il lit des sources plus faibles que la fiche et retombe sur des formulations
génériques. **C'est un défaut de NARRATION, pas de donnée.** Trois niveaux à ne PAS fusionner : ÉTAT
ACTUEL (où en est-on ?) / ACTIVITÉ (qu'est-ce qui a changé depuis le dernier PV ?) / ATTENTION (sur quoi agir ?).

## A. « Ce qui demande votre attention » — narration vs vérité (mesuré)

Moteur : `deriveCanonicalAttentionItems` (`lib/knowledge/canonical-attention.ts`). La ligne 2 « statut à
la dernière visite » n'affiche « Réouvert au dernier PV » que si `pv.reason === 'réouvert'`, où `pv` vient de
**`computeWatchlist(getSiteSubjectMatrix)`** — PAS de la trajectoire d'occurrences (buildSiteSubjectCells /
fiche). Quand ce watchlist ne détecte pas la réouverture, la ligne retombe sur le générique
`else if (isOpen)` → **« Toujours ouvert lors de la dernière visite »**.

| Sujet Bella | AFFICHÉ (Aperçu, mesuré) | VÉRITÉ (occurrences / Chronologie) | Formulation souhaitable |
|---|---|---|---|
| **Contrôle installations électriques** | « Mentionné dans 2 rapports · **Toujours ouvert lors de la dernière visite** · 1 action ouverte » | `2024-07-19:resolved → 2025-08-05:open` ; transition Chronologie = **réouvert** ; signal moteur = `open_with_objects` (PAS `pv_reopened`) | **« Réouvert · contrôlé précédemment → à refaire depuis le PV du 5 août · 1 action ouverte »** |
| **Nettoyage conduits** | « … · **Toujours ouvert** · 1 action ouverte » | `resolved → open` ; transition = **réouvert** | « Réouvert · nouvelle exigence au PV du 5 août · 1 action ouverte » |
| **Séparation des flux** | « **Mentionné dans 1 rapport** · 1 action ouverte » | `2024-07-19:unknown → 2025-08-05:gap` ; transition = **non_mentionné** ; currentStatus=null | **« À suivre · action toujours ouverte · NON mentionné dans le dernier PV (état précédent conservé) »** |

**Défauts prouvés :**
1. **resolved→reopened raconté « Toujours ouvert »** (électrique, nettoyage). Sémantiquement faux : le sujet
   n'était pas *toujours* ouvert, il était **résolu puis réouvert** — la valeur différenciante de MemorIA
   perdue. Cause : le moteur d'attention lit `computeWatchlist(getSiteSubjectMatrix)` et non la trajectoire
   d'occurrence ; à corriger côté NARRATION (la donnée est bonne).
2. **Non-mention non exprimée** (séparation flux). « Mentionné dans 1 rapport » peut se lire « le dernier PV
   le mentionne encore » — FAUX. Vérité : action ouverte MAIS **non mentionné au dernier PV**. Aucune ligne du
   moteur n'exprime « objet toujours ouvert / sujet non mentionné depuis ».
3. **« Mentionné dans N rapports » = présence documentaire** (pvCount+natif), ambigu : ce n'est pas « le
   dernier PV le confirme ».

## B. « Depuis le dernier PV » — barre compacte qui écrase la vérité

Composant `PvDeltaBanner` (SiteOverviewTab). `pvLastDelta` Bella mesuré :
`{nouveaux:2, aggravésRéouverts:3, réalisésLevés:0}` → affiché **« 2 apparus · 3 aggravés »**.

- **`aggravésRéouverts` FUSIONNE aggravé + réouvert** (`site-overview.ts:508`) et le banner l'étiquette
  **« aggravés »** (`SiteOverviewTab.tsx:277`). Or les 3 sont des **RÉOUVERTURES** (électrique/nettoyage/cuisson,
  resolved→open), pas des aggravations. **Mot faux + information écrasée.**
- La donnée par sujet EXISTE (`getPvDelta` : réouvert / nouveau / non_mentionné par canonical) — le banner la
  jette au profit de 3 compteurs. Une vraie section « Depuis le dernier PV » (liste : ↩ réouverts, ✚ nouveaux,
  = maintenus, ∅ non mentionnés) apporterait une lecture métier nettement supérieure. C'est aujourd'hui une
  petite ligne coincée entre deux cartes, alors que c'est le « film entre deux réunions ».

## C. Compteurs et contenu masqué

- **« N actions proposées » (à confirmer)** — `SiteOverviewTab.tsx:150-172` : le titre affiche
  `summary.proposed` (population complète) mais la liste rend `actions.proposed = proposedTop.slice(0, TOP)`
  avec **TOP=3** (`site-overview.ts:68,618`). **Aucun « +N autres » ni « Voir les N ».** Sur un site à 7
  proposées, 4 sont masquées sans indicateur. (Bella actuel : `summary.proposed=0` → carte masquée ; le défaut
  se manifeste sur tout site à proposées>3 — à re-mesurer sur le site de la capture.) Distinction population
  OK au niveau données : `proposed` = extraction à confirmer ; `Que reste-t-il` = actions matérialisées
  ouvertes (`summary.active`, deux champs distincts). L'UX doit rendre cette distinction évidente.
- **« Ce qui demande votre attention »** — `SiteAttentionSection.tsx:63-79` : affiche `top=3`, indique
  « N autres sujets » en **texte non cliquable** (pas de lien pour voir le reste). Compteur non navigable.
- **« Que reste-t-il à faire ? »** — `slice(0,3)` + lien **« Voir toutes les actions »** : navigable ✅
  (le bon patron à généraliser).

**Doctrine compteurs (à évaluer, non codée)** : tout nombre affiché doit être *explicable* (correspondre
exactement à une population) et *navigable* (moyen évident d'atteindre l'intégralité). Aucun chiffre ne
doit être une impasse.

## Recommandations (NON démarrées, HARD STOP)

1. **ATTENTION — narration depuis l'occurrence** : les lignes « Réouvert / Non mentionné (état conservé) /
   Aggravé / Nouveau » doivent venir de la trajectoire d'occurrence (buildSiteSubjectCells / la même source
   que fiche & Chronologie), pas de `computeWatchlist(getSiteSubjectMatrix)`. Supprimer le fallback
   générique « Toujours ouvert » quand une transition réelle existe. Distinguer explicitement « toujours
   confirmé au dernier PV » de « ouvert mais non mentionné depuis ».
2. **ACTIVITÉ — vraie section « Depuis le dernier PV »** : remplacer le compteur fusionné par une liste
   déterministe (réouverts / nouveaux / maintenus / non mentionnés) alimentée par `getPvDelta`. Corriger le
   libellé « aggravés » (ne pas confondre aggravé et réouvert).
3. **COMPTEURS** : « N proposées » → afficher 3 + « + (N−3) autres · Voir les N » ; rendre « N autres sujets »
   de l'attention navigable ; vérifier chaque compteur (proposées/actives/réserves/échéances) = population
   exacte + accès à l'intégralité.
4. **Séparer les 3 niveaux** (état / activité / attention) — c'est là que #227/#228 (changement ≠ attention
   ≠ stagnation) prennent leur sens produit.

Aucune de ces corrections n'est démarrée. À prioriser par Vincent.
