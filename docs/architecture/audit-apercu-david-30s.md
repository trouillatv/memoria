# Audit produit READ-ONLY — « David comprend-il Bella en 30 secondes ? »

Cadre (Vincent) : le socle de vérité (#229–#233) est bon ; le problème n'est plus *« MemorIA
comprend-elle l'histoire ? »* mais *« David la comprend-il immédiatement sans devenir analyste
de MemorIA ? »*. Un seul lot READ-ONLY, aucune architecture, aucune narration IA. Sondes :
`scripts/audit-david-30s.ts` (sources tracées), `audit-bella-12-enrich.ts`. **Aucune écriture.**

## 0. Table de vérité des nombres visibles (Bella, PV 2024 → PV 2025)

| Surface | Nombre affiché | Source (fonction) | Population / modèle |
|---|---|---|---|
| **Aperçu — Depuis le dernier PV** | 3 réouverts · **12 nouveaux** · 3 résolus · 2 non mentionnés | `buildActivitySinceLastPv` → `getPvDelta` | **occurrence-first (#228/#230), seuls acteurs exclus** |
| **Aperçu — Attention** | électrique (réouvert), nettoyage (réouvert), séparation (non mentionné) | `deriveCanonicalAttentionItems` | occurrence-first (#229) |
| **Histoire > Synthèse** | **2 apparus** · 3 aggravés/réouverts · 0 traités | `getCanonicalDelta` + `computeDeltaSummary` | **legacy proposals + `document_status`, familles person/company/`knowledge_fact` EXCLUES + fusion aggravé/réouvert** |
| **Histoire > Évolution** | **Aucune transition — sujets en cours** | `buildEvolutionReadModel` (`getActivityMap`) | modèle structurel (proposals), 0 transition |
| **Histoire > Évolution (Tension)** | Pic 7 au PV1 · 7 au dernier | `getSiteHealthTimeline` | axe « nombre de concerns ouverts » (valide mais distinct) |

Mesuré : le delta legacy contient `{knowledge_fact:3, observation:2, action:5}`. Les 3
`knowledge_fact` sont **retirés** → « 2 apparus » = les 2 survivants (`observation` + `action`).
Les 12 nouveaux de l'Aperçu sont pour 11/12 des occurrences `knowledge_fact` (audit #232) :
**c'est la famille exclue qui explique tout l'écart 12 → 2.**

## 1. Les 4 contradictions demandées — cause racine

| Contradiction | Réalité mesurée | Cause |
|---|---|---|
| Aperçu **12 nouveaux** vs Synthèse **2 apparus** | 12 vs 2 | **Populations différentes** : Synthèse exclut la famille `knowledge_fact` (11/12 des nouveaux) ; Aperçu occurrence-first les garde (#228). |
| Aperçu **3 réouverts** vs Synthèse **3 aggravés/réouverts** | même nombre, **composition différente** | Synthèse **fusionne** aggravé+réouvert (`computeDeltaSummary`) ET, sur proposals+`document_status`, classe **« registre sécurité »** réouvert là où l'Aperçu (occurrence) classe **« nettoyage »**. Les deux surfaces ne nomment pas les mêmes 3 sujets. |
| Aperçu beaucoup d'activité vs Évolution **Aucune transition** | 12+3+3 vs **0** | Le modèle structurel (`getActivityMap`) ne produit **aucune** transition pour Bella → « aucun signal structurant » pendant que l'Aperçu montre 18 mouvements. |
| Attention **Séparation = non mentionné + action ouverte** | cohérent partout | ✅ occurrence-first (#229) ; identique à la fiche. Pas de contradiction. |

**Verdict Q3 (surfaces encore non-occurrence-first) : `Histoire > Synthèse` et `Histoire >
Évolution` (+ `Historique PV`, même `getActivityMap`) racontent encore le MODÈLE LEGACY**
(proposals + `document_status` + exclusion de famille `knowledge_fact`). Ce sont les projections
historiques concurrentes que #230 avait volontairement laissées de côté. Dette produit désormais
VISIBLE : un même chantier dit « 12 nouveaux » ici et « 2 apparus » là, sans que rien n'explique
qu'il s'agit de deux populations. Interne, non affiché : `pvLastDelta` (SiteOverview) reste calculé
en legacy mais n'est plus rendu (#230) — mort, à retirer un jour, non urgent.

## 2. Réponses aux 4 questions

**Q1 — Info nécessaire, accessible seulement en recoupant plusieurs blocs.**
- **Le « so what »** : le chantier va-t-il mieux ou moins bien ? David doit lire État (0 blocage /
  0 retard) + Depuis le PV (12 nouveaux / 3 réouverts) + Attention, puis synthétiser lui-même.
- **La NATURE des 12 nouveaux** : ce sont tous des points d'une **commission de sécurité 2025**
  (même PV, même page). Cette caractérisation n'est écrite nulle part — David l'infère en lisant
  les 12 libellés un par un.
- **Quels 3 sujets ont rouvert** : l'Aperçu montre « 3 réouverts » mais il faut ouvrir la fiche /
  Chronologie pour savoir *électrique / cuisson / nettoyage*.

**Q2 — Info répétée sans augmenter la compréhension.**
- Trois compteurs « action » voisins : État **3 sujets d'action** · **7 proposées** · **Que reste-t-il
  à faire** (priority). Modèles mentaux qui se chevauchent.
- Les sujets réouverts apparaissent **et** dans Attention **et** dans Depuis le PV, formulés
  différemment.
- **Connaissances validées** = longue liste plate qui redit une partie des 12 nouveaux / faits
  (« Parois CF… OK », « Arrêt d'urgence… ») déjà comptés ailleurs.

**Q3 — Surfaces ≠ occurrence-first.** → §1 : Synthèse, Évolution, Historique PV (legacy).

**Q4 — Synthèse déterministe possible (sans jugement ni invention).**
Prouvable depuis les occurrences :
- « Le PV du 5 août 2025 a introduit **12 nouveaux sujets de suivi**. » ✔
- « **3 sujets précédemment résolus sont à refaire** : installations électriques, appareils de
  cuisson, nettoyage des conduits. » ✔ (réouvertures prouvées)
- « **3 sujets ont été résolus/levés.** » ✔
- « **1 sujet reste ouvert** bien que non mentionné au dernier PV : séparation des flux. » ✔
- « Aucune réserve, aucun blocage, aucune action en retard. » ✔

**NON prouvable — à ne jamais écrire** : « la situation s'est dégradée ». 12 nouveaux sujets
peuvent venir d'un **PV plus détaillé** (commission de sécurité), pas d'une dégradation. Distinction
essentielle : le nombre est un fait, l'appréciation ne l'est pas.

**Limite de données pour la compression (P2)** : les occurrences des 12 nouveaux ont
`thematic_category = null`. On ne peut donc PAS encore regrouper « 12 → quelques thèmes » de façon
déterministe par thème. Il faudra soit un `thematic_category` renseigné, soit un autre signal de
regroupement — mais **jamais** un filtrage qui ferait redescendre 12 vers 2.

## 3. Test « David en 30 s » (état actuel)

- **< 5 s** : « Pas de réserve, blocage ni retard ; 3 sujets d'action suivis. » ✅
- **10–15 s** : « Beaucoup de changements : 12 nouveaux, 3 réouverts, 3 résolus. » ✅
- **20–30 s** : « Électricité, cuisson et nettoyage rouverts ; séparation des flux ouverte
  bien que non mentionnée. » ✅ (en ouvrant fiche/Chronologie)
- **Ne comprend PAS spontanément** : *pourquoi* 12 nouveaux, ce qui les caractérise, la chose
  principale à retenir du PV. C'est le dernier kilomètre.

## 4. Priorités produit (READ-ONLY → aucune démarrée)

- **P0 — cohérence des surfaces.** Faire converger (ou expliciter comme populations distinctes)
  `Histoire > Synthèse` + `Évolution` + `Historique PV` vers l'occurrence-first, sinon une même
  vérité s'affiche « 12 » ici et « 2 » là. Le levier technique = remplacer `getCanonicalDelta`/
  `computeDeltaSummary`/`getActivityMap` par `getPvDelta`/`buildSiteSubjectCells` (déjà la source
  de l'Aperçu), OU afficher côte à côte les deux définitions avec un libellé qui les distingue.
- **P1 — synthèse de lecture de l'Aperçu.** 2–3 phrases DÉTERMINISTES (§Q4), pas une nouvelle carte,
  pas d'IA : deltas → récit factuel. Ordre cible : **synthèse → faits saillants → preuve → détail**
  (aujourd'hui : compteurs → compteurs → listes → l'utilisateur reconstruit la synthèse).
- **P2 — compression de la matière nouvelle.** 12 vrais sujets → quelques idées compréhensibles
  **sans en perdre aucun**. Dépend d'un signal de regroupement (thematic_category null aujourd'hui).
- **P3 — surfaces secondaires.** Relations repliées par défaut sur la fiche (bloc vide = trop de
  place) ; « Connaissances validées » moins plate (secondaire, pas surface principale) ; clarifier
  quand utiliser Synthèse / Évolution / Lignes de vie ; ligne de vie = orientation, Fil métier =
  preuve (ne pas surcharger la ligne de vie).

**HARD STOP après audit. Aucune correction, aucun renommage, aucun nettoyage dans ce lot.**
